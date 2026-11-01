import { Prisma, type PrismaClient } from '@prisma/client';

import type { OperationalState } from './operational-state';

export interface OperationalLog {
  id: string; transaction_type: string; transaction_id: number | null; wms_id: string | null;
  company_code: number; insw_status: string; insw_activity_code: string | null;
  insw_error: string | null; sent_at: string | null; retry_count: number; created_at: string;
  queue_id: string | null; queue_attempt_id: string | null; current_queue?: OperationalState | null;
}
export interface OperationalFilters {
  company_code: number; transaction_type?: string; insw_status?: string; wms_id?: string;
  date_from?: string; date_to?: string; limit: number; offset: number;
}

/** Two queries at any page size: bounded history/pending page then batched
 * latest identity/attempt lookup. Never select frozen payloads or responses.
 */
export async function operationalLogPage(db: PrismaClient, filters: OperationalFilters) {
  const from = filters.date_from ? new Date(`${filters.date_from}T00:00:00`) : null;
  const to = filters.date_to ? new Date(`${filters.date_to}T00:00:00`) : null;
  if (to) to.setDate(to.getDate() + 1);
  const [page] = await db.$queryRaw<{ total: number; logs: OperationalLog[] }[]>(Prisma.sql`
    WITH hidden_claims AS MATERIALIZED (
      SELECT l.id FROM insw_tracking_log l WHERE l.company_code = ${filters.company_code}
        AND (l.transaction_type IN ('scrap_in', 'scrap_out') AND l.insw_status = 'PENDING'
          AND l.insw_request_payload IS NULL AND COALESCE(l.metadata->>'claim', 'false') = 'true'
          AND COALESCE(l.metadata->>'attempt_lifecycle', 'false') <> 'true'
          AND EXISTS (SELECT 1 FROM insw_tracking_log actual WHERE actual.company_code = l.company_code
            AND actual.id <> l.id AND actual.transaction_type = l.transaction_type
            AND actual.transaction_id IS NOT DISTINCT FROM l.transaction_id
            AND actual.wms_id IS NOT DISTINCT FROM l.wms_id
            AND actual.insw_activity_code IS NOT DISTINCT FROM l.insw_activity_code
            AND actual.created_at >= l.created_at
            AND (actual.insw_status IN ('SUCCESS', 'FAILED') OR actual.insw_request_payload IS NOT NULL)))
    ), candidates AS (
      SELECT l.id::text, l.transaction_type, l.transaction_id, l.wms_id, l.company_code,
        l.insw_status, l.insw_activity_code, left(l.insw_error, 500) AS insw_error,
        l.sent_at, l.retry_count, l.created_at, a.queue_id, l.queue_attempt_id
      FROM insw_tracking_log l LEFT JOIN insw_queue_attempt a ON a.id = l.queue_attempt_id
      WHERE l.company_code = ${filters.company_code}
        AND l.id NOT IN (SELECT id FROM hidden_claims)
      UNION ALL
      SELECT concat('queue:', q.id), lower(q.operation::text), NULL::integer, q.wms_reference,
        q.company_code, 'NO_ATTEMPT_LOG', NULL, NULL, NULL::timestamptz, q.retry_index,
        q.queued_at, q.id, NULL::uuid
      FROM insw_queue_cycle q WHERE q.company_code = ${filters.company_code}
        AND NOT EXISTS (SELECT 1 FROM insw_queue_cycle newer WHERE newer.identity_key = q.identity_key AND newer.cycle > q.cycle)
        AND NOT EXISTS (SELECT 1 FROM insw_queue_attempt a JOIN insw_tracking_log l ON l.queue_attempt_id = a.id
          WHERE a.queue_id = q.id AND l.company_code = q.company_code)
    ), filtered AS (
      SELECT * FROM candidates WHERE true
        ${filters.transaction_type ? Prisma.sql`AND transaction_type = ${filters.transaction_type}` : Prisma.empty}
        ${filters.insw_status ? Prisma.sql`AND insw_status = ${filters.insw_status}` : Prisma.empty}
        ${filters.wms_id ? Prisma.sql`AND strpos(lower(wms_id), lower(${filters.wms_id})) > 0` : Prisma.empty}
        ${from ? Prisma.sql`AND COALESCE(sent_at, created_at) >= ${from}` : Prisma.empty}
        ${to ? Prisma.sql`AND COALESCE(sent_at, created_at) < ${to}` : Prisma.empty}
    ) SELECT (SELECT count(*)::integer FROM filtered) AS total,
      COALESCE((SELECT jsonb_agg(p ORDER BY p.created_at DESC, p.id DESC) FROM
        (SELECT * FROM filtered ORDER BY created_at DESC, id DESC LIMIT ${filters.limit} OFFSET ${filters.offset}) p), '[]'::jsonb) AS logs`);
  const logs = page.logs;
  const states = await currentQueueStates(db, filters.company_code, logs.flatMap(l => l.queue_id ? [l.queue_id] : []));
  return { total: page.total, logs: logs.map(log => ({ ...log, current_queue: log.queue_id ? states.get(log.queue_id) ?? null : null })) };
}

/** A page's original cycles are joined to their latest successor in one batch. */
export async function currentQueueStates(db: PrismaClient, companyCode: number, queueIds: string[]) {
  if (!queueIds.length) return new Map<string, OperationalState>();
  const rows = await db.$queryRaw<{ original_id: string; state: OperationalState }[]>(Prisma.sql`
    SELECT original.id AS original_id, jsonb_build_object(
      'id', q.id, 'status', q.status, 'delivery_state', q.delivery_state, 'cycle', q.cycle,
      'intent', q.intent, 'retry_index', q.retry_index, 'max_auto_retry_snapshot', q.max_auto_retry_snapshot,
      'hold_reason', q.hold_reason, 'error_message', q.error_message, 'queued_at', q.queued_at,
      'next_eligible_at', q.next_eligible_at, 'claimed_at', q.claimed_at, 'completed_at', q.completed_at,
      'attempt', CASE WHEN a.id IS NULL THEN NULL ELSE jsonb_build_object('id', a.id,
        'delivery_state', a.delivery_state, 'claimed_at', a.claimed_at, 'started_at', a.started_at, 'completed_at', a.completed_at) END,
      'attempts_started', (SELECT count(*) FROM insw_queue_attempt started WHERE started.queue_id = q.id AND started.started_at IS NOT NULL),
      'latest_log_id', l.id::text) AS state
    FROM insw_queue_cycle original
    JOIN LATERAL (SELECT * FROM insw_queue_cycle latest WHERE latest.identity_key = original.identity_key
      AND latest.company_code = ${companyCode} ORDER BY latest.cycle DESC LIMIT 1) q ON true
    LEFT JOIN LATERAL (SELECT * FROM insw_queue_attempt attempt WHERE attempt.queue_id = q.id ORDER BY retry_index DESC LIMIT 1) a ON true
    LEFT JOIN LATERAL (SELECT id FROM insw_tracking_log log WHERE log.queue_attempt_id = a.id
      AND log.company_code = ${companyCode} ORDER BY id DESC LIMIT 1) l ON true
    WHERE original.company_code = ${companyCode} AND original.id IN (${Prisma.join([...new Set(queueIds)].map(id => Prisma.sql`${id}::uuid`))})`);
  return new Map(rows.map(row => [row.original_id, row.state]));
}

