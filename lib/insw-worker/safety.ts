import { freezePayload, integer, retryAllowed } from '../insw-queue/contracts';

// Only the dedicated production CLI may act on this decision.
export function startupDecision(env: Readonly<Record<string, string | undefined>>): 'DISABLED' | 'BLOCKED' | 'ENABLED' {
  if (env.INSW_WORKER_ENABLED !== 'true') return 'DISABLED';
  return env.NODE_ENV === 'production' ? 'ENABLED' : 'BLOCKED';
}

export function verifiedPayload(payload: unknown, expectedHash: string): string {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error('INVALID_PAYLOAD_HASH');
  const frozen = freezePayload(payload);
  if (frozen.sha256 !== expectedHash) throw new Error('PAYLOAD_HASH_MISMATCH');
  return JSON.stringify(frozen.payload);
}

// Specification helper only, not DB admission or a lock.
// Retain the prior admission's interval even if an operator lowers the policy.
export function earliestNextStart(last: { startedAt: number; finishedAt: number; intervalAtAdmission: number } | null, currentInterval: number): number {
  integer(currentInterval, 'processing interval', 1);
  if (!last) return 0;
  integer(last.intervalAtAdmission, 'admitted interval', 1);
  if (!Number.isFinite(last.startedAt) || !Number.isFinite(last.finishedAt) || last.finishedAt < last.startedAt) throw new Error('Invalid prior timing');
  return Math.max(last.finishedAt, last.startedAt + Math.max(3600, last.intervalAtAdmission, currentInterval));
}

// Restrictive legacy Phase B known-failure contract, kept for regression.
// The revised C1 candidate/ambiguous-delivery policy is in retry.ts.
// This function does not requeue, allocate a tail, or interpret remote error codes.
export function retryDisposition(input: { delivery: string; confirmedSafeRetry: boolean; retryIndex: number; maxAutoRetrySnapshot: number }): 'RETRY_TO_TAIL' | 'HOLD' | 'STOP' {
  const withinBudget = retryAllowed(input.retryIndex, input.maxAutoRetrySnapshot, input.delivery);
  if (input.delivery === 'KNOWN_SUCCESS') return 'STOP';
  if (input.delivery !== 'KNOWN_FAILURE' || !input.confirmedSafeRetry) return 'HOLD';
  return withinBudget ? 'RETRY_TO_TAIL' : 'STOP';
}
