import type { PrismaClient } from '@prisma/client';
import { resolveInswCompanyConfig } from '../config/insw-company-config';
import { resolveWorkerAllowedCompanies, validateWorkerAllowedCompanies } from '../config/insw-worker-config';
import { INSWIntegrationService } from '../services/insw-integration.service';
import { INSW_ENDPOINTS } from '../types/insw-api.types';
import { prepareWmsFinalizer } from './incoming-finalizer';
import { runIsolatedWorker } from './isolated-worker';
import { resolveWorkerTestEndpoint, workerDispatchTransport } from './test-endpoint';

const operations = ['INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME'] as const;

// The same engine as the disposable pilot, with company configuration and the
// established transport builder. No capture, converters or source writes.
export async function runProductionDispatcher(input: {
  db: PrismaClient; signal: AbortSignal; timeoutMs?: number; maxJobs?: number;
  allowedCompanies?: readonly number[];
  onEvent?: (event: string, data?: unknown) => void;
  // Explicit test seam, never supplied by the CLI. Must keep the built request.
  transport?: (endpoint: string, init: RequestInit) => Promise<Response>;
  // Optional caller-owned sender telemetry. No environment activation or faults.
  beforePost?: (endpoint: string, job: { id: string; wms_reference: string | null; company_code: number; attemptId: string; retry_index: number; max_auto_retry_snapshot: number }) => void;
}) {
  const allowedCompanies = input.allowedCompanies === undefined ? resolveWorkerAllowedCompanies()
    : validateWorkerAllowedCompanies(input.allowedCompanies);
  const testEndpoint = resolveWorkerTestEndpoint();
  const transport = workerDispatchTransport(testEndpoint, input.transport);
  const companies = allowedCompanies.map(code => {
    const config = resolveInswCompanyConfig(code);
    if (testEndpoint && !config.useTestMode) throw new Error('INSW_WORKER_TEST_REQUIRES_SANDBOX_COMPANY');
    return [code, { endpoint: testEndpoint ?? (config.useTestMode ? INSW_ENDPOINTS.transaksi.temp : INSW_ENDPOINTS.transaksi.real),
      service: new INSWIntegrationService(config.apiKey, config.uniqueKey, config.useTestMode, input.db) }] as const;
  });
  const services = new Map<number, typeof companies[number][1]>(companies);
  for (const [companyCode, company] of companies) input.onEvent?.('WORKER_TARGET', {
    companyCode, endpoint: company.endpoint, testOverride: Boolean(testEndpoint),
  });
  let active: typeof companies[number][1] | undefined;
  let activeJob: { id: string; wms_reference: string | null; company_code: number; attemptId: string; retry_index: number; max_auto_retry_snapshot: number } | undefined;
  return runIsolatedWorker({ ...input, allowedCompanies, tracksInvocationStart: true, minimumIntervalMs: 3600, timeoutMs: input.timeoutMs ?? 60000,
    prepareFinalizer: async (token, job) => {
      active = undefined;
      const company = services.get(job.company_code);
      const operation = operations.find(value => value === job.operation);
      if (!company || !operation) throw new Error('UNSUPPORTED_WMS_QUEUE_JOB');
      const finalizer = await prepareWmsFinalizer(input.db, token, job, { endpointUrl: company.endpoint }, operation);
      active = company;
      activeJob = job;
      return finalizer;
    },
    request: (body, signal, onInvoked) => {
      if (!active) throw new Error('VALIDATED_COMPANY_REQUIRED');
      return active.service.requestFrozenTransaction(body, signal, transport, onInvoked,
        input.beforePost ? () => input.beforePost!(active!.endpoint, activeJob!) : undefined);
    },
  });
}
