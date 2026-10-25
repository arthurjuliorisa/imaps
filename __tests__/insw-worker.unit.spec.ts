import { test, expect } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { freezePayload } from '../lib/insw-queue/contracts';
import { earliestNextStart, retryDisposition, startupDecision, verifiedPayload } from '../lib/insw-worker/safety';
import { executeFrozenRequest, RequestPrimitive } from '../lib/insw-worker/transport';

const payload = { data: [{ kdKegiatan: '30' }] };
const sha256 = freezePayload(payload).sha256;
const run = (request: RequestPrimitive, extra: Partial<Parameters<typeof executeFrozenRequest>[0]> = {}) =>
  executeFrozenRequest({ payload, sha256, timeoutMs: 100, request, ...extra });
const reply = (body: string, status = 200, headers?: HeadersInit): RequestPrimitive => async () => new Response(body, { status, headers });

test('entrypoint is default off and explicit opt-in cannot activate dispatch', () => {
  for (const value of [undefined, 'false', '1', 'TRUE', ' true ']) expect(startupDecision({ INSW_WORKER_ENABLED: value })).toBe('DISABLED');
  expect(startupDecision({ INSW_WORKER_ENABLED: 'true' })).toBe('BLOCKED');
  for (const enabled of ['false', 'true']) {
    const result = spawnSync('node_modules/.bin/tsx', ['scripts/insw-worker.ts'], {
      env: { ...process.env, INSW_WORKER_ENABLED: enabled }, encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(enabled === 'true' ? 78 : 0);
    expect(result.stdout + result.stderr).toContain(enabled === 'true' ? 'NOT READY FOR ACTIVATION' : 'disabled');
  }
});

test('only dormant Outgoing completion imports capture; live methods and coordinator/company/PM2 remain identical to baseline', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  }
  for (const file of [...walk('app'), ...walk('lib').filter(p => !p.startsWith('lib/insw-worker/')), 'ecosystem.config.js', 'package.json']) {
    if (/\.(tsx?|js|json)$/.test(file)) {
      let source = readFileSync(file, 'utf8');
      if (file === 'lib/services/outgoing-goods.service.ts') {
        // B2 permits exactly one dormant import inside the private completion
        // adapter. Every existing live method remains byte-identical to HEAD.
        const baseline = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8' });
        expect(source.slice(source.indexOf('  async processOutgoingGoods('))).toBe(
          baseline.slice(baseline.indexOf('  async processOutgoingGoods(')));
        expect(source.match(/captureCompletedOutgoing\(/g)).toHaveLength(1);
        source = source.replace("const { captureCompletedWmsSource } = await import('../insw-worker/completed-source-capture');", '');
      }
      expect(source, file).not.toMatch(/insw-worker|executeFrozenRequest/);
    }
  }
  // C2 shares the client's transaction request builder; its executable parity
  // coverage is in insw-c2-transport.spec.ts. All routing/authorization remains
  // byte-identical, and the import guard above still excludes live worker use.
  for (const file of ['lib/services/insw-transmission.service.ts', 'lib/services/insw-service.factory.ts', 'lib/config/insw-company-config.ts', 'ecosystem.config.js']) {
    expect(readFileSync(file, 'utf8')).toBe(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 2000000 }));
  }
});

test('timing specification: 0/2.6/3.6 and 0/5/5 without extra response delay', () => {
  expect(earliestNextStart(null, 3600)).toBe(0);
  expect(earliestNextStart({ startedAt: 0, finishedAt: 2600, intervalAtAdmission: 3600 }, 3600)).toBe(3600);
  expect(earliestNextStart({ startedAt: 0, finishedAt: 5000, intervalAtAdmission: 3600 }, 3600)).toBe(5000);
});

test('timing specification preserves admission minimum and responds to increased policy', () => {
  const prior = { startedAt: 1000, finishedAt: 3600, intervalAtAdmission: 3600 };
  expect(earliestNextStart(JSON.parse(JSON.stringify(prior)), 3600)).toBe(4600);
  expect(earliestNextStart(prior, 6000)).toBe(7000);
  expect(earliestNextStart(prior, 100)).toBe(4600);
  expect(() => earliestNextStart(prior, 0)).toThrow();
  expect(() => earliestNextStart({ ...prior, finishedAt: 0 }, 3600)).toThrow();
});

test('retry contract budgets count retries after initial attempt using snapshot', () => {
  for (const maximum of [0, 3]) {
    let attempts = 1;
    for (let retryIndex = 0; retryIndex < 5; retryIndex++) {
      if (retryDisposition({ delivery: 'KNOWN_FAILURE', confirmedSafeRetry: true, retryIndex, maxAutoRetrySnapshot: maximum }) !== 'RETRY_TO_TAIL') break;
      attempts++;
    }
    expect(attempts).toBe(maximum + 1);
  }
  for (const delivery of ['NOT_STARTED', 'POSSIBLY_STARTED', 'KNOWN_FAILURE']) {
    expect(retryDisposition({ delivery, confirmedSafeRetry: false, retryIndex: 0, maxAutoRetrySnapshot: 3 })).toBe('HOLD');
  }
  expect(retryDisposition({ delivery: 'KNOWN_SUCCESS', confirmedSafeRetry: true, retryIndex: 0, maxAutoRetrySnapshot: 3 })).toBe('STOP');
});

