// Invoked only through the fixed flock command by the server adapter.
import { recoveryInstallation } from '../../lib/insw-worker/recovery-installation';
import { workerRecoveryAllowed } from '../../lib/insw-queue/worker-recovery';
import { fixedRecoveryHost } from '../../lib/insw-worker/fixed-recovery-host';
import { config as dotenv } from 'dotenv';

async function main() {
  // The helper owns this deadline; killing only flock could leave its child
  // holding the lock indefinitely during a failed DB/supervisor operation.
  const deadline = setTimeout(() => { process.stderr.write('INSW_FIXED_RECOVERY_DEADLINE\n'); process.exit(78); }, 70000);
  deadline.unref();
  if (process.argv.length !== 2 || process.env.IMAPS_RECOVERY_LOCKED !== '1') throw new Error('CALLER_DENIED');
  const config = recoveryInstallation();
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 4096) throw new Error('CALLER_DENIED');
    chunks.push(Buffer.from(chunk));
  }
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !['requestedBy', 'acknowledgement'].includes(key)) || typeof input.requestedBy !== 'string'
    || !/^[a-zA-Z0-9_-]{1,64}$/.test(input.requestedBy)) throw new Error('CALLER_DENIED');
  if (input.acknowledgement !== undefined) {
    const ack = input.acknowledgement;
    if (!ack || Object.keys(ack).sort().join(',') !== 'confirmation,evidence,shutdownAcknowledged'
      || typeof ack.confirmation !== 'string' || !/^\d{13}\.[a-f0-9]{64}$/.test(ack.confirmation)
      || ack.shutdownAcknowledged !== true || typeof ack.evidence !== 'string'
      || !ack.evidence.trim() || ack.evidence.length > 500 || /[\u0000-\u001f]/.test(ack.evidence)) throw new Error('CALLER_DENIED');
  }
  // Use the normal deployment environment; fill absent settings from .env.
  dotenv({ path: `${config.root}/.env`, override: false, quiet: true });
  if (!workerRecoveryAllowed() || !process.env.DATABASE_URL) throw new Error('ENVIRONMENT_DENIED');
  const { PrismaClient } = await import('@prisma/client');
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.set('connection_limit', '1');
  url.searchParams.set('connect_timeout', '5');
  url.searchParams.set('pool_timeout', '5');
  url.searchParams.set('socket_timeout', '5');
  const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  try {
    const result = await fixedRecoveryHost(db, config, input.requestedBy,
      stage => process.stdout.write(JSON.stringify({ stage }) + '\n'), input.acknowledgement);
    process.stdout.write(JSON.stringify(typeof result === 'string' ? { result } : result) + '\n');
  } finally { await db.$disconnect(); clearTimeout(deadline); }
}
main().catch(error => {
  // Fixed code only: never print OS/Prisma errors or their arguments.
  const allowed = new Set(['CALLER_DENIED', 'ENVIRONMENT_DENIED', 'PM2_ACCOUNT_MISMATCH', 'SUPERVISOR_MISMATCH',
    'GATE_UNSAFE', 'GATE_CHANGED', 'OWNER_IDENTITY_MISSING', 'READINESS_TIMEOUT', 'GATE_MISSING', 'SHUTDOWN_ACKNOWLEDGEMENT_REQUIRED', 'PROCESS_SCAN_UNAVAILABLE', 'SUPERVISOR_ACTIVE',
    'DESCENDANTS_NOT_REAPED', 'UNVERIFIABLE_OWNER_HOST', 'UNVERIFIABLE_PROCESS_NAMESPACE', 'OWNER_PROCESS_NOT_REAPED',
    'STREAM_OWNER_LOST', 'LEGACY_OWNER_REQUIRES_EXTERNAL_FENCING_REVIEW', 'INCONSISTENT_BUSY_ATTEMPT']);
  const reason = error instanceof Error && allowed.has(error.message) ? error.message : 'HOST_OPERATION_FAILED';
  process.stderr.write(`INSW_FIXED_RECOVERY_${reason}\n`);
  process.stdout.write('{"result":"refused"}\n');
  process.exitCode = 1;
});
