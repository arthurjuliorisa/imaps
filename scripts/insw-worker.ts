import { startupDecision } from '../lib/insw-worker/safety';
import { resolveWorkerAllowedCompanies } from '../lib/config/insw-worker-config';

// Disabled startup opens no database, transport, app singleton or .env file.
// PM2 supplies the explicit production environment from its separate config.
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const decision = startupDecision(env);
  if (decision === 'DISABLED') {
    process.stdout.write('INSW worker disabled (default). No resources opened.\n');
    return 0;
  }
  if (decision !== 'ENABLED' || !env.DATABASE_URL) {
    process.stderr.write('INSW worker requires explicit production opt-in and DATABASE_URL.\n');
    return 78;
  }
  let allowedCompanies;
  try { allowedCompanies = resolveWorkerAllowedCompanies(env); }
  catch {
    process.stderr.write('INSW_WORKER_ALLOWED_COMPANIES requires an explicit valid supported-company subset.\n');
    return 78;
  }
  const stop = new AbortController();
  const shutdown = () => stop.abort();
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
  try {
    const { runProductionDispatcher } = await import('../lib/insw-worker/production-dispatcher');
    await runProductionDispatcher({ db, signal: stop.signal, allowedCompanies,
      onEvent: (event, data) => process.stdout.write(`${JSON.stringify({ event, data })}\n`),
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
