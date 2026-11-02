import { PrismaClient } from '@prisma/client';
import { isolatedDatabaseUrl } from '../lib/insw-worker/isolated-worker';
import { startupDecision } from '../lib/insw-worker/safety';
import { recoverOperationalOwnership } from '../lib/insw-worker/operational.repository';

async function main() {
  const url = process.env.INSW_RECOVER_PRODUCTION === 'true'
    ? (startupDecision(process.env) === 'ENABLED' && process.env.DATABASE_URL)
    : isolatedDatabaseUrl(process.env);
  if (!url) throw new Error('EXPLICIT_PRODUCTION_RECOVERY_REQUIRED');
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await recoverOperationalOwnership(db, {
      expectedToken: process.env.INSW_RECOVER_EXPECTED_TOKEN ?? '', operator: process.env.INSW_RECOVER_OPERATOR ?? '',
      evidence: process.env.INSW_RECOVER_EVIDENCE ?? '',
      shutdownAcknowledged: process.env.INSW_RECOVER_ACK === 'supervisor-stopped-all-owner-processes-and-children-reaped',
    });
    process.stdout.write('Owner recovered; unresolved attempts held; interval retained.\n');
  } finally { await db.$disconnect(); }
}
main().catch(() => { process.stderr.write('RECOVERY_DENIED_REQUIRES_REVIEW\n'); process.exitCode = 78; });
