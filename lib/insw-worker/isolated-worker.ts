import { integer } from '../insw-queue/contracts';
import { PrismaClient } from '@prisma/client';
import { executeFrozenRequest, RequestPrimitive, Outcome } from './transport';
import { acquireOperationalOwnership, admitNext, persistOutcome, recordActualStart, AdmittedJob } from './operational.repository';

export function isolatedDatabaseUrl(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV !== 'test' || env.INSW_ISOLATED_WORKER_ENABLED !== 'true') throw new Error('ISOLATED_TEST_OPT_IN_REQUIRED');
  const value = env.INSW_WORKER_TEST_DATABASE_URL;
  const parsed = new URL(value ?? 'invalid:');
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1'
    || !/^\/[a-z0-9_]+_phase_c1_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('UNSAFE_ISOLATED_DATABASE');
  return value!;
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
    if (signal.aborted) done();
  });
}

// Injected primitive must represent one locally tracked invocation, spawning no
// children/background HTTP. The CLI below supplies the only runnable adapter.
export async function runIsolatedWorker(input: { db: PrismaClient; request: RequestPrimitive; signal: AbortSignal;
  timeoutMs: number; onEvent?: (event: string, data?: unknown) => void; maxJobs?: number;
  // Inactive injected domain extension. No CLI supplies this capability.
  prepareFinalizer?: (token: string, job: AdmittedJob) => Promise<(outcome: Outcome, endedAt: number) => Promise<void>> }) {
  integer(input.timeoutMs, 'request timeout', 1, 300000);
  if (input.maxJobs !== undefined) integer(input.maxJobs, 'maximum jobs', 1);
  const token = await acquireOperationalOwnership(input.db);
  input.onEvent?.('owned', { token });
  let idleMs = 250;
  let count = 0;
  while (!input.signal.aborted && count < (input.maxJobs ?? Infinity)) {
    const admission = await admitNext(input.db, token);
    if (!admission.job) {
      await wait(admission.waitMs || idleMs, input.signal);
      idleMs = Math.min(5000, idleMs * 2);
      continue;
    }
    idleMs = 250;
    const job = admission.job;
    const finalize = input.prepareFinalizer ? await input.prepareFinalizer(token, job) : undefined;
    input.onEvent?.('admitted', { id: job.id });
    let invocation: Promise<Response> | undefined;
    let body: Promise<string> | undefined;
    let started: Promise<void> | undefined;
    let startFailed = false;
    const outcome = await executeFrozenRequest({ payload: job.frozen_payload, sha256: job.payload_sha256,
      timeoutMs: input.timeoutMs, signal: input.signal,
      captureResponse: !!finalize, onBodyRead: reading => { body = reading; },
      request: (json, signal) => {
        // executeFrozenRequest can return at its deadline; these separately tracked
        // promises must settle before ANY result releases the stream.
        invocation = Promise.resolve().then(() => input.request(json, signal));
        started = recordActualStart(input.db, token, job).catch(() => { startFailed = true; });
        return invocation;
      },
    });
    input.onEvent?.('boundedOutcome', { errorClass: outcome.errorClass });
    if (invocation) {
      try {
        const response = await invocation;
        if (body) await body;
        else if (response.body) await response.body.cancel();
      } catch { /* The locally tracked invocation has ended; outcome stays conservative. */ }
    }
    await started;
    if (startFailed) throw new Error('START_EVIDENCE_FAILED_STREAM_RETAINED');
    await persistWithRepair(input.db, token, job, outcome, input.signal, finalize);
    count++;
    input.onEvent?.('recorded', { id: job.id, classification: outcome.classification.kind });
  }
  // Never self-release: PM2 can reap this process before maintenance rotation.
  input.onEvent?.('drained', { count });
  return { token, count };
}

// Bounded repair of one result, separate from queue selection. Never invokes HTTP.
async function persistWithRepair(db: PrismaClient, token: string, job: AdmittedJob, outcome: Outcome, signal: AbortSignal,
  finalize?: (outcome: Outcome, endedAt: number) => Promise<void>) {
  const locallyEndedAt = Date.now();
  for (let repair = 0; ; repair++) {
    try {
      if (finalize) await finalize(outcome, locallyEndedAt);
      else await persistOutcome(db, token, job, outcome, locallyEndedAt);
      return;
    }
    catch (error) {
      if (repair === 4) throw error;
      await wait(250 * (repair + 1), signal);
    }
  }
}
