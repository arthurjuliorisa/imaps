// Shared visibility rule. The private phase, when supplied, may veto a mismatch.
export function workerRecoveryAllowed(env: Record<string, string | undefined> = process.env): boolean {
  const phase = env.NEXT_PUBLIC_ENVIRONMENT_PHASE;
  return (phase === 'development' || phase === 'staging')
    && (!env.DATABASE_PHASE || env.DATABASE_PHASE === phase);
}

export const workerRecoveryUnavailable = 'Worker recovery is unavailable. Contact your system administrator.';

/**
 * Privileged host boundary, deliberately unimplemented in this deployment.
 * No browser-supplied owner, evidence, command, path or PM2 target is accepted.
 *
 * A future implementation must serialize across ALL callers on the host; fetch
 * retained ownership itself; prove supervisor/children reaping plus host, boot,
 * UID and namespace identity; invoke recoverOperationalOwnership with the exact
 * owner and a real service audit identity; start only imaps-insw-worker using
 * ecosystem.insw-worker.config.js under its existing PM2 identity; and observe
 * fresh matching gate/process readiness before returning running. A healthy
 * worker is a no-op. Active, unverifiable or unresolved work must be refused.
 * PM2 online or PID absence alone never establishes these facts. No process or
 * network waits belong inside a database transaction.
 */
export interface FixedWorkerRecoveryHost {
  recoverAndRestart(input: { requestedBy: string }): Promise<'running' | 'refused' | 'unavailable'>;
}

// No environment flag can enable a missing authority boundary. No lock is
// needed while disabled: this implementation performs zero host/DB operations.
export const fixedWorkerRecoveryHost: FixedWorkerRecoveryHost = {
  async recoverAndRestart() { return 'unavailable'; },
};
