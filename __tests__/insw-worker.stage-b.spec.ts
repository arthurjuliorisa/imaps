import { test, expect } from '@playwright/test';
import net from 'node:net';
import { canonicalIdentity, freezePayload } from '../lib/insw-queue/contracts';
import { prepareWmsFinalizer } from '../lib/insw-worker/incoming-finalizer';
import { persistOutcome } from '../lib/insw-worker/operational.repository';
import { executeFrozenRequest, type RequestPrimitive } from '../lib/insw-worker/transport';

const connect = net.Socket.prototype.connect, fetch = globalThis.fetch;
test.beforeAll(() => {
  net.Socket.prototype.connect = (() => { throw new Error('NO_NETWORK'); }) as typeof connect;
  globalThis.fetch = async () => { throw new Error('NO_NETWORK'); };
});
test.afterAll(() => { net.Socket.prototype.connect = connect; globalThis.fetch = fetch; });

const payload = { data: [{ kdKegiatan: '30', dokumenKegiatan: [{ nomorDokKegiatan: 'DOC', barangTransaksi: [{ kdBarang: 'ITEM' }] }] }] };
const frozen = freezePayload(payload);

// Only in-memory persistence doubles; imports never construct a Prisma client.
function harness(budget = 10, retryIndex = 0) {
  const job = { id: 'q', attemptId: 'a', company_code: 1370, operation: 'INCOMING', intent: 'SOURCE_COMMIT', source_log_id: null,
    source_revision: 'ACCEPTED_WMS_ID', business_date: '2026-11-10', wms_reference: 'DOC',
    identity_key: canonicalIdentity({ kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode: 1370,
      reference: 'DOC', revision: 'ACCEPTED_WMS_ID', businessDate: '2026-11-10' }).key,
    frozen_payload: payload, payload_sha256: frozen.sha256, retry_index: retryIndex, max_auto_retry_snapshot: budget } as any;
  const updates: any[] = [], metadata: any[] = [];
  let tails = 0;
  const update = async ({ data }: any) => { updates.push(data); return { count: 1 }; };
  const tx: any = {
    $queryRaw: async (sql: TemplateStringsArray) => {
      if (sql.join('').includes('insw_dispatch_gate')) return [{ busy_attempt_id: 'a', last_started_at: null, prior_interval_ms: null }];
      tails++; return [{ tail: BigInt(100 + tails) }];
    },
    $executeRaw: async (sql: TemplateStringsArray, ...values: any[]) => {
      if (sql.join('').includes('INSERT INTO insw_tracking_log')) metadata.push(JSON.parse(values.at(-1)));
      return 1;
    },
    insw_queue_attempt: { findUniqueOrThrow: async () => ({ id: 'a', owner_token: 'owner', queue_id: 'q', retry_index: retryIndex }),
      update: async () => ({}), updateMany: async () => ({ count: 1 }) },
    insw_queue_cycle: { findUniqueOrThrow: async () => ({ ...job, status: 'CLAIMED', owner_token: 'owner' }), update, updateMany: update },
    insw_tracking_log: { findMany: async () => [], create: async ({ data }: any) => { metadata.push(data.metadata); } },
  };
  const db = { ...tx, $queryRaw: async () => [{ id: 1, business_date: new Date(job.business_date) }],
    $transaction: async (fn: any) => fn(tx) } as any;
  return { db, job, updates, metadata, tails: () => tails };
}

const failures: [string, string, RequestPrimitive][] = [
  ...['UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].map(code =>
    [code, 'TEMPORARY_NETWORK_FAILURE', async () => { throw Object.assign(new Error('transport'), { cause: { code } }); }] as [string, string, RequestPrimitive]),
  ['NETWORK_ERROR', 'UNCLASSIFIED_TRANSPORT_FAILURE', async () => { throw new Error('NETWORK_ERROR'); }],
  ['generic AbortError', 'UNCLASSIFIED_TRANSPORT_FAILURE', async () => { throw new DOMException('cancelled', 'AbortError'); }],
  ['timeout', 'REQUEST_TIMEOUT', async () => new Promise(() => {})],
  ...[500, 502, 503, 504].map(status => [String(status), 'UNCONFIRMED_REMOTE_OUTCOME',
    async () => new Response('{"status":false,"message":"temporarily unavailable"}', { status })] as [string, string, RequestPrimitive]),
];

