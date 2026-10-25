import type { Prisma, PrismaClient } from '@prisma/client';
import { INSWIntegrationService } from '../services/insw-integration.service';
import { countSourceId, readCountSource } from './adjustment-stock-opname-source';
import { boundedText, canonicalIdentity } from '../insw-queue/contracts';
import {
  handoffIncomingInTransaction, prepareIncomingHandoff, prepareOutgoingHandoff, prepareMaterialUsageHandoff,
  prepareProductionOutputHandoff, prepareCountHandoff,
} from '../insw-queue/incoming-handoff';

export type CompletedSourceCapture = {
  companyCode: number;
  businessDate: string;
  revision: string;
  requestedBy: string;
  completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED';
} & ({
  operation: 'INCOMING' | 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT' | 'ADJUSTMENT' | 'STOCK_OPNAME';
  sourceId: number | bigint | string;
} | {
  // Trusted internal WMS caller scope; never enroll Outgoing by arbitrary ID.
  operation: 'OUTGOING';
  wmsReference: string;
  sourceId?: never;
});

/** Internal completion API: invoke only after the existing WMS business promise
 * resolves, including its existing tolerated side-effect failures. The caller
 * declares completion; a visible header, HTTP 200 or arbitrary resolved promise
 * cannot prove it. This is an internal producer contract, not an HTTP endpoint.
 * Incoming is coordinated; other domain seams remain dormant. Queue acceptance is never remote success.
 * No worker, finalizer, generic enqueue/claim/recovery or HTTP sender is exposed.
 */
