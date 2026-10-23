import { test, expect } from '@playwright/test';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { INSW_ENDPOINTS, INSWTransaksiPayload } from '../lib/types/insw-api.types';
import { createTransactionRequest } from '../lib/insw-worker/transaction-adapter';
import { executeFrozenRequest } from '../lib/insw-worker/transport';
import { freezePayload } from '../lib/insw-queue/contracts';
import { createServer } from 'node:http';
import { once } from 'node:events';

const payload: INSWTransaksiPayload = { data: [{ kdKegiatan: '30', dokumenKegiatan: [{
  nomorDokKegiatan: 'C2-ONLY-SYNTHETIC', tanggalKegiatan: '22-10-2026',
  namaEntitas: 'Synthetic company', barangTransaksi: [],
}] }] };
const envKeys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;
let savedEnv: Array<string | undefined>;
let savedFetch: typeof fetch;
type Call = { endpoint: string; init: RequestInit & { dispatcher?: unknown } };
let calls: Call[];
let respond: () => Response | Promise<Response>;

test.beforeEach(() => {
  savedFetch = globalThis.fetch;
  savedEnv = envKeys.map(key => process.env[key]);
  for (const key of envKeys) delete process.env[key];
  calls = [];
  respond = () => Response.json({ status: true, code: 'OK', message: 'fixture', data: [] });
  // No test uses a real network primitive, even when verifying real-mode URLs.
  globalThis.fetch = async (endpoint, init) => {
    calls.push({ endpoint: String(endpoint), init: init! });
    return respond();
  };
});
test.afterEach(() => {
  globalThis.fetch = savedFetch;
  envKeys.forEach((key, index) => {
    if (savedEnv[index] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[index];
  });
});

const methods = ['postPemasukan', 'postPengeluaran', 'postStockOpname', 'postAdjustment'] as const;
for (const useTestMode of [true, false]) {
  for (const method of methods) test(`legacy ${method} and frozen request share ${useTestMode ? 'temp' : 'real'} transport`, async () => {
    const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique', useTestMode);
    expect(await service[method](payload)).toMatchObject({ status: true, code: 'OK' });
    const controller = new AbortController();
    const request = createTransactionRequest(service);
    const frozen = freezePayload(payload);
    const body = JSON.stringify(frozen.payload);
    const raw = await request(body, controller.signal);
    expect(await raw.json()).toMatchObject({ status: true, code: 'OK' });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.endpoint).toBe(INSW_ENDPOINTS.transaksi[useTestMode ? 'temp' : 'real']);
      expect(call.init.method).toBe('POST');
      expect(call.init.headers).toEqual({
        'Content-Type': 'application/json', 'x-insw-key': 'synthetic-key', 'x-unique-key': 'synthetic-unique',
      });
      expect(JSON.parse(String(call.init.body))).toEqual(payload);
      expect(call.init.dispatcher).toBeUndefined();
    }
    expect(calls[0].init.body).toBe(JSON.stringify(payload));
    expect(calls[0].init.signal).toBeUndefined();
    expect(calls[1].init.body).toBe(body);
    expect(calls[1].init.signal).toBe(controller.signal);
  });
}

test('legacy response normalization is preserved while worker sees exact HTTP/body evidence', async () => {
  respond = () => Response.json({ status: true, code: 'OK', message: 'contradictory' }, { status: 500 });
  const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique');
  // Existing callers retain their interpretation, including contradictory body.
  expect(await service.postPemasukan(payload)).toMatchObject({ status: true, httpStatus: 500 });
  const outcome = await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256,
    timeoutMs: 1000, request: createTransactionRequest(service) });
  expect(outcome).toMatchObject({ httpCode: 500, errorClass: 'HTTP_ERROR', delivery: 'POSSIBLY_STARTED' });
  expect(calls).toHaveLength(2);
});

test('non-JSON failure retains legacy diagnostics and raw worker HTTP status', async () => {
  respond = () => new Response('fixture upstream error', { status: 502, statusText: 'Bad Gateway' });
  const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique');
  expect(await service.postAdjustment(payload)).toMatchObject({ status: false, code: '502', rawResponse: 'fixture upstream error' });
  const outcome = await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256,
    timeoutMs: 1000, request: createTransactionRequest(service) });
  expect(outcome).toMatchObject({ httpCode: 502, errorClass: 'HTTP_ERROR', delivery: 'POSSIBLY_STARTED' });
});

