import { test, expect } from '@playwright/test';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { INSW_ENDPOINTS } from '../lib/types/insw-api.types';
import { normalizeINSWRetrievalParams } from '../lib/utils/insw-retrieval-params';

const methods = [
  ['getPemasukan', '30'], ['getPengeluaran', '31'],
  ['getStockOpname', '32'], ['getAdjustment', '33'],
] as const;
const dates = { tglAwal: '2026-11-01', tglAkhir: '2026-11-01' };
// Synthetic response shaped from the operator-supplied evidence; no live read.
const accepted = { code: '01', status: true, message: 'fixture', data: [{
  idTransaksi: '2ede81b8-1a88-46a7-8680-a673fd51721d', kdKegiatan: '30',
  nomorDokKegiatan: 'FI1370-20261101-1C18808E-B', tanggalKegiatan: '2026-10-31T17:00:00.000Z',
  namaEntitas: 'Synthetic company', barangTransaksi: ['ITEM-1', 'ITEM-2'].map(kdBarang => ({
    kdBarang, jumlah: '2', nilai: '20',
  })),
}] };
const envKeys = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy', 'NO_PROXY', 'no_proxy'] as const;
let savedEnv: Array<string | undefined>;
let savedFetch: typeof fetch;
let calls: Array<{ endpoint: string; init: RequestInit & { dispatcher?: unknown } }>;
let respond: () => Response | Promise<Response>;

