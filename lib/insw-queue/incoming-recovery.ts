import { Prisma, type PrismaClient } from '@prisma/client';
import { integer } from './contracts';

/** Server-only caller must pass the authenticated session user, never request JSON.
 * Mirrors WMS-log company authorization, including SUPER_ADMIN. No HTTP route or
 * producer imports this module. A missing company fails closed for ordinary users.
 */
export type RecoveryPrincipal = { role: string; companyCode?: number };
export type PreparationStatus = 'NOT_REQUIRED' | 'UNKNOWN_NEEDS_REVIEW' | 'QUEUE_CREATED' | 'PREPARATION_BLOCKED';
type Observation = {
  log_id: bigint; wms_id: string | null; accepted_status: string; company_type: string | null;
  source_id: number | null; business_date: string | null; source_updated_at: Date | null;
  source_matches: bigint; queue_id: string | null; queue_status: string | null;
  queue_identities: bigint; http_attempts_started: number; retry_index: number | null; next_eligible_at: Date | null;
  queued_at: Date | null; error_category: string | null; delivery_state: string | null; hold_reason: string | null;
  legacy_status: string | null; legacy_at: Date | null; has_remote_success: boolean;
};

export type IncomingRecoveryRow = {
  logId: string; companyCode: number; wmsReference: string | null;
  request: { status: 'ACCEPTED' | 'REJECTED' | 'UNKNOWN'; legacyStatus: string };
  source: { status: 'COMMITTED' | 'ACCEPTED_PERSISTING' | 'UNKNOWN_NEEDS_REVIEW';
    id: number | null; businessDate: string | null; observedUpdatedAt: Date | null };
  preparation: { status: PreparationStatus; reason: string;
    attemptCount: null; nextEligibleAt: null; rolloutId: null };
  transmission: { queueId: string | null; queueStatus: string | null; deliveryState: string | null;
    holdReason: string | null; classification: string | null; httpAttemptsStarted: number; httpRetryIndex: number | null; nextEligibleAt: Date | null;
    queuedAt: Date | null; legacyStatus: string | null; legacyObservedAt: Date | null;
    knownRemoteSuccess: boolean };
  actions: { retryQueue: false; retryQueueReason: string; inswResubmit: 'EXISTING_AUTHORIZED_WORKFLOW' };
};

/** Bounded, read-only recovery assessment over explicit WMS log IDs. This is NOT
 * a queue-era enumerator: absence of queue/ledger never grants posting permission.
 * All observations use one PostgreSQL statement/snapshot. Histories are reduced
 * in SQL; no payloads or arbitrary error strings are loaded into the list model.
 */
