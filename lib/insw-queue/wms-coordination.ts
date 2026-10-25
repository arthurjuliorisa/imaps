import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type insw_queue_cycle } from '@prisma/client';
import { boundedText, canonicalIdentity } from './contracts';
import { readPolicy } from './policy.repository';
import { captureCompletedWmsSource } from '../insw-worker/completed-source-capture';

export class WmsAdmissionError extends Error {}
export const wmsLogTypes = ['incoming', 'outgoing', 'material_usage', 'production_output', 'adjustment', 'stock_opname'] as const;
export function wmsResendEligible(cycle: Pick<insw_queue_cycle,
  'status' | 'delivery_state' | 'retry_index' | 'max_auto_retry_snapshot' | 'owner_token' | 'lease_until'> | null) {
  return !!cycle && cycle.status === 'FAILED' && cycle.delivery_state === 'KNOWN_FAILURE'
    && cycle.retry_index >= cycle.max_auto_retry_snapshot && cycle.owner_token === null && cycle.lease_until === null;
}

/** Correlated to p and l; bounded page/one-log association checks, never a replay scan. */
function originalAssociation() {
  const goods = [
    ['INCOMING', 'incoming_goods', 'incoming_date'], ['OUTGOING', 'outgoing_goods', 'outgoing_date'],
    ['MATERIAL_USAGE', 'material_usages', 'transaction_date'], ['PRODUCTION_OUTPUT', 'production_outputs', 'transaction_date'],
  ].map(([operation, table, date]) => Prisma.sql`(p.operation::text = ${operation}
    AND p.source_revision = 'ACCEPTED_WMS_ID'
    AND p.identity_key = concat('["insw-v1",', p.company_code, ',"', p.operation::text, '","WMS_REFERENCE",',
      to_json(p.wms_reference)::text, ',"ACCEPTED_WMS_ID",', to_json(p.business_date)::text, ']')
    AND (SELECT count(*) FROM ${Prisma.raw(table)} g WHERE g.company_code = p.company_code
      AND g.wms_id = p.wms_reference AND g.deleted_at IS NULL) = 1
    AND EXISTS (SELECT 1 FROM ${Prisma.raw(table)} g WHERE g.id = l.transaction_id AND g.company_code = p.company_code
      AND g.wms_id = p.wms_reference AND g.deleted_at IS NULL AND to_char(g.${Prisma.raw(date)}, 'YYYY-MM-DD') = p.business_date
      ${operation === 'OUTGOING' ? Prisma.sql`AND g.scrap_transaction_id IS NULL` : Prisma.empty}))`);
  return Prisma.sql`(${Prisma.join(goods, ' OR ')} OR (
    p.operation = 'ADJUSTMENT' AND p.source_revision = 'COMMITTED_SOURCE'
    AND EXISTS (SELECT 1 FROM adjustments g WHERE g.id = l.transaction_id AND g.company_code = p.company_code
      AND g.wms_id = p.wms_reference AND g.deleted_at IS NULL AND to_char(g.transaction_date, 'YYYY-MM-DD') = p.business_date
      AND p.identity_key = concat('["insw-v1",', p.company_code, ',"ADJUSTMENT","SOURCE_HEADER",',
        to_json(g.id::text)::text, ',"COMMITTED_SOURCE",', to_json(p.business_date)::text, ']'))
    ) OR (p.operation = 'STOCK_OPNAME' AND EXISTS (
      SELECT 1 FROM wms_stock_opnames g WHERE g.id = l.transaction_id AND g.id BETWEEN 1 AND 2147483647
        AND g.company_code = p.company_code AND g.wms_id = p.wms_reference AND g.status = 'CONFIRMED' AND g.confirmed_at IS NOT NULL
        AND to_char(g.document_date, 'YYYY-MM-DD') = p.business_date
        AND p.source_revision = concat('CONFIRMED:', to_char(g.confirmed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        AND p.identity_key = concat('["insw-v1",', p.company_code, ',"STOCK_OPNAME","SOURCE_HEADER",',
          to_json(g.id::text)::text, ',', to_json(p.source_revision)::text, ',', to_json(p.business_date)::text, ']'))))`;
}

