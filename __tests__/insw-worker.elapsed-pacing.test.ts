import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ElapsedPacing } from '../lib/insw-worker/elapsed-pacing';
import { runIsolatedWorker } from '../lib/insw-worker/isolated-worker';
import { freezePayload } from '../lib/insw-queue/contracts';

const ns = (ms: number) => BigInt(ms) * BigInt(1000000);

for (const jump of [0, 2933, -2933]) test(`elapsed eligibility ignores wall adjustment ${jump} ms`, async () => {
  let elapsed = 0, wall = 0;
  const sleeps: number[] = [], starts: number[] = [];
  const gate = new ElapsedPacing(() => ns(elapsed), async ms => {
    sleeps.push(ms); elapsed += ms; wall += ms;
  });
  const signal = new AbortController().signal;
  assert.equal(await gate.wait(3600, signal), true); // Unknown prior owner: quarantine.
  starts.push(elapsed); gate.mark();
  elapsed += 912; wall += 912 + jump;
  if (jump > 0) assert.ok(wall - starts[0] >= 3600); // Old wall gate opens early.
  assert.equal(await gate.wait(3600, signal), true);
  starts.push(elapsed);
  assert.deepEqual(sleeps, [3600, 2688]);
  assert.equal(starts[1] - starts[0], 3600);
});

test('early timer wakeups recheck elapsed evidence; a long request adds no extra delay', async () => {
  let elapsed = 0;
  const sleeps: number[] = [];
  const gate = new ElapsedPacing(() => ns(elapsed), async ms => {
    sleeps.push(ms); elapsed += sleeps.length === 1 ? 1 : ms;
  });
  const signal = new AbortController().signal;
  await gate.wait(3600, signal);
  assert.deepEqual(sleeps, [3600, 3599]);
  gate.mark(); elapsed += 5000;
  await gate.wait(3600, signal);
  assert.equal(sleeps.length, 2);
});

test('a replacement owner waits a full interval using its own unrelated epoch', async () => {
  for (const epoch of [0, 1000000]) {
    let elapsed = epoch, waited = 0;
    const replacement = new ElapsedPacing(() => ns(elapsed), async ms => { elapsed += ms; waited += ms; });
    await replacement.wait(6000, new AbortController().signal);
    assert.equal(waited, 6000);
  }
});

test('unavailable/regressing clock fails closed, including failure inside the post-fetch hook', async () => {
  let elapsed = 10, unavailable = false;
  const gate = new ElapsedPacing(() => {
    if (unavailable) throw new Error('clock missing');
    return ns(elapsed);
  });
  elapsed = 9;
  await assert.rejects(gate.wait(3600, new AbortController().signal), /ELAPSED_CLOCK_UNAVAILABLE/);
  unavailable = true;
  assert.doesNotThrow(() => gate.mark()); // Must not lose tracking of an active HTTP promise.
  unavailable = false; elapsed = 10000;
  await assert.rejects(gate.wait(3600, new AbortController().signal), /ELAPSED_CLOCK_UNAVAILABLE/);
  assert.throws(() => new ElapsedPacing(() => { throw new Error('clock missing'); }), /clock missing/);
  const stalled = new ElapsedPacing(() => ns(0), async () => {});
  await assert.rejects(stalled.wait(3600, new AbortController().signal), /ELAPSED_CLOCK_UNAVAILABLE/);
});

test('cancellation ends the wait without start authorization', async () => {
  const stop = new AbortController();
  const gate = new ElapsedPacing(() => ns(0), async () => { stop.abort(); });
  assert.equal(await gate.wait(3600, stop.signal), false);
  assert.equal(await gate.wait(3600, stop.signal), false);
});

test('the production timer wait is promptly cancellable', async () => {
  const stop = new AbortController();
  const waiting = new ElapsedPacing().wait(2147483647, stop.signal);
  stop.abort();
  assert.equal(await waiting, false);
});