test('payload is detached canonical JSON with verified hash; invalid/missing hashes never invoke request', async () => {
  expect(JSON.parse(verifiedPayload(payload, sha256))).toEqual(payload);
  for (const hash of ['', 'a'.repeat(64), 'A'.repeat(64)]) {
    let invoked = false;
    const outcome = await run(async () => { invoked = true; throw new Error(); }, { sha256: hash });
    expect(outcome).toMatchObject({ delivery: 'NOT_STARTED', phase: 'PREFLIGHT', errorClass: 'INVALID_PAYLOAD', requestInvokedAt: null });
    expect(invoked).toBe(false);
  }
});

for (const fixture of [
  { name: 'success', body: '{"status":true,"code":"OK"}', status: 200, errorClass: null, delivery: 'KNOWN_SUCCESS' },
  { name: 'HTTP/body contradiction', body: '{"status":true}', status: 500, errorClass: 'HTTP_ERROR' },
  { name: 'auth', body: '{"status":false}', status: 401, errorClass: 'HTTP_ERROR' },
  { name: 'validation', body: '{"status":false}', status: 422, errorClass: 'HTTP_ERROR' },
  { name: 'quota', body: '{"status":false}', status: 429, errorClass: 'HTTP_ERROR' },
  { name: 'business rejection', body: '{"status":false,"code":"REJECTED"}', status: 200, errorClass: 'BUSINESS_REJECTION' },
  { name: 'malformed JSON', body: '{', status: 200, errorClass: 'INVALID_JSON' },
  { name: 'null JSON', body: 'null', status: 200, errorClass: 'INVALID_RESPONSE' },
  { name: 'wrong status type', body: '{"status":"true"}', status: 200, errorClass: 'INVALID_RESPONSE' },
]) test(`transport classifies ${fixture.name} conservatively`, async () => {
  expect(await run(reply(fixture.body, fixture.status))).toMatchObject({
    phase: 'RESPONSE', httpCode: fixture.status, errorClass: fixture.errorClass,
    delivery: fixture.delivery ?? 'POSSIBLY_STARTED', autoRetry: false,
  });
});

for (const [code, errorClass] of [['ENOTFOUND', 'DNS'], ['ECONNREFUSED', 'CONNECTION'], ['ECONNRESET', 'CONNECTION'], ['OTHER', 'NETWORK']]) {
  test(`transport separates ${code} without assuming safe retry`, async () => {
    const result = await run(async () => { throw Object.assign(new Error('secret-credentials'), { cause: { code } }); });
    expect(result).toMatchObject({ phase: 'REQUEST', errorClass, delivery: 'POSSIBLY_STARTED', autoRetry: false });
    expect(JSON.stringify(result)).not.toContain('secret-credentials');
  });
}

for (const phase of ['REQUEST', 'BODY']) test(`bounded ${phase} timeout aborts and holds unknown even if primitive ignores abort`, async () => {
  let signal: AbortSignal | undefined;
  const never = () => new Promise<never>(() => {});
  const result = await run(async (_body, s) => {
    signal = s;
    return phase === 'REQUEST' ? never() : { status: 200, ok: true, headers: new Headers(), text: never } as unknown as Response;
  }, { timeoutMs: 15 });
  expect(result).toMatchObject({ phase, errorClass: 'TIMEOUT', delivery: 'POSSIBLY_STARTED', autoRetry: false });
  expect(signal?.aborted).toBe(true);
});

test('shutdown cancellation before send is safe; cancellation in flight remains unknown', async () => {
  const before = new AbortController(); before.abort();
  let invoked = false;
  expect(await run(async () => { invoked = true; throw new Error(); }, { signal: before.signal })).toMatchObject({ delivery: 'NOT_STARTED', errorClass: 'CANCELLED' });
  expect(invoked).toBe(false);
  const during = new AbortController();
  expect(await run(async () => { during.abort(); return new Promise(() => {}); }, { signal: during.signal })).toMatchObject({ delivery: 'POSSIBLY_STARTED', errorClass: 'CANCELLED' });
});

test('outcomes expose only allowlisted evidence and invocation timestamps', async () => {
  let tick = 0;
  const result = await run(reply('{"status":true,"code":"OK","token":"SECRET"}', 200, { 'retry-after': '12', authorization: 'SECRET', 'set-cookie': 'SECRET' }), { now: () => ++tick });
  expect(result).toMatchObject({ businessCode: 'OK', retryAfter: '12' });
  expect(result.endedAt).toBeGreaterThan(result.requestInvokedAt!);
  expect(JSON.stringify(result)).not.toContain('SECRET');
});
