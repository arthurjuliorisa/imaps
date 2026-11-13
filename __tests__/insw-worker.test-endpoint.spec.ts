import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { resolveWorkerTestEndpoint, workerDispatchTransport } from '../lib/insw-worker/test-endpoint';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { INSW_ENDPOINTS } from '../lib/types/insw-api.types';
import { executeFrozenRequest } from '../lib/insw-worker/transport';
import { freezePayload } from '../lib/insw-queue/contracts';
import { main } from '../scripts/insw-worker';
import { runProductionDispatcher } from '../lib/insw-worker/production-dispatcher';
import { execFileSync } from 'node:child_process';

const target = 'http://127.0.0.1:18765/api-prod/inventory/temp/transaksi';
const env = { NODE_ENV: 'test', INSW_WORKER_TEST_MODE: 'true', INSW_TEST_ENDPOINT_OVERRIDE: target } as const;
const payload = { data: [{ dokumenKegiatan: [{ nomorDokKegiatan: 'SYNTHETIC-OFFLINE' }] }] };

test('absent override preserves transport identity and rejects unsafe or production settings', () => {
  expect(resolveWorkerTestEndpoint({ NODE_ENV: 'production' })).toBeUndefined();
  expect(workerDispatchTransport(undefined)).toBeUndefined();
  const mock = async () => Response.json({ status: true });
  expect(workerDispatchTransport(undefined, mock)).toBe(mock);
  expect(resolveWorkerTestEndpoint(env)).toBe(target);
  expect(resolveWorkerTestEndpoint({ ...env, NODE_ENV: 'development', INSW_TEST_ENDPOINT_OVERRIDE: target.replace('127.0.0.1', 'localhost') })).toContain('localhost');
  for (const override of ['', 'invalid', target.replace('127.0.0.1', 'example.com'), target.replace('127.0.0.1', '127.1'),
    target.replace('http:', 'https:'), target.replace(':18765', ':80'), target + '?x=1', target + '#x',
    target + '/', target.replace('127.0.0.1', 'user:secret@127.0.0.1'), target.replace('/temp/', '/')]) {
    expect(() => resolveWorkerTestEndpoint({ ...env, INSW_TEST_ENDPOINT_OVERRIDE: override })).toThrow('INSW_WORKER_TEST_ENDPOINT_REJECTED');
  }
  for (const changes of [{ NODE_ENV: 'production' }, { NODE_ENV: undefined }, { INSW_WORKER_TEST_MODE: 'false' }]) {
    expect(() => resolveWorkerTestEndpoint({ ...env, ...changes })).toThrow('INSW_WORKER_TEST_ENDPOINT_REJECTED');
  }
});

test('CLI rejects invalid test startup before DB access', async () => {
  for (const changes of [{ NODE_ENV: 'production' }, { INSW_TEST_ENDPOINT_OVERRIDE: 'http://external.invalid:18765/' }] as const) {
    expect(await main({ ...env, ...changes, INSW_WORKER_ENABLED: 'true', DATABASE_URL: 'invalid:', INSW_WORKER_ALLOWED_COMPANIES: '1370' })).toBe(78);
  }
});

test('built frozen POST reaches exact loopback path with unchanged headers/body and complete eligible rejection', async () => {
  let seen: { path?: string; method?: string; body: string; key?: string; unique?: string } | undefined;
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    seen = { path: req.url, method: req.method, body: Buffer.concat(chunks).toString(), key: req.headers['x-insw-key'] as string,
      unique: req.headers['x-unique-key'] as string };
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: false, message: 'API rate limit exceeded' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const port = (server.address() as { port: number }).port;
    const endpoint = resolveWorkerTestEndpoint({ ...env, INSW_TEST_ENDPOINT_OVERRIDE: target.replace('18765', String(port)) });
    const service = new INSWIntegrationService('synthetic-key', 'synthetic-unique', true);
    const frozen = freezePayload(payload);
    const outcome = await executeFrozenRequest({ payload, sha256: frozen.sha256, timeoutMs: 2000, captureResponse: true,
      request: (body, signal) => service.requestFrozenTransaction(body, signal, workerDispatchTransport(endpoint)) });
    expect(seen).toEqual({ path: '/api-prod/inventory/temp/transaksi', method: 'POST', body: JSON.stringify(payload), key: 'synthetic-key', unique: 'synthetic-unique' });
    expect(outcome.classification).toEqual({ kind: 'TRANSIENT_FAILURE', reasonCode: 'RATE_LIMIT_REJECTION', retryCandidate: true });
    expect(outcome.responseEvidence?.state).toBe('COMPLETE');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('shared service ignores worker env and keeps both canonical provider targets', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    for (const useTestMode of [true, false]) {
      let actual: string | undefined;
      const service = new INSWIntegrationService('synthetic', 'synthetic', useTestMode);
      await service.requestFrozenTransaction(JSON.stringify(payload), new AbortController().signal, async endpoint => {
        actual = endpoint; return Response.json({ status: true });
      });
      expect(actual).toBe(useTestMode ? INSW_ENDPOINTS.transaksi.temp : INSW_ENDPOINTS.transaksi.real);
    }
  } finally { process.env = saved; }
});

test('regular dispatcher resolves test target before ownership and rejects real company mode', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, env, { INSW_1370_USE_TEST_MODE: 'true', INSW_1370_API_KEY: 'synthetic', INSW_1370_UNIQUE_KEY_TEST: 'synthetic', INSW_1370_UNIQUE_KEY_REAL: 'synthetic' });
  const events: unknown[] = [];
  const db = { $transaction: () => { throw new Error('OFFLINE_OWNERSHIP_STOP'); } };
  try {
    await expect(runProductionDispatcher({ db: db as any, signal: new AbortController().signal, allowedCompanies: [1370],
      onEvent: (event, data) => events.push({ event, data }) })).rejects.toThrow('OFFLINE_OWNERSHIP_STOP');
    expect(events).toContainEqual({ event: 'WORKER_TARGET', data: { companyCode: 1370, endpoint: target, testOverride: true } });
    process.env.INSW_1370_USE_TEST_MODE = 'false';
    await expect(runProductionDispatcher({ db: db as any, signal: new AbortController().signal, allowedCompanies: [1370] })).rejects.toThrow('INSW_WORKER_TEST_REQUIRES_SANDBOX_COMPANY');
  } finally { process.env = saved; }
});

test('ecosystem explicitly sets test and restore env without PM2 execution', () => {
  const script = 'const e=require("./ecosystem.insw-worker.config.js").apps[0].env; console.log(JSON.stringify(e))';
  const read = (mode: string) => JSON.parse(execFileSync(process.execPath, ['-e', script], {
    env: { ...process.env, INSW_WORKER_TEST_MODE: mode, INSW_TEST_ENDPOINT_OVERRIDE: mode === 'true' ? target : '' }, encoding: 'utf8',
  }));
  expect(read('true')).toMatchObject({ NODE_ENV: 'test', INSW_WORKER_TEST_MODE: 'true', INSW_TEST_ENDPOINT_OVERRIDE: target });
  expect(read('false')).toMatchObject({ NODE_ENV: 'production', INSW_WORKER_TEST_MODE: 'false', INSW_TEST_ENDPOINT_OVERRIDE: '' });
});