test('network error is not flattened before worker classification and never automatically reposted', async () => {
  respond = () => { throw Object.assign(new Error('synthetic network failure'), { cause: { code: 'ECONNRESET' } }); };
  const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique');
  expect(await service.postPengeluaran(payload)).toMatchObject({ status: false, code: 'ECONNRESET', errorType: 'NETWORK_ERROR' });
  const outcome = await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256,
    timeoutMs: 1000, request: createTransactionRequest(service) });
  expect(outcome).toMatchObject({ errorClass: 'CONNECTION', delivery: 'POSSIBLY_STARTED' });
  expect(calls).toHaveLength(2); // One legacy invocation plus one worker invocation.
});

test('strict duplicate classification receives original response and frozen single document', async () => {
  const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique');
  for (const [document, expected] of [['C2-ONLY-SYNTHETIC', 'DUPLICATE_POSSIBILITY'], ['OTHER', 'UNKNOWN']]) {
    respond = () => Response.json({ status: false, code: '02',
      message: `Atas nomor dokumen kegiatan ${document} sudah pernah dikirim.` }, { status: 400 });
    const outcome = await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256,
      timeoutMs: 1000, request: createTransactionRequest(service) });
    expect(outcome.classification.kind).toBe(expected);
    expect(outcome.delivery).toBe('POSSIBLY_STARTED');
  }
});

test('frozen hash failure and pre-cancellation never invoke the real client seam', async () => {
  const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique');
  const request = createTransactionRequest(service);
  expect(await executeFrozenRequest({ payload, sha256: '0'.repeat(64), timeoutMs: 1000, request }))
    .toMatchObject({ delivery: 'NOT_STARTED', errorClass: 'INVALID_PAYLOAD' });
  const controller = new AbortController(); controller.abort();
  expect(await executeFrozenRequest({ payload, sha256: freezePayload(payload).sha256,
    timeoutMs: 1000, request, signal: controller.signal }))
    .toMatchObject({ delivery: 'NOT_STARTED', errorClass: 'CANCELLED' });
  expect(calls).toHaveLength(0);
});

test('both transports preserve proxy selection and NO_PROXY matching through the existing fetch boundary', async () => {
  process.env.https_proxy = 'http://127.0.0.1:9'; // Stubbed agent, never contacted.
  const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique');
  const internals = service as unknown as {
    getProxyAgent: (url: string) => Promise<unknown>; undiciFetchPromise: Promise<typeof fetch>;
  };
  const proxyUrls: string[] = [];
  const dispatcher = { synthetic: true };
  internals.getProxyAgent = async url => { proxyUrls.push(url); return dispatcher; };
  internals.undiciFetchPromise = Promise.resolve(globalThis.fetch);
  await service.postPemasukan(payload);
  await createTransactionRequest(service)(JSON.stringify(payload), new AbortController().signal);
  expect(proxyUrls).toEqual(['http://127.0.0.1:9', 'http://127.0.0.1:9']);
  expect(calls.map(call => call.init.dispatcher)).toEqual([dispatcher, dispatcher]);

  for (const noProxy of ['*', '.insw.go.id', 'api.insw.go.id:443']) {
    process.env.NO_PROXY = noProxy;
    await service.postPemasukan(payload);
    await createTransactionRequest(service)(JSON.stringify(payload), new AbortController().signal);
  }
  expect(proxyUrls).toHaveLength(2);
  expect(calls.slice(2).every(call => call.init.dispatcher === undefined)).toBe(true);
});

test('frozen client seam sends one exact request to a loopback simulator', async () => {
  const received: Array<{ body: string; method?: string; key?: string; unique?: string }> = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    received.push({ body, method: req.method, key: req.headers['x-insw-key'] as string,
      unique: req.headers['x-unique-key'] as string });
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: false, code: '02',
      message: 'Atas nomor dokumen kegiatan C2-ONLY-SYNTHETIC sudah pernah dikirim.' }));
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback port');
    // Endpoint selection still runs in the real client. Only the network target
    // is redirected, so no INSW endpoint can be contacted by this test.
    globalThis.fetch = async (endpoint, init) => {
      expect(String(endpoint)).toBe(INSW_ENDPOINTS.transaksi.temp);
      return savedFetch(`http://127.0.0.1:${address.port}/synthetic`, init);
    };
    const frozen = freezePayload(payload);
    const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique');
    const outcome = await executeFrozenRequest({ payload: frozen.payload, sha256: frozen.sha256,
      timeoutMs: 1000, request: createTransactionRequest(service) });
    expect(outcome.classification.kind).toBe('DUPLICATE_POSSIBILITY');
    expect(received).toEqual([{ body: JSON.stringify(frozen.payload), method: 'POST',
      key: 'synthetic-key', unique: 'synthetic-unique' }]);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
