import { writeFileSync, renameSync } from 'node:fs';
import { recoveryInstallation } from './recovery-installation';
import { processIdentity } from './process-identity';
import { workerRecoveryAllowed } from '../insw-queue/worker-recovery';

// Private readiness follows the first successful application admission query.
// Receipt alone is never health: PM2 PID and DB ownership must also match.
export function recordWorkerRecoveryReadiness(event: string, data: unknown, env: NodeJS.ProcessEnv) {
  if (event !== 'ready' || !workerRecoveryAllowed(env)) return;
  try {
    const installed = recoveryInstallation();
    const file = `${installed.runtime}/ready.json`;
    const temporary = `${file}.${process.pid}`;
    writeFileSync(temporary, JSON.stringify({ token: (data as { token: string }).token,
      identity: processIdentity() }), { mode: 0o600 });
    renameSync(temporary, file);
  } catch { /* No receipt means automatic recovery/readiness is refused. */ }
}
