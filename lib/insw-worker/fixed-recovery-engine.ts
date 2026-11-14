import type { ProcessIdentity } from './process-identity';

export type RecoveryConfirmation = { result: 'confirmation-required'; confirmation: string };
export type RecoveryAcknowledgement = { confirmation: string; shutdownAcknowledged: true; evidence: string };
export type RecoveryOutcome = RecoveryConfirmation | 'running' | 'already-running' | 'refused' | 'unavailable';
export type RecoveryStage = 'Checking' | 'Recovering' | 'Starting';
export type GateSnapshot = { owner_token: string | null; process_identity: ProcessIdentity | null;
  busy_attempt_id: string | null; coherent: boolean };
export interface RecoveryFacts {
  // Implemented by the host under the existing OS lock.
  gate(): Promise<GateSnapshot>;
  supervisor(): Promise<{ stopped: boolean; pid: number }>;
  ready(gate: GateSnapshot, pid: number): Promise<boolean>;
  proveReaped(identity: ProcessIdentity | null): Promise<string | RecoveryConfirmation>;
  recover(token: string, operator: string, evidence: string): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  refused?(reason: string): void;
}

export async function recoverFixedWorker(facts: RecoveryFacts, operator: string,
  stage: (value: RecoveryStage) => void): Promise<RecoveryOutcome> {
  const refuse = (reason: string): RecoveryOutcome => { facts.refused?.(reason); return 'refused'; };
  stage('Checking');
  const before = await facts.gate();
  const supervisor = await facts.supervisor();
  if (await facts.ready(before, supervisor.pid)) return 'already-running';
  if (!supervisor.stopped) return refuse('SUPERVISOR_ACTIVE');
  if (!before.coherent || before.busy_attempt_id) return refuse('GATE_UNSAFE');
  // Even absent ownership needs supervisor/descendant proof before a start.
  const evidence = await facts.proveReaped(before.process_identity);
  if (typeof evidence !== 'string') return evidence;
  if (before.owner_token) {
    if (!before.process_identity) return refuse('OWNER_IDENTITY_MISSING');
    stage('Recovering');
    await facts.recover(before.owner_token, operator, evidence);
  } else if (before.process_identity) return refuse('GATE_UNSAFE');
  const cleared = await facts.gate();
  if (cleared.owner_token || cleared.process_identity || cleared.busy_attempt_id || !cleared.coherent) return refuse('GATE_CHANGED');
  stage('Starting');
  await facts.start();
  for (let poll = 0; poll < 20; poll++) {
    const current = await facts.gate();
    const process = await facts.supervisor();
    if (current.owner_token && current.owner_token !== before.owner_token && await facts.ready(current, process.pid)) return 'running';
    await facts.pause();
  }
  return refuse('READINESS_TIMEOUT');
}
