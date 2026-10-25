import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type insw_queue_cycle } from '@prisma/client';
import { boundedText, canonicalIdentity } from './contracts';
import { readPolicy } from './policy.repository';
import { captureCompletedWmsSource } from '../insw-worker/completed-source-capture';

export class IncomingAdmissionError extends Error {}

export function incomingResendEligible(cycle: Pick<insw_queue_cycle,
  'status' | 'delivery_state' | 'retry_index' | 'max_auto_retry_snapshot' | 'owner_token' | 'lease_until'> | null) {
  return !!cycle && cycle.status === 'FAILED' && cycle.delivery_state === 'KNOWN_FAILURE'
    && cycle.retry_index >= cycle.max_auto_retry_snapshot && cycle.owner_token === null && cycle.lease_until === null;
}

/** HTTP selections establish origin through existing WMS acceptance/recovery logs,
 * or an existing trusted source-completion cycle. A selected ID alone proves nothing.
 * Resolve all headers and ambiguity in one bounded read; converters retain one original each.
 */
export async function submitIncomingOriginals(db: PrismaClient, companyCode: number, selections: unknown, requestedBy: string) {
  if (![1370, 1380].includes(companyCode)) throw new IncomingAdmissionError('SEZ_COMPANY_REQUIRED');
  if (!Array.isArray(selections) || !selections.length || selections.length > 100
    || selections.some(id => typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647)) {
    throw new IncomingAdmissionError('Select 1 to 100 persisted Incoming IDs');
  }
  boundedText(requestedBy, 'request actor', 100);
  const ids = [...new Set(selections as number[])];
  const rows = await db.$queryRaw<{ id: number; wms_id: string; incoming_date: Date }[]>`
    SELECT g.id, g.wms_id, g.incoming_date FROM incoming_goods g
    JOIN companies c ON c.code = g.company_code AND c.company_type = 'SEZ'
    WHERE g.id IN (${Prisma.join(ids)}) AND g.company_code = ${companyCode} AND g.deleted_at IS NULL
      AND (SELECT count(*) FROM incoming_goods same_source WHERE same_source.company_code = g.company_code
        AND same_source.wms_id = g.wms_id AND same_source.deleted_at IS NULL) = 1
      AND NOT EXISTS (SELECT 1 FROM incoming_good_items i WHERE i.incoming_good_id = g.id AND i.item_type = 'SCRAP')
      AND (EXISTS (SELECT 1 FROM wms_transmission_logs w WHERE w.company_code = g.company_code AND w.wms_id = g.wms_id
        AND w.action IN ('WMS_PROCESS_INCOMING_GOODS', 'WMS_PROCESS_INCOMING_GOODS_RETRY') AND w.transmission_status = 'SUCCESS')
        OR EXISTS (SELECT 1 FROM insw_queue_cycle q WHERE q.company_code = g.company_code AND q.operation = 'INCOMING'
          AND q.wms_reference = g.wms_id AND q.business_date = to_char(g.incoming_date, 'YYYY-MM-DD')
          AND q.intent = 'SOURCE_COMMIT' AND q.source_log_id IS NULL))`;
  if (rows.length !== ids.length) throw new IncomingAdmissionError('Eligible persisted WMS Incoming originals required for every selection');
  const results: { source_id: number; queue_id?: string; status: string; message: string }[] = [];
  for (const row of rows) {
    try {
      const result = await captureCompletedWmsSource(db, { operation: 'INCOMING', sourceId: row.id, companyCode,
        businessDate: row.incoming_date.toISOString().slice(0, 10), revision: 'ACCEPTED_WMS_ID', requestedBy,
        completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED' });
      results.push({ source_id: row.id, queue_id: result.id, status: result.created ? 'accepted' : 'already_captured',
        message: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Incoming manual queue capture refused or failed; no DIRECT fallback', { sourceId: row.id, message });
      results.push({ source_id: row.id, status: message === 'LEGACY_DELIVERY_REQUIRES_INVESTIGATION_OR_LOCAL_REPAIR'
        ? 'not_eligible' : 'capture_failed', message });
    }
  }
  // One latest-state projection for the whole selection, including manual cycles.
  const keys = rows.map(row => canonicalIdentity({ kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode,
    reference: row.wms_id, businessDate: row.incoming_date.toISOString().slice(0, 10), revision: 'ACCEPTED_WMS_ID' }).key);
  const latest = await db.$queryRaw<{ id: string; identity_key: string; status: string }[]>`SELECT DISTINCT ON (identity_key)
    id, identity_key, status FROM insw_queue_cycle WHERE identity_key IN (${Prisma.join(keys)}) ORDER BY identity_key, cycle DESC`;
  const byKey = new Map(latest.map(row => [row.identity_key, row]));
  const byId = new Map(rows.map((row, index) => [row.id, byKey.get(keys[index])]));
  for (const result of results) {
    const cycle = byId.get(result.source_id);
    if (result.status === 'already_captured') {
      result.status = cycle && ['READY', 'CLAIMED'].includes(cycle.status) ? 'already_pending' : 'not_eligible';
    }
    if (cycle) result.queue_id = cycle.id;
  }
  return { success: results.every(r => r.status === 'accepted' || r.status === 'already_pending'), status: results.some(r => r.status === 'accepted') ? 'accepted'
    : results.some(r => r.status === 'already_pending') ? 'already_pending' : results.some(r => r.status === 'capture_failed') ? 'capture_failed' : 'not_eligible',
    message: 'Queue acceptance is not remote INSW delivery; terminal or held originals require separate handling.',
    total: results.length, accepted_count: results.filter(r => r.status === 'accepted').length,
    failed_count: results.filter(r => r.status === 'capture_failed').length, results };
}

/** Sole successor entry: resolves a specific failed attempt log, copies its frozen
 * cycle, and audits explicit operator intent. Never accepts a replacement payload/identity.
 */
export async function resendIncomingLog(db: PrismaClient, companyCode: number, logId: bigint, operator: string, reason: string) {
  boundedText(operator, 'operator', 100); boundedText(reason, 'resend reason', 500);
  return db.$transaction(async tx => {
    const log = await tx.insw_tracking_log.findFirst({ where: { id: logId, company_code: companyCode,
      transaction_type: 'incoming' }, select: { id: true, insw_status: true, transaction_id: true, metadata: true, queue_attempt: { include: { queue: { select: { id: true, operation: true, company_code: true,
        identity_key: true, wms_reference: true, business_date: true } } } } } });
    const prior = log?.queue_attempt?.queue;
    if (!log || log.insw_status !== 'FAILED' || !prior || prior.operation !== 'INCOMING'
      || prior.company_code !== companyCode || ![1370, 1380].includes(companyCode)) throw new IncomingAdmissionError('Definitively failed queue attempt required');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${prior.identity_key}, 0))::text`;
    // Lock the actual latest row as well: worker claims use row locks, not this advisory lock.
    const [latest] = await tx.$queryRaw<(Pick<insw_queue_cycle, 'id' | 'status' | 'delivery_state' | 'retry_index' | 'max_auto_retry_snapshot' | 'owner_token' | 'lease_until'>)[]>`SELECT id, status, delivery_state, retry_index, max_auto_retry_snapshot, owner_token, lease_until FROM insw_queue_cycle
      WHERE identity_key = ${prior.identity_key} ORDER BY cycle DESC LIMIT 1 FOR UPDATE`;
    if (!latest || latest.id !== prior.id || !incomingResendEligible(latest)) throw new IncomingAdmissionError('Original delivery is not definitively failed with exhausted retries');
    const source = await tx.incoming_goods.findMany({ where: { company_code: companyCode, wms_id: prior.wms_reference!,
      deleted_at: null, company: { company_type: 'SEZ' } }, take: 2, select: { id: true, incoming_date: true, wms_id: true } });
    if (source.length !== 1 || source[0].id !== log.transaction_id || source[0].incoming_date.toISOString().slice(0, 10) !== prior.business_date
      || prior.identity_key !== canonicalIdentity({ kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode,
        reference: source[0].wms_id, businessDate: prior.business_date, revision: 'ACCEPTED_WMS_ID' }).key) {
      throw new IncomingAdmissionError('Original source association no longer eligible');
    }
    const policy = await readPolicy(tx);
    const [cycle] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO insw_queue_cycle
      (id, company_code, operation, identity_key, source_revision, business_date, wms_reference,
       cycle, intent, requested_by, source_log_id, frozen_payload, payload_sha256, max_auto_retry_snapshot)
      SELECT ${randomUUID()}::uuid, company_code, operation, identity_key, source_revision, business_date, wms_reference,
        cycle + 1, 'MANUAL_RESUBMIT', ${operator}, ${logId}, frozen_payload, payload_sha256, ${Math.min(10, policy.max_auto_retry)}
      FROM insw_queue_cycle WHERE id = ${prior.id}::uuid RETURNING id`;
    const metadata = log.metadata && typeof log.metadata === 'object' && !Array.isArray(log.metadata) ? log.metadata : {};
    await tx.insw_tracking_log.update({ where: { id: logId }, data: { metadata: {
      ...metadata, manual_resend: { operator, reason, queue_id: cycle.id, prior_queue_id: prior.id, authorized_at: new Date().toISOString() },
    } } });
    return { success: true, status: 'accepted', message: 'Frozen Incoming delivery cycle accepted in queue; not yet delivered to INSW.', queue_id: cycle.id };
  });
}

/** Finalizer repeats the manual-only admission evidence before any HTTP starts. */
export async function verifyIncomingManualCycle(db: PrismaClient, cycle: Pick<insw_queue_cycle,
  'id' | 'source_log_id' | 'identity_key' | 'cycle' | 'payload_sha256' | 'company_code'>) {
  if (!cycle.source_log_id) throw new Error('MANUAL_RESEND_SOURCE_LOG_REQUIRED');
  const log = await db.insw_tracking_log.findFirst({ where: { id: cycle.source_log_id,
    company_code: cycle.company_code, transaction_type: 'incoming', insw_status: 'FAILED' },
    select: { metadata: true, queue_attempt: { select: { queue: { select: { status: true, delivery_state: true,
      retry_index: true, max_auto_retry_snapshot: true, owner_token: true, lease_until: true, identity_key: true, cycle: true, payload_sha256: true } } } } } });
  const parent = log?.queue_attempt?.queue;
  if (!parent || !incomingResendEligible(parent) || parent.identity_key !== cycle.identity_key
    || parent.cycle + 1 !== cycle.cycle || parent.payload_sha256 !== cycle.payload_sha256
    || (log?.metadata as { manual_resend?: { queue_id?: string } } | null)?.manual_resend?.queue_id !== cycle.id) {
    throw new Error('INVALID_INCOMING_MANUAL_SUCCESSOR');
  }
}

/** Bounded page/detail projection only; API resend repeats all checks under locks. */
export async function incomingLogResendEligibility(db: PrismaClient, companyCode: number, ids: bigint[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.$queryRaw<{ id: bigint }[]>`SELECT l.id FROM insw_tracking_log l
    JOIN insw_queue_attempt a ON a.id = l.queue_attempt_id JOIN insw_queue_cycle p ON p.id = a.queue_id
    WHERE l.id IN (${Prisma.join(ids)}) AND l.company_code = ${companyCode} AND l.transaction_type = 'incoming'
      AND l.insw_status = 'FAILED' AND p.operation = 'INCOMING' AND p.company_code = l.company_code
      AND p.status = 'FAILED' AND p.delivery_state = 'KNOWN_FAILURE' AND p.retry_index >= p.max_auto_retry_snapshot
      AND p.owner_token IS NULL AND p.lease_until IS NULL AND p.company_code IN (1370, 1380)
      AND p.source_revision = 'ACCEPTED_WMS_ID'
      AND p.identity_key = concat('["insw-v1",', p.company_code, ',"INCOMING","WMS_REFERENCE",',
        to_json(p.wms_reference)::text, ',"ACCEPTED_WMS_ID",', to_json(p.business_date)::text, ']')
      AND (SELECT count(*) FROM incoming_goods same_source WHERE same_source.company_code = p.company_code
        AND same_source.wms_id = p.wms_reference AND same_source.deleted_at IS NULL) = 1
      AND NOT EXISTS (SELECT 1 FROM insw_queue_cycle newer WHERE newer.identity_key = p.identity_key AND newer.cycle > p.cycle)
      AND EXISTS (SELECT 1 FROM incoming_goods g JOIN companies c ON c.code = g.company_code
        WHERE g.id = l.transaction_id AND g.company_code = p.company_code AND c.company_type = 'SEZ'
          AND g.wms_id = p.wms_reference AND to_char(g.incoming_date, 'YYYY-MM-DD') = p.business_date AND g.deleted_at IS NULL)`;
  return new Set(rows.map(row => row.id.toString()));
}
