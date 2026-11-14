import { startupDecision } from '../lib/insw-worker/safety';
import { resolveWorkerAllowedCompanies } from '../lib/config/insw-worker-config';
import { resolveWorkerTestEndpoint } from '../lib/insw-worker/test-endpoint';

// Disabled startup opens no database, transport, app singleton or .env file.
// PM2 supplies the explicit normal or loopback-test environment from its separate config.
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let decision = startupDecision(env);
  if (decision === 'DISABLED') {
    process.stdout.write('INSW worker disabled (default). No resources opened.\n');
    return 0;
  }
  try {
    if (resolveWorkerTestEndpoint(env)) decision = 'ENABLED';
  } catch {
    process.stderr.write('INSW_WORKER_TEST_ENDPOINT_REJECTED\n');
    return 78;
  }
  if (decision !== 'ENABLED' || !env.DATABASE_URL) {
    process.stderr.write('INSW worker requires production opt-in or valid loopback test mode, and DATABASE_URL.\n');
    return 78;
  }
  let allowedCompanies;
  try { allowedCompanies = resolveWorkerAllowedCompanies(env); }
  catch {
    process.stderr.write('INSW_WORKER_ALLOWED_COMPANIES requires an explicit valid supported-company subset.\n');
    return 78;
  }
  const recordWorkerRecoveryReadiness = ['development', 'staging'].includes(env.NEXT_PUBLIC_ENVIRONMENT_PHASE ?? '')
    ? (await import('../lib/insw-worker/recovery-readiness')).recordWorkerRecoveryReadiness : () => {};
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const { runProductionDispatcher } = await import('../lib/insw-worker/production-dispatcher');
    await runProductionDispatcher({ db, signal: stop.signal, allowedCompanies,
      onReady: token => recordWorkerRecoveryReadiness('ready', { token }, env),
      onEvent: (event, data) => {
        process.stdout.write(`${JSON.stringify({ event, data: event === 'owned' ? undefined : data })}\n`);
      },
    });
    return 0;
  } finally {
    await db.$disconnect();
    process.removeListener('SIGTERM', shutdown); process.removeListener('SIGINT', shutdown);
  }
}
if (require.main === module) main().then(code => { process.exitCode = code; }).catch(() => {
  process.stderr.write('INSW_WORKER_STOPPED_REQUIRES_REVIEW\n'); process.exitCode = 78;
});
