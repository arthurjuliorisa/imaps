import { Prisma, type PrismaClient } from '@prisma/client';

export interface AttemptHistoryEntry {
  id: string; queue_id: string; cycle: number; retry_index: number;
  max_auto_retry_snapshot: number; delivery_state: string;
  claimed_at: string; started_at: string | null; completed_at: string | null;
  log_id: string | null; outcome: string | null; reason: string | null;
  http_code: string | null; provenance: string | null;
}

/** Detail-only, bounded chronological snapshots. No payloads, credentials or owner tokens. */
export async function attemptHistory(db: PrismaClient, companyCode: number, queueId: string) {
  const rows = await db.$queryRaw<AttemptHistoryEntry[]>(Prisma.sql`
    SELECT a.id, q.id AS queue_id, q.cycle, a.retry_index, q.max_auto_retry_snapshot,
      a.delivery_state, a.claimed_at::text, a.started_at::text, a.completed_at::text,
      l.id::text AS log_id, l.insw_status AS outcome, left(l.insw_error, 500) AS reason,
      left(l.metadata->>'httpCode', 3) AS http_code,
      CASE WHEN l.metadata->>'rehearsalProvenance' IN
        ('SIMULATED_REMOTE_REJECTION', 'SIMULATED_TRANSPORT_FAULT', 'REAL_INSW_TEST_RESPONSE')
        THEN l.metadata->>'rehearsalProvenance' ELSE NULL END AS provenance
    FROM insw_queue_cycle original
    JOIN insw_queue_cycle q ON q.identity_key = original.identity_key AND q.company_code = ${companyCode}
    JOIN insw_queue_attempt a ON a.queue_id = q.id
    LEFT JOIN insw_tracking_log l ON l.queue_attempt_id = a.id AND l.company_code = ${companyCode}
    WHERE original.id = ${queueId}::uuid AND original.company_code = ${companyCode}
    ORDER BY q.cycle, a.retry_index, l.id LIMIT 101`);
  return { entries: rows.slice(0, 100), truncated: rows.length > 100 };
}