export async function captureCompletedWmsSource(db: PrismaClient, input: CompletedSourceCapture) {
  input = { ...input }; // retain declared scope across awaits
  if (input.completion !== 'EXISTING_BUSINESS_COMPLETION_RESOLVED') throw new Error('BUSINESS_COMPLETION_AUTHORIZATION_REQUIRED');
  if (!['INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME'].includes(input.operation)) {
    throw new Error('UNSUPPORTED_WMS_QUEUE_OPERATION');
  }
  if (![1370, 1380].includes(input.companyCode)) throw new Error('SEZ_COMPANY_REQUIRED');
  boundedText(input.requestedBy, 'request actor', 100);
  let id: number;
  if (input.operation === 'OUTGOING') {
    if (input.sourceId !== undefined) throw new Error('OUTGOING_REFERENCE_SCOPE_REQUIRED');
    boundedText(input.wmsReference, 'WMS reference', 100);
    // insertOutgoingGoodsAsync returns void. Resolve at most two matches across
    // dates, then require the declared date; never choose a reference alias.
    const matches = await db.outgoing_goods.findMany({ where: {
      company_code: input.companyCode, wms_id: input.wmsReference, deleted_at: null,
      company: { company_type: 'SEZ' },
    }, take: 2, select: { id: true, outgoing_date: true, scrap_transaction_id: true } });
    if (matches.length !== 1) throw new Error('AMBIGUOUS_OR_MISSING_COMPLETED_OUTGOING');
    const row = matches[0];
    if (row.scrap_transaction_id !== null) throw new Error('SCRAP_SOURCE_EXCLUDED');
    if (row.outgoing_date.toISOString().slice(0, 10) !== input.businessDate) throw new Error('SOURCE_DATE_OR_REVISION_MISMATCH');
    id = countSourceId(row.id);
  } else id = countSourceId(input.sourceId);
  const operation = input.operation;
  const outgoingReference = input.operation === 'OUTGOING' ? input.wmsReference : undefined;
  async function read(database: PrismaClient | Prisma.TransactionClient) {
    if (operation === 'ADJUSTMENT' || operation === 'STOCK_OPNAME') {
      return { ...await readCountSource(database, operation, input.companyCode, id), reversal: null };
    }
    const where = { id, company_code: input.companyCode, deleted_at: null, company: { company_type: 'SEZ' as const } };
    const row = operation === 'INCOMING'
      ? await database.incoming_goods.findFirst({ where }).then(r => r && ({ ...r, date: r.incoming_date, reversal: null }))
      : operation === 'OUTGOING'
        ? await database.outgoing_goods.findFirst({ where }).then(r => r && ({ ...r, date: r.outgoing_date, reversal: null }))
      : operation === 'MATERIAL_USAGE'
        ? await database.material_usages.findFirst({ where }).then(r => r && ({ ...r, date: r.transaction_date }))
        : await database.production_outputs.findFirst({ where }).then(r => r && ({ ...r, date: r.transaction_date }));
    if (!row) throw new Error('AUTHORIZED_COMPLETED_SOURCE_REQUIRED');
    if (operation === 'OUTGOING' && ('scrap_transaction_id' in row && row.scrap_transaction_id !== null || row.wms_id !== outgoingReference)) {
      throw new Error('AUTHORIZED_COMPLETED_SOURCE_REQUIRED');
    }
    boundedText(row.wms_id, 'WMS reference', 100);
    // Existing WMS_REFERENCE identity must identify exactly this original source,
    // including across dates. Never choose an arbitrary reference alias.
    const referenceWhere = { company_code: input.companyCode, wms_id: row.wms_id!, deleted_at: null };
    const matches = operation === 'INCOMING'
      ? await database.incoming_goods.findMany({ where: referenceWhere, take: 2, select: { id: true } })
      : operation === 'OUTGOING'
        ? await database.outgoing_goods.findMany({ where: referenceWhere, take: 2, select: { id: true } })
      : operation === 'MATERIAL_USAGE'
        ? await database.material_usages.findMany({ where: referenceWhere, take: 2, select: { id: true } })
        : await database.production_outputs.findMany({ where: referenceWhere, take: 2, select: { id: true } });
    if (matches.length !== 1 || matches[0].id !== id) throw new Error('AMBIGUOUS_ORIGINAL_SOURCE');
    return { id, reference: row.wms_id!, businessDate: row.date.toISOString().slice(0, 10),
      revision: 'ACCEPTED_WMS_ID', reversal: row.reversal };
  }
  const source = await read(db);
  if (source.businessDate !== input.businessDate || source.revision !== input.revision) throw new Error('SOURCE_DATE_OR_REVISION_MISMATCH');
  const identity = canonicalIdentity(operation === 'ADJUSTMENT' || operation === 'STOCK_OPNAME'
    ? { kind: 'SOURCE_HEADER', operation, companyCode: input.companyCode, sourceId: id, ...source }
    : { kind: 'WMS_REFERENCE', operation, companyCode: input.companyCode, ...source });
  const prior = await db.insw_queue_cycle.findFirst({ where: { identity_key: identity.key }, orderBy: { cycle: 'asc' },
    select: { id: true, intent: true, source_log_id: true, wms_reference: true } });
  if (prior) {
    if (prior.intent !== 'SOURCE_COMMIT' || prior.source_log_id !== null || prior.wms_reference !== source.reference) {
      throw new Error('PRIOR_SOURCE_CYCLE_CONFLICT');
    }
    return { outcome: 'ALREADY_CAPTURED' as const, id: prior.id, created: false };
  }
  if (operation === 'INCOMING') {
    const legacy = await db.insw_tracking_log.findFirst({ where: { company_code: input.companyCode,
      transaction_type: 'incoming', transaction_id: id, insw_status: { in: ['SUCCESS', 'PENDING', 'RETRYING', 'PENDING_RESOLVED', 'FAILED', 'SENT'] } }, select: { id: true } });
    if (legacy) throw new Error('LEGACY_DELIVERY_REQUIRES_INVESTIGATION_OR_LOCAL_REPAIR');
  }
  const converter = new INSWIntegrationService('', '', true, db);
  const payload = operation === 'INCOMING' ? await converter.convertPemasukanToINSW(input.companyCode, [id])
    : operation === 'OUTGOING' ? await converter.convertPengeluaranToINSWByIds(input.companyCode, [id])
    : operation === 'MATERIAL_USAGE' ? await converter.convertMaterialUsageToINSW(input.companyCode, [id])
      : operation === 'PRODUCTION_OUTPUT' ? await converter.convertProductionOutputToINSW(input.companyCode, [id])
        : operation === 'ADJUSTMENT' ? await converter.convertAdjustmentToINSW(input.companyCode, id)
          : await converter.convertStockOpnameToINSW(input.companyCode, id);
  const preparation = { companyCode: input.companyCode, wmsReference: source.reference, businessDate: source.businessDate,
    revision: source.revision, requestedBy: input.requestedBy, payload,
    authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' as const };
  const prepared = operation === 'INCOMING' ? prepareIncomingHandoff(preparation)
    : operation === 'OUTGOING' ? prepareOutgoingHandoff(preparation)
    : operation === 'MATERIAL_USAGE' ? prepareMaterialUsageHandoff(preparation, source.reversal)
      : operation === 'PRODUCTION_OUTPUT' ? prepareProductionOutputHandoff(preparation, source.reversal)
        : prepareCountHandoff({ ...preparation, operation, sourceId: id });
  const result = await db.$transaction(async tx => {
    // Recheck persisted eligibility/identity after conversion, before queue writes.
    const current = await read(tx);
    if (JSON.stringify(current) !== JSON.stringify(source)) throw new Error('SOURCE_CHANGED_DURING_CAPTURE');
    return handoffIncomingInTransaction(tx, prepared);
  });
  return { outcome: result.created ? 'CAPTURED' as const : 'ALREADY_CAPTURED' as const, id: result.id, created: result.created };
}
