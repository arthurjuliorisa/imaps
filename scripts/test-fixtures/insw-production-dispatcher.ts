import { PrismaClient } from '@prisma/client';
import { runProductionDispatcher } from '../../lib/insw-worker/production-dispatcher';
import { resolveWorkerAllowedCompanies } from '../../lib/config/insw-worker-config';
const url = new URL(process.env.INSW_OUTCOME_TEST_DATABASE_URL ?? 'invalid:');
const endpoint = new URL(process.env.INSW_SYNTHETIC_ENDPOINT ?? 'invalid:');
if (process.env.NODE_ENV !== 'test' || url.hostname !== '127.0.0.1'
  || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(url.pathname) || url.search || url.hash
  || endpoint.hostname !== '127.0.0.1' || endpoint.protocol !== 'http:') throw new Error('DISPOSABLE_LOOPBACK_ONLY');
for (const code of resolveWorkerAllowedCompanies()) {
  process.env[`INSW_${code}_USE_TEST_MODE`] = 'true';
  process.env[`INSW_${code}_API_KEY`] = `synthetic-${code}`;
  process.env[`INSW_${code}_UNIQUE_KEY_TEST`] = 'synthetic-unique';
}
const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const stop = new AbortController();
process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
process.once('message', async (m: { maxJobs: number }) => {
  try {
    await runProductionDispatcher({ db, signal: stop.signal, maxJobs: m.maxJobs,
      transport: (_target, init) => fetch(endpoint, { ...init, redirect: 'error' }),
      onEvent: (event, data) => process.send?.({ event, data }) });
  } catch { process.send?.({ event: 'blocked' }); process.exitCode = 78; }
  finally { await db.$disconnect(); process.disconnect?.(); }
});
