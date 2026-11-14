import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { recoveryInstallation } from '../insw-worker/recovery-installation';
import type { RecoveryOutcome, RecoveryStage, RecoveryAcknowledgement } from '../insw-worker/fixed-recovery-engine';
export function workerRecoveryAllowed(env: Record<string, string | undefined> = process.env): boolean {
  const phase = env.NEXT_PUBLIC_ENVIRONMENT_PHASE;
  return (phase === 'development' || phase === 'staging')
    && (!env.DATABASE_PHASE || env.DATABASE_PHASE === phase);
}
export const workerRecoveryUnavailable = 'Worker recovery is unavailable. Contact your system administrator.';
export interface FixedWorkerRecoveryHost {
  available(): boolean;
  recoverAndRestart(input: { requestedBy: string; acknowledgement?: RecoveryAcknowledgement }, stage?: (stage: RecoveryStage) => void): Promise<RecoveryOutcome>;
}
export const fixedWorkerRecoveryHost: FixedWorkerRecoveryHost = {
  available() {
    try { return workerRecoveryAllowed() && !!recoveryInstallation(); } catch { console.error('[INSW recovery] DEPLOYMENT_CONTEXT_UNAVAILABLE'); return false; }
  },
  async recoverAndRestart({ requestedBy, acknowledgement }, stage) {
    if (!this.available()) return 'unavailable';
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(requestedBy)) return 'refused';
    const config = recoveryInstallation();
    return new Promise(resolve => {
      // flock is held by the helper's parent until it exits, across web processes.
      // Nonblocking contention refuses rather than queueing a second restart.
      const child = spawn('/usr/bin/flock', ['--nonblock', '--conflict-exit-code', '75', `${config.runtime}/recovery.lock`,
        config.node, '--import', 'tsx', `${config.root}/scripts/host/insw-worker-recovery.ts`], {
        cwd: config.root, env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', PATH: `${dirname(config.node)}:/usr/bin:/bin`,
          INSW_RECOVERY_PM2_CLI: config.pm2, HOME: config.home, PM2_HOME: config.pm2Home,
          IMAPS_RECOVERY_LOCKED: '1', NODE_ENV: 'production' }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let buffer = '', bytes = 0, result: RecoveryOutcome = 'refused';
      const timer = setTimeout(() => child.kill('SIGTERM'), 80000);
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify({ requestedBy, ...(acknowledgement ? { acknowledgement } : {}) }));
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 8192) { child.kill('SIGTERM'); return; }
        buffer += chunk.toString();
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const event = JSON.parse(line);
            if (['Checking', 'Recovering', 'Starting'].includes(event.stage)) stage?.(event.stage);
            if (['running', 'already-running', 'refused'].includes(event.result)) result = event.result;
            if (event.result === 'confirmation-required' && /^\d{13}\.[a-f0-9]{64}$/.test(event.confirmation)) result = { result: 'confirmation-required', confirmation: event.confirmation };
          } catch { result = 'refused'; }
        }
      });
      let diagnostic = '';
      child.stderr.on('data', chunk => {
        diagnostic = (diagnostic + chunk.toString()).slice(-4096);
      });
      child.once('error', () => { clearTimeout(timer); resolve('unavailable'); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code !== 0 || result === 'refused') {
          const codes = ['CALLER_DENIED', 'ENVIRONMENT_DENIED', 'PM2_ACCOUNT_MISMATCH', 'SUPERVISOR_MISMATCH',
            'GATE_UNSAFE', 'GATE_CHANGED', 'OWNER_IDENTITY_MISSING', 'READINESS_TIMEOUT', 'GATE_MISSING', 'SHUTDOWN_ACKNOWLEDGEMENT_REQUIRED', 'PROCESS_SCAN_UNAVAILABLE', 'SUPERVISOR_ACTIVE',
            'DESCENDANTS_NOT_REAPED', 'UNVERIFIABLE_OWNER_HOST', 'UNVERIFIABLE_PROCESS_NAMESPACE', 'OWNER_PROCESS_NOT_REAPED',
            'STREAM_OWNER_LOST', 'LEGACY_OWNER_REQUIRES_EXTERNAL_FENCING_REVIEW', 'INCONSISTENT_BUSY_ATTEMPT', 'DEADLINE'];
          const reason = code === 75 ? 'RECOVERY_BUSY' : codes.find(value => diagnostic.includes(`INSW_FIXED_RECOVERY_${value}\n`)) ?? 'HOST_REFUSED_OR_TIMEOUT';
          console.error('[INSW recovery]', reason);
        }
        resolve(code === 0 ? result : 'refused');
      });
    });
  },
};