export async function inspectIncomingRecovery(
  db: PrismaClient, principal: RecoveryPrincipal, companyCode: number, logIds: readonly bigint[],
): Promise<IncomingRecoveryRow[]> {
  integer(companyCode, 'company code', 1);
  if (principal.role !== 'SUPER_ADMIN' && principal.companyCode !== companyCode) throw new Error('Company access denied');
  integer(logIds.length, 'recovery batch size', 1, 100);
  if (logIds.some(id => typeof id !== 'bigint' || id < BigInt(1) || id > BigInt('9223372036854775807'))) throw new Error('Invalid log ID');
  const ids = [...new Set(logIds)];
  const rows = await db.$queryRaw<Observation[]>(Prisma.sql`
    SELECT w.id AS log_id, w.wms_id, w.transmission_status AS accepted_status, c.company_type,
      s.id AS source_id, to_char(s.incoming_date, 'YYYY-MM-DD') AS business_date,
      s.updated_at AS source_updated_at, s.matches AS source_matches,
      q.id AS queue_id, q.status::text AS queue_status, q.identities AS queue_identities,
      (SELECT count(*)::integer FROM insw_queue_attempt a WHERE a.queue_id = q.id AND a.started_at IS NOT NULL) AS http_attempts_started,
      q.retry_index, q.next_eligible_at, q.queued_at, q.error_category, q.delivery_state::text, q.hold_reason::text,
      l.insw_status AS legacy_status, l.updated_at AS legacy_at,
      EXISTS (SELECT 1 FROM insw_tracking_log h WHERE h.company_code = w.company_code
        AND h.transaction_type = 'incoming' AND (h.wms_id = w.wms_id OR h.transaction_id = s.id)
        AND h.insw_status = 'SUCCESS') AS has_remote_success
    FROM wms_transmission_logs w JOIN companies c ON c.code = w.company_code
    LEFT JOIN LATERAL (
      SELECT a.*, count(*) OVER () AS matches FROM (
        SELECT b.id, b.incoming_date, b.updated_at FROM incoming_goods b
        WHERE b.company_code = w.company_code AND b.wms_id = w.wms_id AND b.deleted_at IS NULL
        ORDER BY b.incoming_date DESC, b.id DESC LIMIT 2
      ) a ORDER BY a.incoming_date DESC, a.id DESC LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      SELECT a.id, a.status, a.retry_index, a.next_eligible_at, a.queued_at,
        a.error_category, a.delivery_state, a.hold_reason,
        (SELECT count(*) FROM (SELECT DISTINCT b.identity_key FROM insw_queue_cycle b
          WHERE b.company_code = w.company_code AND b.operation = 'INCOMING'
            AND b.wms_reference = w.wms_id AND b.business_date = to_char(s.incoming_date, 'YYYY-MM-DD')
          LIMIT 2) identities) AS identities
      FROM insw_queue_cycle a WHERE a.company_code = w.company_code AND a.operation = 'INCOMING'
        AND a.wms_reference = w.wms_id AND a.business_date = to_char(s.incoming_date, 'YYYY-MM-DD')
      ORDER BY a.queued_at DESC, a.id DESC LIMIT 1
    ) q ON true
    LEFT JOIN LATERAL (
      SELECT a.insw_status, a.updated_at FROM insw_tracking_log a
      WHERE a.company_code = w.company_code AND a.transaction_type = 'incoming'
        AND (a.wms_id = w.wms_id OR a.transaction_id = s.id)
      ORDER BY a.created_at DESC, a.id DESC LIMIT 1
    ) l ON true
    WHERE w.company_code = ${companyCode} AND w.id IN (${Prisma.join(ids)})
      AND w.action = 'WMS_PROCESS_INCOMING_GOODS' ORDER BY w.id`);
  return rows.map(row => {
    const committed = row.source_id !== null && row.source_matches === BigInt(1);
    const applicable = row.company_type === 'SEZ';
    const ambiguous = !committed || (row.queue_identities ?? BigInt(0)) > BigInt(1);
    let status: PreparationStatus;
    let reason: string;
    if (row.company_type === null) { status = 'UNKNOWN_NEEDS_REVIEW'; reason = 'COMPANY_TYPE_UNCONFIRMED'; }
    else if (!applicable) { status = 'NOT_REQUIRED'; reason = 'NON_SEZ'; }
    else if (ambiguous) { status = 'UNKNOWN_NEEDS_REVIEW'; reason = row.source_id === null ? 'SOURCE_COMMIT_UNCONFIRMED' : 'AMBIGUOUS_SOURCE_OR_QUEUE_IDENTITY'; }
    else if (row.queue_id) { status = 'QUEUE_CREATED'; reason = 'EXISTING_QUEUE_CORRELATION'; }
    else { status = 'PREPARATION_BLOCKED'; reason = row.has_remote_success ? 'REMOTE_SUCCESS_NO_REPOST' : row.legacy_status ? 'DIRECT_HISTORY_REQUIRES_REVIEW' : 'QUEUE_ERA_AND_EXCLUSIVE_PRODUCER_UNPROVEN'; }
    return {
      logId: String(row.log_id), companyCode, wmsReference: row.wms_id,
      request: { status: row.accepted_status === 'SUCCESS' ? 'ACCEPTED' : ['FAILED', 'ERROR'].includes(row.accepted_status) ? 'REJECTED' : 'UNKNOWN', legacyStatus: row.accepted_status },
      source: { status: committed ? 'COMMITTED' : row.source_id === null && row.accepted_status === 'SUCCESS' ? 'ACCEPTED_PERSISTING' : 'UNKNOWN_NEEDS_REVIEW',
        id: committed ? row.source_id : null, businessDate: committed ? row.business_date : null,
        observedUpdatedAt: committed ? row.source_updated_at : null },
      preparation: { status, reason, attemptCount: null, nextEligibleAt: null, rolloutId: null },
      transmission: { queueId: row.queue_id, queueStatus: row.queue_status, deliveryState: row.delivery_state,
        holdReason: row.hold_reason, classification: row.error_category, httpAttemptsStarted: row.http_attempts_started, httpRetryIndex: row.retry_index, nextEligibleAt: row.next_eligible_at,
        queuedAt: row.queued_at, legacyStatus: row.legacy_status, legacyObservedAt: row.legacy_at,
        knownRemoteSuccess: row.has_remote_success || row.delivery_state === 'KNOWN_SUCCESS' },
      actions: { retryQueue: false, retryQueueReason: applicable ? 'C2C_ROLLOUT_AND_CONVERTER_PARITY_REQUIRED' : 'NON_SEZ',
        inswResubmit: 'EXISTING_AUTHORIZED_WORKFLOW' },
    };
  });
}
