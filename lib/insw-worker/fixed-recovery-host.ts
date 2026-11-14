import { createHmac, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { recoverOperationalOwnership } from './operational.repository';
import { processIdentity, verifyReaped, type ProcessIdentity } from './process-identity';
import { recoverFixedWorker, type GateSnapshot, type RecoveryStage, type RecoveryAcknowledgement } from './fixed-recovery-engine';
import type { RecoveryInstallation } from './recovery-installation';
const execute = promisify(execFile);
const target = 'imaps-insw-worker';
const same = (a: ProcessIdentity, b: ProcessIdentity) => Object.keys(a).every(key => a[key as keyof ProcessIdentity] === b[key as keyof ProcessIdentity]);

export async function fixedRecoveryHost(db: PrismaClient, config: RecoveryInstallation, requestedBy: string,
  stage: (stage: RecoveryStage) => void, acknowledgement?: RecoveryAcknowledgement) {
  const pm2 = async (args: string[]) => JSON.parse((await execute(config.node, [config.pm2, ...args], {
    cwd: config.root, env: { ...process.env, HOME: config.home, PM2_HOME: config.pm2Home },
    timeout: 15000, maxBuffer: 1024 * 1024,
  })).stdout);
  const inspect = async () => {
    const daemonPid = Number(readFileSync(join(config.pm2Home, 'pm2.pid'), 'utf8').trim());
    if (!Number.isSafeInteger(daemonPid) || daemonPid <= 0 || identityOf(daemonPid).uid !== config.uid
      || identityOf(daemonPid).pidNamespace !== processIdentity().pidNamespace
      || !readFileSync(`/proc/${daemonPid}/cmdline`, 'utf8').includes('God Daemon')) throw new Error('PM2_ACCOUNT_MISMATCH');
    const list = await pm2(['jlist']);
    if (!Array.isArray(list)) throw new Error('SUPERVISOR_MISMATCH');
    const matches = list.filter(app => app.name === target);
    if (matches.length !== 1) throw new Error('SUPERVISOR_MISMATCH');
    const app = matches[0], env = app.pm2_env;
    if (app.name !== target || env.pm_cwd !== config.root || env.pm_exec_path !== join(config.root, 'scripts/insw-worker.ts')
      || !['node', config.node].includes(env.exec_interpreter)
      || (Array.isArray(env.node_args) ? env.node_args.join(' ') : env.node_args) !== '--import tsx'
      || !process.env.DATABASE_URL || env.DATABASE_URL !== process.env.DATABASE_URL
      || env.NEXT_PUBLIC_ENVIRONMENT_PHASE !== process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE
      || env.DATABASE_PHASE !== process.env.DATABASE_PHASE
      || env.autorestart !== false || env.watch !== false || env.exec_mode !== 'fork_mode') throw new Error('SUPERVISOR_MISMATCH');
    return { stopped: ['stopped', 'errored'].includes(env.status) && !app.pid, pid: env.status === 'online' && Number.isSafeInteger(app.pid) && app.pid > 0 ? app.pid : 0 };
  };
  let observed: GateSnapshot;
  const gate = async (): Promise<GateSnapshot> => {
    const [row] = await db.$queryRaw<(GateSnapshot & { lease_until: Date | null })[]>`
      SELECT owner_token, process_identity, busy_attempt_id, lease_until,
        last_started_at, prior_interval_ms, recovery_barrier_at,
        ((last_started_at IS NULL) = (prior_interval_ms IS NULL))
          AND (owner_token IS NOT NULL OR (lease_until IS NULL AND process_identity IS NULL AND busy_attempt_id IS NULL))
          AND (last_started_at IS NOT NULL OR recovery_barrier_at IS NULL) AS coherent
      FROM insw_dispatch_gate WHERE id = 1`;
    if (!row) throw new Error('GATE_MISSING');
    observed = row;
    return row;
  };
  const identityOf = (pid: number): ProcessIdentity => {
    const local = processIdentity();
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return { ...local, pid, start: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19],
      uid: statSync(`/proc/${pid}`).uid, pidNamespace: readlinkSync(`/proc/${pid}/ns/pid`) };
  };
  return recoverFixedWorker({ gate, supervisor: inspect,
    ready: async (gate, pid) => {
      if (!pid || !gate.owner_token || !gate.process_identity || !gate.coherent) return false;
      try {
        const receipt = JSON.parse(readFileSync(join(config.runtime, 'ready.json'), 'utf8'));
        const identity = identityOf(pid);
        return same(identity, gate.process_identity) && identity.uid === config.uid
          && receipt.token === gate.owner_token && same(identity, receipt.identity);
      } catch { return false; }
    },
    proveReaped: async identity => {
      if (identity) verifyReaped(identity);
      const supervisor = await inspect();
      if (!supervisor.stopped) throw new Error('SUPERVISOR_ACTIVE');
      // Bounded same-UID /proc scan catches surviving fixed entrypoints and
      // descendants still parented to the old PID. It cannot identify orphans.
      const local = processIdentity();
      const pids = readdirSync('/proc').filter(name => /^\d+$/.test(name));
      if (pids.length > 32768) throw new Error('PROCESS_SCAN_UNAVAILABLE');
      for (const name of pids) {
        const pid = Number(name);
        try {
          if (statSync(`/proc/${pid}`).uid !== config.uid) continue;
          const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
          const parent = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
          const argv = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
          if (argv.some(arg => arg === join(config.root, 'scripts/insw-worker.ts') || arg === 'scripts/insw-worker.ts')
            || (identity && identity.boot === local.boot && parent === identity.pid)) throw new Error('DESCENDANTS_NOT_REAPED');
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
      if (!identity) return 'coherent unowned gate; no recovery required';
      // PID absence cannot establish descendant reaping. Use the manual CLI's
      // explicit operator attestation, bound to these freshly observed facts.
      const secret = process.env.NEXTAUTH_SECRET;
      if (!secret) throw new Error('SHUTDOWN_ACKNOWLEDGEMENT_REQUIRED');
      const sign = (expires: number) => createHmac('sha256', secret).update(JSON.stringify([
        'insw-worker-shutdown', config.root, config.pm2Home, requestedBy, observed, expires,
      ])).digest('hex');
      if (!acknowledgement) {
        const expires = Date.now() + 5 * 60 * 1000;
        return { result: 'confirmation-required' as const, confirmation: `${expires}.${sign(expires)}` };
      }
      const [expiry, signature] = acknowledgement.confirmation.split('.');
      const expires = Number(expiry);
      if (!/^\d{13}\.[a-f0-9]{64}$/.test(acknowledgement.confirmation)
        || expires <= Date.now() || expires > Date.now() + 5 * 60 * 1000
        || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(expires), 'hex'))
        || acknowledgement.shutdownAcknowledged !== true
        || typeof acknowledgement.evidence !== 'string' || !acknowledgement.evidence.trim()
        || acknowledgement.evidence.length > 500 || /[\u0000-\u001f]/.test(acknowledgement.evidence)) throw new Error('SHUTDOWN_ACKNOWLEDGEMENT_REQUIRED');
      return acknowledgement.evidence.trim();
    },
    recover: async (expectedToken, operator, evidence) => { await recoverOperationalOwnership(db, {
      expectedToken, operator, evidence, shutdownAcknowledged: acknowledgement?.shutdownAcknowledged === true,
    }); },
    refused: reason => process.stderr.write(`INSW_FIXED_RECOVERY_${reason}\n`),
    start: async () => {
      if (!(await inspect()).stopped) throw new Error('SUPERVISOR_ACTIVE');
      // execFile argument vector, no shell and no caller-selected target.
      await execute(config.node, [config.pm2, 'restart', join(config.root, 'ecosystem.insw-worker.config.js'), '--only', target, '--update-env'], {
        cwd: config.root, env: { ...process.env, HOME: config.home, PM2_HOME: config.pm2Home }, timeout: 15000, maxBuffer: 65536,
      });
    },
    pause: () => new Promise(resolve => setTimeout(resolve, 1000)),
  }, `service:uid=${config.uid};admin=${requestedBy}`, stage);
}
