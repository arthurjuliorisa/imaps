import { countSourceId, readCountSource, verifyCountSource, type CountOperation } from './adjustment-stock-opname-source';
import { prepareCountHandoff } from '../insw-queue/incoming-handoff';
import { prepareIsolatedCountFinalizer } from './incoming-finalizer';
import type { PrismaClient } from '@prisma/client';
import { INSWIntegrationService } from '../services/insw-integration.service';
import { INSW_ENDPOINTS } from '../types/insw-api.types';
import { canonicalIdentity } from '../insw-queue/contracts';
import { prepareIncomingHandoff, prepareOutgoingHandoff, prepareMaterialUsageHandoff, prepareProductionOutputHandoff, handoffIncomingInTransaction } from '../insw-queue/incoming-handoff';
import { prepareIsolatedIncomingFinalizer, prepareIsolatedOutgoingFinalizer, prepareIsolatedMaterialUsageFinalizer, prepareIsolatedProductionOutputFinalizer } from './incoming-finalizer';
import { runIsolatedWorker } from './isolated-worker';

type PilotOperation = 'INCOMING' | 'OUTGOING' | 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT';

/** Explicit disposable fixtures only. No discovery, producer hooks or source writes. */
export async function isolatedIncomingPilot(db: PrismaClient, config: {
  authorization: 'DISPOSABLE_INCOMING_FIXTURES_ONLY'; sourceIds: readonly number[]; endpoint: string;
  fullyPersistedAdjustmentSourceIds?: readonly number[]; confirmedStockOpnameSourceIds?: readonly bigint[];
  outgoingSourceIds?: readonly number[]; materialUsageSourceIds?: readonly number[]; productionOutputSourceIds?: readonly number[];
}) {
  if (process.env.NODE_ENV !== 'test' || config.authorization !== 'DISPOSABLE_INCOMING_FIXTURES_ONLY') {
    throw new Error('EXPLICIT_ISOLATED_PILOT_AUTHORIZATION_REQUIRED');
  }
  const endpoint = new URL(config.endpoint);
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || !endpoint.port
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('LOOPBACK_HTTP_REQUIRED');
  const [runtime] = await db.$queryRaw<{ name: string; host: string | null }[]>`
    SELECT current_database() AS name, host(inet_server_addr()) AS host`;
  if (!/^[a-z0-9_]+_phase_c2b_test$/.test(runtime.name) || runtime.host !== '127.0.0.1') throw new Error('ISOLATED_TEST_ONLY');
  const incomingIds = new Set(config.sourceIds);
  const outgoingIds = new Set(config.outgoingSourceIds ?? []);
  const materialUsageIds = new Set(config.materialUsageSourceIds ?? []);
  const productionOutputIds = new Set(config.productionOutputSourceIds ?? []);
  const converter = new INSWIntegrationService('', '', true, db);
  const transport = new INSWIntegrationService('isolated-fixture-key', 'isolated-fixture-unique', true, db);
  async function source(operation: PilotOperation, company: number, id?: number, reference?: string) {
    if (![1370, 1380].includes(company)) throw new Error('SEZ_COMPANY_REQUIRED');
    const where = { ...(id === undefined ? {} : { id }),
      ...(reference === undefined ? {} : { wms_id: reference }), company_code: company, deleted_at: null,
      company: { company_type: 'SEZ' as const } };
    const rows = operation === 'INCOMING'
      ? (await db.incoming_goods.findMany({ where, take: 2 })).map(row => ({ ...row, businessDate: row.incoming_date, reversal: null }))
      : operation === 'OUTGOING'
        ? (await db.outgoing_goods.findMany({ where, take: 2 })).map(row => ({ ...row, businessDate: row.outgoing_date, reversal: null }))
        : operation === 'MATERIAL_USAGE'
          ? (await db.material_usages.findMany({ where, take: 2 })).map(row => ({ ...row, businessDate: row.transaction_date }))
          : (await db.production_outputs.findMany({ where, take: 2 })).map(row => ({ ...row, businessDate: row.transaction_date }));
    const authorized = { INCOMING: incomingIds, OUTGOING: outgoingIds, MATERIAL_USAGE: materialUsageIds, PRODUCTION_OUTPUT: productionOutputIds }[operation];
    if (rows.length !== 1 || !authorized.has(rows[0].id) || !rows[0].wms_id) throw new Error('AUTHORIZED_SOURCE_COMPANY_REQUIRED');
    return rows[0];
  }
  async function capture(operation: PilotOperation, companyCode: number, sourceId: number) {
    const row = await source(operation, companyCode, sourceId);
    // Reject same-company duplicate WMS references as well; no source splitting.
    await source(operation, companyCode, undefined, row.wms_id!);
    const identity = canonicalIdentity({ kind: 'WMS_REFERENCE', operation, companyCode,
      reference: row.wms_id!, revision: 'ACCEPTED_WMS_ID', businessDate: row.businessDate.toISOString().slice(0, 10) });
    const prior = await db.insw_queue_cycle.findFirst({ where: { identity_key: identity.key }, orderBy: { cycle: 'asc' } });
    if (prior) {
      if (prior.intent !== 'SOURCE_COMMIT' || prior.source_log_id !== null || prior.wms_reference !== row.wms_id) {
        throw new Error(`${operation}_PRIOR_CYCLE_CONFLICT`);
      }
      return { id: prior.id, created: false };
    }
    // Existing converter reads complete committed source + mapping in bulk.
    // No HTTP or source transaction; the pre-enqueue crash gap is accepted.
    const payload = operation === 'INCOMING'
      ? await converter.convertPemasukanToINSW(companyCode, [sourceId])
      : operation === 'OUTGOING' ? await converter.convertPengeluaranToINSWByIds(companyCode, [sourceId])
        : operation === 'MATERIAL_USAGE' ? await converter.convertMaterialUsageToINSW(companyCode, [sourceId])
          : await converter.convertProductionOutputToINSW(companyCode, [sourceId]);
    const prepare = { INCOMING: prepareIncomingHandoff, OUTGOING: prepareOutgoingHandoff,
      MATERIAL_USAGE: prepareMaterialUsageHandoff, PRODUCTION_OUTPUT: prepareProductionOutputHandoff }[operation];
    const prepared = prepare({ companyCode, wmsReference: row.wms_id!,
      businessDate: identity.businessDate, revision: 'ACCEPTED_WMS_ID',
      requestedBy: { INCOMING: 'ISOLATED_PHASE1_FIXTURE', OUTGOING: 'ISOLATED_PHASE2A_FIXTURE',
        MATERIAL_USAGE: 'ISOLATED_PHASE2B_MU_FIXTURE', PRODUCTION_OUTPUT: 'ISOLATED_PHASE2B_PO_FIXTURE' }[operation],
      payload, authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' }, row.reversal);
    return db.$transaction(tx => handoffIncomingInTransaction(tx, prepared));
  }
  async function captureCount(operation: CountOperation, company: number, id: number | bigint) {
    const exactId = countSourceId(id);
    const authorized = operation === 'ADJUSTMENT'
      ? config.fullyPersistedAdjustmentSourceIds?.some(value => value === exactId)
      : config.confirmedStockOpnameSourceIds?.some(value => value === BigInt(exactId));
    if (!authorized) throw new Error('EXPLICIT_FULLY_PERSISTED_SOURCE_AUTHORIZATION_REQUIRED');
    const row = await readCountSource(db, operation, company, id);
    const identity = canonicalIdentity({ kind: 'SOURCE_HEADER', operation, companyCode: company,
      sourceId: exactId, revision: row.revision, businessDate: row.businessDate });
    const prior = await db.insw_queue_cycle.findFirst({ where: { identity_key: identity.key }, orderBy: { cycle: 'asc' } });
    if (prior) {
      if (prior.intent !== 'SOURCE_COMMIT' || prior.source_log_id !== null || prior.wms_reference !== row.reference) throw new Error('COUNT_PRIOR_CYCLE_CONFLICT');
      return { id: prior.id, created: false };
    }
    const payload = operation === 'ADJUSTMENT'
      ? await converter.convertAdjustmentToINSW(company, exactId) : await converter.convertStockOpnameToINSW(company, exactId);
    const prepared = prepareCountHandoff({ companyCode: company, operation, sourceId: exactId, wmsReference: row.reference,
      revision: row.revision, businessDate: row.businessDate, requestedBy: 'ISOLATED_PHASE2C_FIXTURE', payload,
      authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' });
    return db.$transaction(tx => handoffIncomingInTransaction(tx, prepared));
  }
  return {
    captureAdjustment: (company: number, id: number) => captureCount('ADJUSTMENT', company, id),
    captureStockOpname: (company: number, id: bigint) => captureCount('STOCK_OPNAME', company, id),
    capture: (company: number, id: number) => capture('INCOMING', company, id),
    captureOutgoing: (company: number, id: number) => capture('OUTGOING', company, id),
    captureMaterialUsage: (company: number, id: number) => capture('MATERIAL_USAGE', company, id),
    captureProductionOutput: (company: number, id: number) => capture('PRODUCTION_OUTPUT', company, id),
    run(options: { signal: AbortSignal; maxJobs: number; timeoutMs?: number;
      onEvent?: (event: string, data?: unknown) => void }) {
      return runIsolatedWorker({ db, ...options, minimumIntervalMs: 3600, timeoutMs: options.timeoutMs ?? 10000,
        prepareFinalizer: async (token, job) => {
          if (job.operation === 'ADJUSTMENT' || job.operation === 'STOCK_OPNAME') {
            const row = await verifyCountSource(db, job);
            const authorized = job.operation === 'ADJUSTMENT'
              ? config.fullyPersistedAdjustmentSourceIds?.includes(row.id)
              : config.confirmedStockOpnameSourceIds?.includes(BigInt(row.id));
            if (!authorized) throw new Error('EXPLICIT_FULLY_PERSISTED_SOURCE_AUTHORIZATION_REQUIRED');
            return prepareIsolatedCountFinalizer(db, token, job, { endpointUrl: endpoint.toString() });
          }
          if (!['INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT'].includes(job.operation)) throw new Error('UNSUPPORTED_ISOLATED_DOMAIN');
          await source(job.operation as PilotOperation, job.company_code, undefined, job.wms_reference ?? '');
          const prepare = { INCOMING: prepareIsolatedIncomingFinalizer, OUTGOING: prepareIsolatedOutgoingFinalizer,
            MATERIAL_USAGE: prepareIsolatedMaterialUsageFinalizer, PRODUCTION_OUTPUT: prepareIsolatedProductionOutputFinalizer }[job.operation as PilotOperation];
          return prepare(db, token, job, { endpointUrl: endpoint.toString() });
        },
        request: (body, signal) => transport.requestFrozenTransaction(body, signal, async (target, init) => {
          if (target !== INSW_ENDPOINTS.transaksi.temp) throw new Error('UNEXPECTED_ENDPOINT_MODE');
          // Literal loopback, no proxy, no redirects. Preserve existing headers,
          // method and frozen body; remote endpoint is evidence only in this pilot.
          return fetch(endpoint, { ...init, redirect: 'error' });
        }),
      });
    },
  };
}
