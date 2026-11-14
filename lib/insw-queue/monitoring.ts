import { Prisma, type PrismaClient } from '@prisma/client';
import type { Session } from 'next-auth';
import { intervalSettingsAccess } from './interval-settings-http';

export const QUEUE_STATUSES = ['READY', 'CLAIMED', 'HELD', 'FAILED', 'REMOTE_SUCCEEDED', 'SUCCEEDED', 'SUPERSEDED'] as const;
export type QueueMonitoring = {
  observedAt: string; companyCode: number;
  worker: { status: string; ownershipPresent: boolean; busy: boolean; lastTransmissionStartedAt: string | null };
  counts: Record<typeof QUEUE_STATUSES[number], number>;
  failures: { queueId: string; recordedAt: string; category: string; message: string; source: string }[];
};
// Allowlisted descriptions only: free-form errors, identity JSON and provider
// bodies can contain credentials/payloads and must never reach this read model.
const localMessages: Record<string, string> = {
  PRE_SEND_VALIDATION_FAILED: 'Pre-send validation failed.',
  LOCAL_DATABASE_PREPARATION_FAILURE: 'Local database preparation failed.',
  LOCAL_DATA_FAILURE: 'Local data preparation failed.',
  LOCAL_MAPPING_FAILURE: 'Local mapping preparation failed.',
  LOCAL_SOURCE_FAILURE: 'Local source preparation failed.',
  LOCAL_CONFIG_FAILURE: 'Local configuration preparation failed.',
  LOCAL_AUTH_FAILURE: 'Local authentication preparation failed.',
};
export async function readQueueMonitoring(db: PrismaClient, companyCode: number): Promise<QueueMonitoring> {
  // One statement/snapshot. Existing company/queued_at index bounds the seven-day
  // failure subset; counts cover persisted company cycles, including old cycles.
  // Gate projection is global but contains no company/attempt/process identity.
  const [row] = await db.$queryRaw<{
    observed_at: Date; owner_present: boolean | null; busy: boolean | null;
    last_started_at: Date | null; counts: { status: string; count: number }[];
    failures: { id: string; recorded_at: string; error_code: string | null; hold_reason: string | null }[];
  }[]>(Prisma.sql`
    SELECT clock_timestamp() AS observed_at,
      g.owner_token IS NOT NULL AS owner_present, g.busy_attempt_id IS NOT NULL AS busy, g.last_started_at,
      (SELECT COALESCE(jsonb_agg(c), '[]'::jsonb) FROM
        (SELECT status, count(*)::integer AS count FROM insw_queue_cycle
         WHERE company_code = ${companyCode} GROUP BY status) c) AS counts,
      (SELECT COALESCE(jsonb_agg(f ORDER BY f.queued_at DESC, f.id DESC), '[]'::jsonb) FROM
        (SELECT id, queued_at, COALESCE(completed_at, last_attempt_at, claimed_at, queued_at) AS recorded_at,
          error_code, hold_reason FROM insw_queue_cycle
         WHERE company_code = ${companyCode} AND queued_at >= statement_timestamp() - interval '7 days'
           AND (error_category = 'LOCAL_PREPARATION_FAILURE' OR error_code IN (${Prisma.join(Object.keys(localMessages))})
             OR hold_reason = 'LOCAL_FINALIZATION_REQUIRED')
         ORDER BY queued_at DESC, id DESC LIMIT 20) f) AS failures
    FROM (SELECT 1) singleton LEFT JOIN insw_dispatch_gate g ON g.id = 1`);
  const counts = Object.fromEntries(QUEUE_STATUSES.map(status => [status, 0])) as QueueMonitoring['counts'];
  for (const entry of row.counts) {
    if (QUEUE_STATUSES.includes(entry.status as typeof QUEUE_STATUSES[number])) counts[entry.status as keyof typeof counts] = entry.count;
  }
  return {
    observedAt: row.observed_at.toISOString(), companyCode,
    worker: {
      status: row.owner_present ? 'Owner recorded — process status unverified' : 'Unknown / Stale — no owner recorded',
      ownershipPresent: row.owner_present === true, busy: row.busy === true,
      lastTransmissionStartedAt: row.last_started_at?.toISOString() ?? null,
    }, counts,
    failures: row.failures.map(f => ({ queueId: f.id, recordedAt: f.recorded_at,
      category: f.hold_reason === 'LOCAL_FINALIZATION_REQUIRED' ? 'Local finalization pending' : 'Local preflight / preparation',
      message: f.hold_reason === 'LOCAL_FINALIZATION_REQUIRED' ? 'Remote success recorded; local finalization required.'
        : (Object.prototype.hasOwnProperty.call(localMessages, f.error_code ?? '') ? localMessages[f.error_code!] : 'Local preparation failure recorded; review approved operational logs.'),
      source: 'insw_queue_cycle',
    })),
  };
}
export async function queueMonitoringRequest(request: Request, session: Session | null, db: PrismaClient) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const access = intervalSettingsAccess(session);
  if (access !== 200) return json({ error: access === 401 ? 'Unauthorized' : 'Forbidden' }, access);
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  // Match session-company isolation used by INSW logs; no client-selected scope
  // or implicit visibility of the other supported company (1370 / 1380).
  const raw = session!.user.companyCode;
  if (!/^[1-9]\d*$/.test(String(raw)) || !Number.isSafeInteger(Number(raw)) || Number(raw) > 2147483647) {
    return json({ error: 'A valid session company is required for queue monitoring.' }, 400);
  }
  try { return json({ data: await readQueueMonitoring(db, Number(raw)) }); }
  catch { return json({ error: 'Queue monitoring is unavailable. The last observation may be stale.' }, 500); }
}