test.beforeEach(() => {
  savedEnv = envKeys.map(key => process.env[key]);
  for (const key of envKeys) delete process.env[key];
  savedFetch = globalThis.fetch;
  calls = [];
  respond = () => Response.json(accepted);
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

for (const useTestMode of [true, false]) {
  for (const [method, activity] of methods) {
    test(`ISO retrieval ${activity} ${useTestMode ? 'TEST' : 'REAL'} uses GET query and private headers`, async () => {
      const service = new INSWIntegrationService('dummy-key', 'dummy-unique', useTestMode);
      expect(await service[method](dates)).toEqual(accepted);
      expect(calls).toHaveLength(1);
      const { endpoint, init } = calls[0];
      const base = INSW_ENDPOINTS.transaksi[useTestMode ? 'temp' : 'real'];
      expect(endpoint).toBe(`${base}/${activity}/?tglAwal=2026-11-01&tglAkhir=2026-11-01`);
      const url = new URL(endpoint);
      expect(url.pathname).toBe(`${new URL(base).pathname}/${activity}/`);
      expect([...url.searchParams]).toEqual(Object.entries(dates));
      expect(endpoint.split('?')).toHaveLength(2);
      expect(url.username).toBe(''); expect(url.password).toBe('');
      expect(init.method).toBe('GET');
      expect(init).not.toHaveProperty('body');
      expect(init.headers).toEqual({ 'Content-Type': 'application/json',
        'x-insw-key': 'dummy-key', 'x-unique-key': 'dummy-unique' });
    });
    test(`legacy date-only retrieval ${activity} ${useTestMode ? 'TEST' : 'REAL'} normalizes without a timezone shift`, async () => {
      await new INSWIntegrationService('dummy-key', 'dummy-unique', useTestMode)[method]({
        tglAwal: '01-11-2026', tglAkhir: '02-11-2026',
      });
      expect(new URL(calls[0].endpoint).search).toBe('?tglAwal=2026-11-01&tglAkhir=2026-11-02');
    });
  }
}

test('all retrievals reject malformed/calendar-invalid dates before transport', async () => {
  const invalid = ['', '2026-02-29', '29-02-2026', '2026-04-31', '2026-13-01', '2026-00-01',
    '0000-01-01', '2026-11-00', '2026-1-01', '2026-11-01T00:00:00Z',
    '2026-11-01&x-insw-key=bad', ' 2026-11-01', null, 20261101, {}, []];
  for (const [method] of methods) {
    for (const field of ['tglAwal', 'tglAkhir']) {
      for (const value of invalid) {
        await expect(new INSWIntegrationService('dummy', 'dummy')[method]({
          ...dates, [field]: value,
        } as typeof dates)).rejects.toThrow(`${field} must be a valid date`);
      }
    }
  }
  expect(calls).toHaveLength(0);
  expect(normalizeINSWRetrievalParams({ tglAwal: '29-02-2024', tglAkhir: '2000-02-29' }))
    .toEqual({ tglAwal: '2024-02-29', tglAkhir: '2000-02-29' });
  expect(() => normalizeINSWRetrievalParams({ ...dates, tglAwal: '1900-02-29' })).toThrow();
});

test('URL builder preserves base path conventions, encodes existing queries, and replaces dates', async () => {
  const savedBase = INSW_ENDPOINTS.transaksi.temp;
  try {
    INSW_ENDPOINTS.transaksi.temp = 'https://example.invalid/prefix/transaksi/?label=a%26b&tglAwal=old';
    await new INSWIntegrationService('dummy', 'dummy').getPemasukan(dates);
    const url = new URL(calls[0].endpoint);
    expect(url.pathname).toBe('/prefix/transaksi/30/');
    expect(url.searchParams.get('label')).toBe('a&b');
    expect(url.searchParams.getAll('tglAwal')).toEqual(['2026-11-01']);
    expect(url.searchParams.get('tglAkhir')).toBe('2026-11-01');
    expect(calls[0].endpoint.split('?')).toHaveLength(2);
  } finally { INSW_ENDPOINTS.transaksi.temp = savedBase; }
});

test('retrieval preserves JSON errors, network rejection and invalid JSON rejection without retry', async () => {
  const service = new INSWIntegrationService('dummy', 'dummy');
  respond = () => Response.json({ code: '02', status: false, message: 'fixture failure', data: null }, { status: 404 });
  expect(await service.getPemasukan(dates)).toEqual({ code: '02', status: false, message: 'fixture failure', data: null });
  respond = () => { throw new Error('synthetic network error'); };
  await expect(service.getPengeluaran(dates)).rejects.toThrow('synthetic network error');
  respond = () => new Response('invalid JSON', { status: 502 });
  await expect(service.getStockOpname(dates)).rejects.toThrow();
  expect(calls).toHaveLength(3);
});

test('retrieval keeps existing proxy and NO_PROXY handling', async () => {
  process.env.https_proxy = 'http://127.0.0.1:9';
  const service = new INSWIntegrationService('dummy', 'dummy');
  const internal = service as unknown as {
    getProxyAgent: (url: string) => Promise<unknown>; undiciFetchPromise: Promise<typeof fetch>;
  };
  const proxyUrls: string[] = [];
  const dispatcher = { synthetic: true };
  internal.getProxyAgent = async url => { proxyUrls.push(url); return dispatcher; };
  internal.undiciFetchPromise = Promise.resolve(globalThis.fetch);
  await service.getPemasukan(dates);
  expect(proxyUrls).toEqual(['http://127.0.0.1:9']);
  expect(calls[0].init.dispatcher).toBe(dispatcher);
  process.env.NO_PROXY = '.insw.go.id';
  await service.getPemasukan(dates);
  expect(calls[1].init.dispatcher).toBeUndefined();
  expect(proxyUrls).toHaveLength(1);
});

for (const activity of ['pemasukan', 'pengeluaran']) {
  test(`${activity} route retains POST/auth/company/return contract and rejects invalid dates`, async () => {
    const auth = require('../lib/api-auth');
    const factory = require('../lib/services/insw-service.factory');
    const savedAuth = auth.checkAuth;
    const savedFactory = factory.createInswIntegrationService;
    let company: unknown = 1370;
    let authenticated = true;
    const companies: number[] = [];
    try {
      Object.assign(auth, { checkAuth: async () => authenticated
        ? { authenticated: true, session: { user: { companyCode: company } } }
        : { authenticated: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) } });
      Object.assign(factory, { createInswIntegrationService: (companyCode: number) => {
        companies.push(companyCode);
        return new INSWIntegrationService('dummy-key', 'dummy-unique');
      } });
      const route = require(`../app/api/insw/get/${activity}/route`);
      const request = (body: unknown) => new Request('http://localhost/api/insw/get/' + activity, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      for (const body of [dates, { tglAwal: '01-11-2026', tglAkhir: '01-11-2026' }]) {
        const response = await route.POST(request(body));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, message: accepted.message,
          data: accepted.data, inswResponse: accepted });
        expect(new URL(calls[calls.length - 1].endpoint).search).toBe('?tglAwal=2026-11-01&tglAkhir=2026-11-01');
      }
      expect(companies).toEqual([1370, 1370]);
      for (const body of [null, {}, { ...dates, tglAwal: '2026-02-30' }, { ...dates, tglAkhir: 123 }]) {
        expect((await route.POST(request(body))).status).toBe(400);
      }
      company = undefined;
      expect((await route.POST(request(dates))).status).toBe(400);
      authenticated = false;
      expect((await route.POST(request(dates))).status).toBe(401);
      expect(companies).toHaveLength(2); expect(calls).toHaveLength(2);
    } finally {
      Object.assign(auth, { checkAuth: savedAuth });
      Object.assign(factory, { createInswIntegrationService: savedFactory });
    }
  });
}
