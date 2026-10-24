import type { PrismaClient } from '@prisma/client';
import { INSWIntegrationService } from '../services/insw-integration.service';
import { INSW_ENDPOINTS } from '../types/insw-api.types';
import { canonicalIdentity } from '../insw-queue/contracts';
import { prepareIncomingHandoff, handoffIncomingInTransaction } from '../insw-queue/incoming-handoff';
import { prepareIsolatedIncomingFinalizer } from './incoming-finalizer';
import { runIsolatedWorker } from './isolated-worker';

/** Explicit disposable fixtures only. No discovery, producer hooks or source writes. */
export async function isolatedIncomingPilot(db: PrismaClient, config: {
  authorization: 'DISPOSABLE_INCOMING_FIXTURES_ONLY'; sourceIds: readonly number[]; endpoint: string;
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
  const authorized = new Set(config.sourceIds);
  const converter = new INSWIntegrationService('', '', true, db);
  const transport = new INSWIntegrationService('isolated-fixture-key', 'isolated-fixture-unique', true, db);
  async function source(company: number, id?: number, reference?: string) {
    if (![1370, 1380].includes(company)) throw new Error('SEZ_COMPANY_REQUIRED');
    const rows = await db.incoming_goods.findMany({ where: { ...(id === undefined ? {} : { id }),
      ...(reference === undefined ? {} : { wms_id: reference }), company_code: company, deleted_at: null,
      company: { company_type: 'SEZ' } }, take: 2 });
    if (rows.length !== 1 || !authorized.has(rows[0].id) || !rows[0].wms_id) throw new Error('AUTHORIZED_SOURCE_COMPANY_REQUIRED');
    return rows[0];
  }
  return {
    async capture(companyCode: number, sourceId: number) {
      const row = await source(companyCode, sourceId);
      // Reject same-company duplicate WMS references as well; no source splitting.
      await source(companyCode, undefined, row.wms_id!);
      const identity = canonicalIdentity({ kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode,
        reference: row.wms_id!, revision: 'ACCEPTED_WMS_ID', businessDate: row.incoming_date.toISOString().slice(0, 10) });
      const prior = await db.insw_queue_cycle.findFirst({ where: { identity_key: identity.key }, orderBy: { cycle: 'asc' } });
      if (prior) {
        if (prior.intent !== 'SOURCE_COMMIT' || prior.source_log_id !== null || prior.wms_reference !== row.wms_id) {
          throw new Error('INCOMING_PRIOR_CYCLE_CONFLICT');
        }
        return { id: prior.id, created: false };
      }
      // Existing converter reads complete committed source + mapping in bulk.
      // No HTTP or source transaction; the pre-enqueue crash gap is accepted.
      const payload = await converter.convertPemasukanToINSW(companyCode, [sourceId]);
      const prepared = prepareIncomingHandoff({ companyCode, wmsReference: row.wms_id!,
        businessDate: identity.businessDate, revision: 'ACCEPTED_WMS_ID', requestedBy: 'ISOLATED_PHASE1_FIXTURE',
        payload, authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' });
      return db.$transaction(tx => handoffIncomingInTransaction(tx, prepared));
    },
    run(options: { signal: AbortSignal; maxJobs: number; timeoutMs?: number;
      onEvent?: (event: string, data?: unknown) => void }) {
      return runIsolatedWorker({ db, ...options, minimumIntervalMs: 3600, timeoutMs: options.timeoutMs ?? 10000,
        prepareFinalizer: async (token, job) => {
          await source(job.company_code, undefined, job.wms_reference ?? '');
          return prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint.toString() });
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
