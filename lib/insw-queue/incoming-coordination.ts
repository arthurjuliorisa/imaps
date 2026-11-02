import { Prisma, type PrismaClient } from '@prisma/client';
import { boundedText, canonicalIdentity } from './contracts';
import { captureCompletedWmsSource } from '../insw-worker/completed-source-capture';

export { WmsAdmissionError as IncomingAdmissionError, wmsResendEligible as incomingResendEligible,
  resendWmsLog as resendIncomingLog, wmsLogResendEligibility as incomingLogResendEligibility } from './wms-coordination';
import { WmsAdmissionError as IncomingAdmissionError } from './wms-coordination';

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
