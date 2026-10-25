import type { PrismaClient } from '@prisma/client';
import { resolveInswCompanyConfig } from '../config/insw-company-config';
import { INSWIntegrationService } from '../services/insw-integration.service';
import { INSW_ENDPOINTS } from '../types/insw-api.types';
import { prepareWmsFinalizer } from './incoming-finalizer';
import { runIsolatedWorker } from './isolated-worker';

const operations = ['INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME'] as const;

// The same engine as the disposable pilot, with company configuration and the
// established transport builder. No capture, converters or source writes.
export async function runProductionDispatcher(input: {
  db: PrismaClient; signal: AbortSignal; timeoutMs?: number; maxJobs?: number;
  onEvent?: (event: string, data?: unknown) => void;
  // Explicit test seam, never supplied by the CLI. Must keep the built request.
  transport?: (endpoint: string, init: RequestInit) => Promise<Response>;
}) {
  const companies = [1370, 1380].map(code => {
    const config = resolveInswCompanyConfig(code);
    return [code, { endpoint: config.useTestMode ? INSW_ENDPOINTS.transaksi.temp : INSW_ENDPOINTS.transaksi.real,
      service: new INSWIntegrationService(config.apiKey, config.uniqueKey, config.useTestMode, input.db) }] as const;
  });
  const services = new Map(companies);
  let active: typeof companies[number][1] | undefined;
  return runIsolatedWorker({ ...input, tracksInvocationStart: true, minimumIntervalMs: 3600, timeoutMs: input.timeoutMs ?? 60000,
    prepareFinalizer: async (token, job) => {
      active = undefined;
      const company = services.get(job.company_code);
      const operation = operations.find(value => value === job.operation);
      if (!company || !operation) throw new Error('UNSUPPORTED_WMS_QUEUE_JOB');
      const finalizer = await prepareWmsFinalizer(input.db, token, job, { endpointUrl: company.endpoint }, operation);
      active = company;
      return finalizer;
    },
    request: (body, signal, onInvoked) => {
      if (!active) throw new Error('VALIDATED_COMPANY_REQUIRED');
      return active.service.requestFrozenTransaction(body, signal, input.transport, onInvoked);
    },
  });
}