export async function wmsLogResendEligibility(db: PrismaClient | Prisma.TransactionClient, companyCode: number, ids: bigint[]) {
  if (!ids.length) return new Set<string>();
  const rows = await db.$queryRaw<{ id: bigint }[]>(Prisma.sql`SELECT l.id FROM insw_tracking_log l
    JOIN insw_queue_attempt a ON a.id = l.queue_attempt_id JOIN insw_queue_cycle p ON p.id = a.queue_id
    JOIN companies c ON c.code = p.company_code AND c.company_type = 'SEZ'
    WHERE l.id IN (${Prisma.join(ids)}) AND l.company_code = ${companyCode}
      AND l.transaction_type = lower(p.operation::text) AND p.operation::text IN (${Prisma.join([...wmsLogTypes].map(t => t.toUpperCase()))})
      AND l.insw_status = 'FAILED' AND p.company_code = l.company_code AND p.company_code IN (1370, 1380)
      AND p.status = 'FAILED' AND p.delivery_state = 'KNOWN_FAILURE' AND p.retry_index >= p.max_auto_retry_snapshot
      AND p.owner_token IS NULL AND p.lease_until IS NULL
      AND NOT EXISTS (SELECT 1 FROM insw_queue_cycle newer WHERE newer.identity_key = p.identity_key AND newer.cycle > p.cycle)
      AND ${originalAssociation()}`);
  return new Set(rows.map(row => row.id.toString()));
}

/** Copies the failed frozen request under C1's identity and latest-row locks. */
export async function resendWmsLog(db: PrismaClient, companyCode: number, logId: bigint, operator: string, reason: string) {
  boundedText(operator, 'operator', 100); boundedText(reason, 'resend reason', 500);
  return db.$transaction(async tx => {
    const log = await tx.insw_tracking_log.findFirst({ where: { id: logId, company_code: companyCode },
      select: { metadata: true, queue_attempt: { select: { queue: { select: { id: true, identity_key: true } } } } } });
    const prior = log?.queue_attempt?.queue;
    if (!prior) throw new WmsAdmissionError('Definitively failed queue attempt required');
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${prior.identity_key}, 0))::text`;
    const [latest] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM insw_queue_cycle
      WHERE identity_key = ${prior.identity_key} ORDER BY cycle DESC LIMIT 1 FOR UPDATE`;
    if (latest?.id !== prior.id || !(await wmsLogResendEligibility(tx, companyCode, [logId])).has(logId.toString())) {
      throw new WmsAdmissionError('Original delivery is not definitively failed with exhausted retries');
    }
    const policy = await readPolicy(tx);
    const [cycle] = await tx.$queryRaw<{ id: string }[]>`INSERT INTO insw_queue_cycle
      (id, company_code, operation, identity_key, source_revision, business_date, wms_reference,
       cycle, intent, requested_by, source_log_id, frozen_payload, payload_sha256, max_auto_retry_snapshot)
      SELECT ${randomUUID()}::uuid, company_code, operation, identity_key, source_revision, business_date, wms_reference,
        cycle + 1, 'MANUAL_RESUBMIT', ${operator}, ${logId}, frozen_payload, payload_sha256, ${Math.min(10, policy.max_auto_retry)}
      FROM insw_queue_cycle WHERE id = ${prior.id}::uuid RETURNING id`;
    const metadata = log!.metadata && typeof log!.metadata === 'object' && !Array.isArray(log!.metadata) ? log!.metadata : {};
    await tx.insw_tracking_log.update({ where: { id: logId }, data: { metadata: {
      ...metadata, manual_resend: { operator, reason, queue_id: cycle.id, prior_queue_id: prior.id, authorized_at: new Date().toISOString() },
    } } });
    return { success: true, status: 'accepted', message: 'Frozen WMS delivery cycle accepted in queue; not yet delivered to INSW.', queue_id: cycle.id };
  });
}

export async function verifyWmsManualCycle(db: PrismaClient, cycle: Pick<insw_queue_cycle,
  'id' | 'operation' | 'source_log_id' | 'identity_key' | 'cycle' | 'payload_sha256' | 'company_code'>) {
  if (!cycle.source_log_id) throw new Error('MANUAL_RESEND_SOURCE_LOG_REQUIRED');
  const log = await db.insw_tracking_log.findFirst({ where: { id: cycle.source_log_id, company_code: cycle.company_code,
    transaction_type: cycle.operation.toLowerCase(), insw_status: 'FAILED' },
    select: { metadata: true, queue_attempt: { select: { queue: { select: { status: true, delivery_state: true,
      retry_index: true, max_auto_retry_snapshot: true, owner_token: true, lease_until: true, identity_key: true, cycle: true, payload_sha256: true } } } } } });
  const parent = log?.queue_attempt?.queue;
  if (!parent || !wmsResendEligible(parent) || parent.identity_key !== cycle.identity_key || parent.cycle + 1 !== cycle.cycle
    || parent.payload_sha256 !== cycle.payload_sha256
    || (log?.metadata as { manual_resend?: { queue_id?: string } } | null)?.manual_resend?.queue_id !== cycle.id) {
    throw new Error('INVALID_WMS_MANUAL_SUCCESSOR');
  }
}

/** Outgoing ID selection is never authority: require an existing trusted capture
 * or WMS acceptance log, then use the same exact reference/date resolver. */
