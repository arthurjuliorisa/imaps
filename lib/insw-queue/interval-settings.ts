import type { PrismaClient } from '@prisma/client';
import { boundedText, integer } from './contracts';
import { readPolicy, updatePolicy } from './policy.repository';

export const MIN_INTERVAL_MS = 3600;
export const MAX_INTERVAL_MS = 2147483647;
export class IntervalSettingsError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function parseIntervalUpdate(input: unknown) {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid settings');
    const value = input as Record<string, unknown>;
    const keys = Object.keys(value);
    if (keys.length !== 3 || keys.some(key => !['intervalMs', 'expectedVersion', 'reason'].includes(key))) {
      throw new Error('Only intervalMs, expectedVersion and reason are accepted');
    }
    return {
      intervalMs: integer(value.intervalMs, 'processing interval', MIN_INTERVAL_MS, MAX_INTERVAL_MS),
      expectedVersion: integer(value.expectedVersion, 'expected version', 1, 2147483646),
      reason: boundedText(value.reason, 'change reason', 500),
    };
  } catch (error) {
    throw new IntervalSettingsError((error as Error).message, 400);
  }
}

// Explicit projection: no unrelated policy or process configuration leaves the server.
export function intervalProjection(row: Awaited<ReturnType<typeof readPolicy>>) {
  return { intervalMs: row.min_processing_interval_ms, version: row.version,
    updatedAt: row.updated_at.toISOString(), updatedBy: row.updated_by, reason: row.change_reason };
}

export async function updateInterval(db: PrismaClient, input: unknown, actor: string) {
  const value = parseIntervalUpdate(input);
  const current = await readPolicy(db);
  if (current.version !== value.expectedVersion) throw new IntervalSettingsError('Policy changed. Reload and review the current interval.', 409);
  try {
    // The version CAS protects the retained value too: a concurrent backend policy
    // change cannot be overwritten using this snapshot. Audit and update commit together.
    return intervalProjection(await updatePolicy(db, value.expectedVersion, {
      min_processing_interval_ms: value.intervalMs, max_auto_retry: current.max_auto_retry,
    }, actor, value.reason));
  } catch (error) {
    if ((error as Error).message === 'Missing policy or stale policy version') {
      throw new IntervalSettingsError('Policy changed. Reload and review the current interval.', 409);
    }
    throw error;
  }
}
