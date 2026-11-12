import { PrismaClient } from '@prisma/client';
import { isolatedDatabaseUrl } from '../lib/insw-worker/isolated-worker';
import { startupDecision } from '../lib/insw-worker/safety';
import { recoverOperationalOwnership, recoverPostRestoreOwnership } from '../lib/insw-worker/operational.repository';
import { cloneDatabaseUrl, readCloneManifest } from '../lib/insw-worker/clone-fence';

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--post-restore') {
    if (args.length !== 3 || !['--dry-run', '--apply'].includes(args[1])) throw new Error('CLONE_USAGE_REQUIRED');
    const manifest = readCloneManifest(args[2]);
    const url = cloneDatabaseUrl(process.env, manifest);
    const db = new PrismaClient({ datasources: { db: { url } } });
    try {
      const review = args[1] === '--apply' ? process.env.INSW_POST_RESTORE_REVIEW_SHA256 : undefined;
      if (args[1] === '--apply' && !/^[a-f0-9]{64}$/.test(review ?? '')) throw new Error('CLONE_DRY_RUN_REVIEW_REQUIRED');
      const result = await recoverPostRestoreOwnership(db, manifest, review);
      process.stdout.write(args[1] === '--dry-run'
        ? 'Dry-run: no changes made. Review the verified target, historical owner and retained timing below.\n'
        : 'Recovery committed: stale ownership released and audited; queue, attempts and pacing retained.\n');
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } finally { await db.$disconnect(); }
    return;
  }
  if (args.length) throw new Error('RECOVERY_UNKNOWN_ARGUMENTS');
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
main().catch(error => {
  // Never print a raw Prisma/URL error (it may contain credentials).
  const message = process.argv[2] === '--post-restore' && error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
    ? error.message : 'RECOVERY_DENIED_REQUIRES_REVIEW';
  const guidance: Record<string, string> = {
    CLONE_USAGE_REQUIRED: 'Use --post-restore --dry-run|--apply /path/to/manifest.json.',
    CLONE_OPT_IN_REQUIRED: 'Missing dedicated nonproduction opt-in, or production recovery flag is set.',
    CLONE_UNSAFE_DEPLOYMENT_PHASE: 'Unsafe or unknown deployment: DATABASE_PHASE must explicitly match development/staging.',
    CLONE_TARGET_INPUTS_REQUIRED: 'Supply exact nonproduction host, port, database, role, catalog OIDs and server address.',
    CLONE_UNSAFE_PRODUCTION_TARGET: 'Unsafe target: connection names explicitly identify Production; retain ownership.',
    CLONE_DATABASE_URL_REQUIRED: 'Supply the dedicated post-restore database URL; application URL is never used.',
    CLONE_EXPECTED_OWNER_REQUIRED: 'Supply the exact owner UUID and all retained historical identity fields.',
    CLONE_ACKNOWLEDGEMENT_REQUIRED: 'Supply operator and the exact stopped-producers/no-inflight acknowledgement.',
    CLONE_OPERATOR_EVIDENCE_REQUIRED: 'Supply restore provenance, verified endpoint/access control and shutdown evidence.',
    CLONE_UNSAFE_ENDPOINT_MISMATCH: 'Unsafe target: dedicated connection coordinates/options differ from the manifest.',
    CLONE_UNSAFE_TARGET_MISMATCH: 'Unsafe target: connected database/schema/role/server identity differs or has active replication.',
    CLONE_OTHER_CONNECTIONS_OR_PREPARED_TRANSACTIONS: 'Target database has another session or prepared transaction; retain ownership.',
    CLONE_ACTIVE_OR_UNKNOWN_CLAIMS_REQUIRE_MANUAL_REVIEW: 'Target has active claims, unfinished attempts or unknown delivery; retain ownership.',
    CLONE_DRY_RUN_REVIEW_REQUIRED: 'Apply requires the digest from a reviewed no-write dry-run.',
    CLONE_DRY_RUN_REVIEW_MISMATCH: 'Reviewed facts changed; perform and review a fresh dry-run.',
  };
  process.stderr.write(message + (guidance[message] ? ': ' + guidance[message] : '') + '\n'); process.exitCode = 78;
});