for (const path of ['fallback', 'production'] as const) {
  for (const [name, reason, request] of failures) test(`${path}: ${name} stays HELD without replay authority`, async () => {
    const h = harness();
    let calls = 0;
    const outcome = await executeFrozenRequest({ payload, sha256: frozen.sha256, timeoutMs: 15, captureResponse: true,
      request: async (...args) => { calls++; return request(...args); } });
    expect(outcome.delivery).toBe('POSSIBLY_STARTED');
    expect(outcome.classification.reasonCode).toBe(reason);
    if (path === 'fallback') await persistOutcome(h.db, 'owner', h.job, outcome);
    else await (await prepareWmsFinalizer(h.db, 'owner', h.job, { endpointUrl: 'https://example.invalid/' }, 'INCOMING'))(outcome, Date.now());
    expect(h.updates.at(-1)).toMatchObject({ status: 'HELD', delivery_state: 'POSSIBLY_STARTED', error_code: reason });
    expect(h.metadata[0].reasonCode).toBe(reason);
    expect(h.tails()).toBe(0);
    expect(calls).toBe(1);
  });

  test(`${path}: caller/shutdown abort records cancellation separately from socket interruption`, async () => {
    const h = harness(), stop = new AbortController();
    const outcome = await executeFrozenRequest({ payload, sha256: frozen.sha256, timeoutMs: 100, captureResponse: true, signal: stop.signal,
      request: async () => { stop.abort(); throw Object.assign(new Error('aborted'), { cause: { code: 'ECONNRESET' } }); } });
    expect(outcome).toMatchObject({ errorClass: 'CANCELLED', classification: { reasonCode: 'REQUEST_CANCELLED', retryCandidate: false } });
    if (path === 'fallback') await persistOutcome(h.db, 'owner', h.job, outcome);
    else await (await prepareWmsFinalizer(h.db, 'owner', h.job, { endpointUrl: 'https://example.invalid/' }, 'INCOMING'))(outcome, Date.now());
    expect(h.updates.at(-1).status).toBe('HELD');
    expect(h.metadata[0].reasonCode).toBe('REQUEST_CANCELLED');
    expect(h.tails()).toBe(0);
  });
}

for (const budget of [0, 10]) test(`A05 production: frozen budget ${budget} permits exactly ${budget + 1} sends at tail`, async () => {
  const bodies: string[] = [];
  for (let index = 0; index <= budget; index++) {
    const h = harness(budget, index);
    const outcome = await executeFrozenRequest({ payload, sha256: frozen.sha256, timeoutMs: 100, captureResponse: true,
      request: async body => { bodies.push(body); return new Response('API rate limit exceeded', { status: 429 }); } });
    await (await prepareWmsFinalizer(h.db, 'owner', h.job, { endpointUrl: 'https://example.invalid/' }, 'INCOMING'))(outcome, Date.now());
    const retry = index < budget;
    expect(h.updates.at(-1)).toMatchObject({ status: retry ? 'READY' : 'FAILED', error_code: 'RATE_LIMIT_REJECTION' });
    expect(h.tails()).toBe(retry ? 1 : 0);
    if (retry) expect(h.updates.at(-1)).toMatchObject({ retry_index: index + 1, tail_key: BigInt(101) });
    for (const key of ['frozen_payload', 'payload_sha256', 'max_auto_retry_snapshot', 'identity_key']) expect(h.updates.at(-1)).not.toHaveProperty(key);
    expect(h.metadata[0]).toMatchObject({ payload_sha256: frozen.sha256, reasonCode: 'RATE_LIMIT_REJECTION', responseEvidence: 'COMPLETE',
      providerMessage: 'API rate limit exceeded', httpCode: 429 });
    if (!retry) expect(h.updates.at(-1).delivery_state).toBe('KNOWN_FAILURE');
  }
  expect(bodies).toHaveLength(budget + 1);
  expect(new Set(bodies).size).toBe(1);
});
