import { PrismaClient } from '@prisma/client';
import { isolatedDatabaseUrl } from '../lib/insw-worker/isolated-worker';
import { recoverOperationalOwnership } from '../lib/insw-worker/operational.repository';

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: isolatedDatabaseUrl(process.env) } } });
  try {
    await recoverOperationalOwnership(db, {
      expectedToken: process.env.INSW_RECOVER_EXPECTED_TOKEN ?? '', operator: process.env.INSW_RECOVER_OPERATOR ?? '',
      evidence: process.env.INSW_RECOVER_EVIDENCE ?? '',
      shutdownAcknowledged: process.env.INSW_RECOVER_ACK === 'supervisor-stopped-all-owner-processes-and-children-reaped',
    });
    process.stdout.write('Isolated owner recovered; unresolved attempts held; interval retained.\n');
  } finally { await db.$disconnect(); }
}
main().catch(() => { process.stderr.write('RECOVERY_DENIED_REQUIRES_REVIEW\n'); process.exitCode = 78; });