// Exercise the real worker/admission/start hook with in-memory persistence and
// virtual elapsed time. No Prisma client, socket, worker CLI or provider exists.
for (const [tracked, bypass] of [[true, false], [false, false], [true, true]]) test(
  `worker forward-jump POST boundary (physical hook=${tracked}, bypass elapsed guard=${bypass})`, async t => {
  let elapsed = 0, wall = 0, owner: string | null = null, busy: string | null = null;
  let last: Date | null = null, prior: number | null = null, selected = 0;
  const starts: number[] = [], waits: number[] = [];
  const originalTimer = globalThis.setTimeout;
  if (bypass) t.mock.method(ElapsedPacing.prototype, 'wait', async () => true);
  t.mock.method(process.hrtime, 'bigint', () => ns(elapsed));
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('NO_NETWORK'); });
  t.mock.method(globalThis, 'setTimeout', (fn: (...args: any[]) => void, ms: number, ...args: any[]) => {
    if (ms !== 100) return originalTimer(() => { waits.push(ms); elapsed += ms; wall += ms; fn(...args); }, 0);
    return originalTimer(fn, ms, ...args);
  });
  const frozen = freezePayload({ data: [{ kdKegiatan: '30' }] });
  const tx: any = {
    insw_transmission_policy: { findUnique: async () => ({ version: 1, min_processing_interval_ms: 3600, max_auto_retry: 10 }) },
    $queryRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
      const sql = parts.join('?');
      if (sql.includes('UPDATE insw_dispatch_gate')) {
        if (owner) return [];
        owner = values[0]; return [{ owner_token: owner }];
      }
      if (sql.includes('SELECT last_started_at, prior_interval_ms, busy_attempt_id')) {
        assert.equal(values[0], owner);
        return [{ last_started_at: last, prior_interval_ms: prior, busy_attempt_id: busy }];
      }
      if (sql.includes('AS wait_ms')) return [{ wait_ms: last ? Math.max(0, last.getTime() + 3600 - wall) : 0 }];
      if (sql.includes('SELECT q.id')) return [{ id: `q${++selected}` }];
      if (sql.includes('FOR SHARE')) return [{ id: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    $executeRaw: async (parts: TemplateStringsArray, ...values: any[]) => {
      const sql = parts.join('?');
      if (sql.includes('busy_attempt_id =')) { busy = values[0]; prior = values[1]; }
      if (sql.includes('last_started_at = clock_timestamp()')) last = new Date(wall);
      return 1;
    },
    insw_queue_cycle: { update: async ({ where }: any) => ({ id: where.id, frozen_payload: frozen.payload,
      payload_sha256: frozen.sha256, retry_index: 0, max_auto_retry_snapshot: 10 }) },
    insw_queue_attempt: { create: async () => ({ id: `a${selected}` }) },
  };
  const db: any = { $transaction: async (fn: any) => fn(tx) };
  await runIsolatedWorker({ db, signal: new AbortController().signal, allowedCompanies: [1370],
    timeoutMs: 100, maxJobs: 2, tracksInvocationStart: tracked,
    prepareFinalizer: async () => async () => { busy = null; },
    request: async (_body, _signal, onInvoked) => {
      starts.push(elapsed);
      if (tracked) onInvoked?.();
      if (starts.length === 1) {
        // Let the post-invocation DB timestamp settle before the discontinuity.
        for (let i = 0; i < 5; i++) await Promise.resolve();
        elapsed += 912; wall += 3845;
      }
      return new Response('{"status":false}', { status: 429 });
    },
  });
  assert.equal(selected, 2);
  assert.equal(starts.length, 2);
  // The same real worker path without the new guard reproduces early dispatch.
  assert.equal(starts[1] - starts[0], bypass ? 912 : tracked ? 3600 : 4512);
  assert.deepEqual(waits, bypass ? [] : tracked ? [3600, 2688] : [3600, 3600]);
});