export async function submitOutgoingOriginals(db: PrismaClient, companyCode: number, selections: unknown, byReference: boolean, actor: string) {
  if (![1370, 1380].includes(companyCode)) throw new WmsAdmissionError('SEZ_COMPANY_REQUIRED');
  if (!Array.isArray(selections) || !selections.length || selections.length > 100
    || selections.some(id => byReference ? typeof id !== 'string' || !id.trim() || id.length > 100
      : typeof id !== 'number' || !Number.isSafeInteger(id) || id < 1 || id > 2147483647)) throw new WmsAdmissionError('Select 1 to 100 persisted WMS originals');
  boundedText(actor, 'request actor', 100);
  const values = [...new Set(selections)];
  const rows = await db.$queryRaw<{ id: number; wms_id: string; outgoing_date: Date }[]>(Prisma.sql`
    SELECT g.id, g.wms_id, g.outgoing_date FROM outgoing_goods g JOIN companies c ON c.code = g.company_code AND c.company_type = 'SEZ'
    WHERE g.company_code = ${companyCode} AND ${byReference ? Prisma.sql`g.wms_id IN (${Prisma.join(values)})` : Prisma.sql`g.id IN (${Prisma.join(values)})`}
      AND g.deleted_at IS NULL AND g.scrap_transaction_id IS NULL
      AND (SELECT count(*) FROM outgoing_goods s WHERE s.company_code = g.company_code AND s.wms_id = g.wms_id AND s.deleted_at IS NULL) = 1
      AND (EXISTS (SELECT 1 FROM wms_transmission_logs w WHERE w.company_code = g.company_code AND w.wms_id = g.wms_id
        AND w.action IN ('WMS_PROCESS_OUTGOING_GOODS', 'WMS_PROCESS_OUTGOING_GOODS_RETRY') AND w.transmission_status = 'SUCCESS')
        OR EXISTS (SELECT 1 FROM insw_queue_cycle q WHERE q.company_code = g.company_code AND q.operation = 'OUTGOING'
          AND q.wms_reference = g.wms_id AND q.business_date = to_char(g.outgoing_date, 'YYYY-MM-DD') AND q.intent = 'SOURCE_COMMIT' AND q.source_log_id IS NULL))`);
  if (rows.length !== values.length) throw new WmsAdmissionError('Eligible persisted WMS Outgoing originals required for every selection');
  const results: { source_id: number; queue_id?: string; status: string; message: string }[] = [];
  for (const row of rows) {
    try {
      const result = await captureCompletedWmsSource(db, { operation: 'OUTGOING', companyCode, wmsReference: row.wms_id,
        businessDate: row.outgoing_date.toISOString().slice(0, 10), revision: 'ACCEPTED_WMS_ID', requestedBy: actor,
        completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED' });
      results.push({ source_id: row.id, queue_id: result.id, status: result.created ? 'accepted' : 'already_captured', message: '' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Outgoing manual capture failed; no DIRECT fallback', { sourceId: row.id, message });
      results.push({ source_id: row.id, status: message === 'LEGACY_DELIVERY_REQUIRES_INVESTIGATION_OR_LOCAL_REPAIR' ? 'not_eligible' : 'capture_failed', message });
    }
  }
  const keys = rows.map(row => canonicalIdentity({ kind: 'WMS_REFERENCE', operation: 'OUTGOING', companyCode,
    reference: row.wms_id, businessDate: row.outgoing_date.toISOString().slice(0, 10), revision: 'ACCEPTED_WMS_ID' }).key);
  const latest = await db.$queryRaw<{ id: string; identity_key: string; status: string }[]>`SELECT DISTINCT ON (identity_key)
    id, identity_key, status FROM insw_queue_cycle WHERE identity_key IN (${Prisma.join(keys)}) ORDER BY identity_key, cycle DESC`;
  const byKey = new Map(latest.map(row => [row.identity_key, row]));
  results.forEach((result, i) => {
    const cycle = byKey.get(keys[i]);
    if (result.status === 'already_captured') result.status = cycle && ['READY', 'CLAIMED'].includes(cycle.status) ? 'already_pending' : 'not_eligible';
    if (cycle) result.queue_id = cycle.id;
  });
  return { success: results.every(r => ['accepted', 'already_pending'].includes(r.status)),
    status: results.some(r => r.status === 'accepted') ? 'accepted' : results.some(r => r.status === 'already_pending') ? 'already_pending' : 'not_eligible',
    message: 'Queue acceptance is not remote INSW delivery; terminal or held originals require separate handling.', total: results.length,
    accepted_count: results.filter(r => r.status === 'accepted').length, failed_count: results.filter(r => r.status === 'capture_failed').length, results };
}
