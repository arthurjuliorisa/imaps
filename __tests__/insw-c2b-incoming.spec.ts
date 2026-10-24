import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { INSW_ENDPOINTS } from '../lib/types/insw-api.types';
import { prepareIncomingHandoff, handoffIncomingInTransaction } from '../lib/insw-queue/incoming-handoff';
import { enqueueExisting } from '../lib/insw-queue/queue.repository';
import { readPolicy, updatePolicy } from '../lib/insw-queue/policy.repository';
import { acquireOperationalOwnership, admitNext, recordActualStart, recoverOperationalOwnership } from '../lib/insw-worker/operational.repository';
import { prepareIsolatedIncomingFinalizer } from '../lib/insw-worker/incoming-finalizer';
import { executeFrozenRequest, MAX_RESPONSE_BYTES } from '../lib/insw-worker/transport';
import { createTransactionRequest } from '../lib/insw-worker/transaction-adapter';
import { runIsolatedWorker } from '../lib/insw-worker/isolated-worker';

const url = process.env.INSW_OUTCOME_TEST_DATABASE_URL;
test.skip(!url, 'Requires a NEW empty disposable loopback *_phase_c2b_test database');
let db: PrismaClient; let other: PrismaClient; let server: Server; let endpoint: string;
let respond: (res: ServerResponse) => void;
let arrivals: { at: number; body: string }[] = [];
let statements: { query: string; duration: number; observedAt: number }[] = [];
const savedFetch = globalThis.fetch;
const service = new INSWIntegrationService('synthetic-c2b-key', 'synthetic-c2b-unique', true);
const request = createTransactionRequest(service);
const payload = (ref: string) => ({ data: [{ kdKegiatan: '30', dokumenKegiatan: [{ nomorDokKegiatan: ref,
  tanggalKegiatan: '24-10-2026', namaEntitas: 'Isolated synthetic HTTP', barangTransaksi: [{
    kdKategoriBarang: '1', kdBarang: 'A', uraianBarang: 'A', jumlah: 1.125, kdSatuan: 'PCE', nilai: 12.3456, dokumen: [],
  }] }] }] });
async function policy(retries = 0, interval = 3600) {
  const p = await readPolicy(db);
  await updatePolicy(db, p.version, { min_processing_interval_ms: interval, max_auto_retry: retries }, 'isolated-test', 'Synthetic C2B fixture only');
}
async function source(ref = 'C2B', company = 1370) {
  const row = await db.incoming_goods.create({ data: { company_code: company, owner: company, wms_id: ref,
    incoming_date: new Date('2026-10-24'), ppkek_number: 'PP', incoming_evidence_number: 'EVIDENCE',
    shipper_name: 'Synthetic', timestamp: new Date() } });
  await db.incoming_good_items.create({ data: { incoming_good_id: row.id, incoming_good_company: company,
    incoming_good_date: row.incoming_date, item_type: 'ROH', item_code: 'A', item_name: 'A', uom: 'PCS',
    qty: 1.125, currency: 'USD', amount: 12.3456 } });
  // Source is committed independently. Explicit synthetic fixture, no membership writer.
  const prepared = prepareIncomingHandoff({ companyCode: company, wmsReference: ref, businessDate: '2026-10-24',
    revision: 'ACCEPTED_WMS_ID', requestedBy: 'C2B_SYNTHETIC_AUTHORIZED_FIXTURE', payload: payload(ref),
    authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' });
  await db.$transaction(tx => handoffIncomingInTransaction(tx, prepared));
  return row;
}
async function admission() {
  const token = await acquireOperationalOwnership(db);
  const job = (await admitNext(db, token)).job!;
  const finalize = await prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint });
  const concurrentFinalize = await prepareIsolatedIncomingFinalizer(other, token, job, { endpointUrl: endpoint });
  const outcome = await executeFrozenRequest({ payload: job.frozen_payload, sha256: job.payload_sha256,
    timeoutMs: 1000, captureResponse: true, request: async (body, signal) => {
      const pending = request(body, signal); await recordActualStart(db, token, job); return pending;
    } });
  return { token, job, finalize, concurrentFinalize, outcome };
}
test.beforeAll(async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(parsed.pathname)
    || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search || parsed.hash) throw new Error('UNSAFE_TEST_DATABASE');
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', e => statements.push({ ...e, observedAt: performance.now() })); db = client;
  other = new PrismaClient({ datasources: { db: { url } } });
  const [state] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  if (state.count !== BigInt(0)) throw new Error('NEW_EMPTY_DATABASE_REQUIRED');
  for (const name of readdirSync('prisma/migrations').sort().filter(n => existsSync(`prisma/migrations/${n}/migration.sql`))) {
    execFileSync('psql', [url!, '-X', '-v', 'ON_ERROR_STOP=1', '-f', `prisma/migrations/${name}/migration.sql`], { stdio: 'pipe' });
  }
  await db.companies.createMany({ data: [{ code: 1370, name: 'Synthetic', company_type: 'SEZ' }, { code: 1371, name: 'BZ', company_type: 'BZ' }] });
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    expect(req.headers['x-insw-key']).toBe('synthetic-c2b-key');
    arrivals.push({ at: Date.now(), body }); respond(res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/synthetic`;
  // Every network invocation goes to literal loopback, regardless of proxy env.
  (service as unknown as { fetchINSW: typeof fetch }).fetchINSW = async (target, init) => {
    expect(target).toBe(INSW_ENDPOINTS.transaksi.temp); return savedFetch(endpoint, init);
  };
});
test.beforeEach(async () => {
  arrivals = [];
  respond = res => { res.setHeader('content-type', 'application/json'); res.end('{"status":true,"code":"00","message":"accepted","data":[]}'); };
  await db.$executeRaw`UPDATE insw_dispatch_gate SET busy_attempt_id = NULL, owner_token = NULL, lease_until = NULL,
    last_started_at = NULL, recovery_barrier_at = NULL, prior_interval_ms = NULL, process_identity = NULL WHERE id = 1`;
  await db.insw_tracking_log.deleteMany(); await db.insw_queue_attempt.deleteMany(); await db.insw_queue_cycle.deleteMany();
  await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany(); await policy();
});
test.afterAll(async () => {
  server?.closeAllConnections(); if (server?.listening) await new Promise<void>(r => server.close(() => r()));
  await Promise.all([db?.$disconnect(), other?.$disconnect()]);
});

test('real Incoming legacy log, payload-by-ID, list/export and company scope; concurrent/repeated local completion', async () => {
  const original = await source(); const { job, finalize, concurrentFinalize, outcome } = await admission();
  await Promise.all([finalize(outcome, Date.now()), concurrentFinalize(outcome, Date.now()), finalize(outcome, Date.now())]);
  await finalize(outcome, Date.now());
  expect(arrivals).toHaveLength(1);
  expect(await db.insw_tracking_log.count()).toBe(1);
  const log = await db.insw_tracking_log.findFirstOrThrow();
  expect(log).toMatchObject({ queue_attempt_id: job.attemptId, transaction_type: 'incoming', transaction_id: original.id,
    company_code: 1370, wms_id: 'C2B', insw_status: 'SUCCESS', insw_activity_code: '30', retry_count: 0,
    insw_request_payload: payload('C2B'), insw_response: { status: true, code: '00', message: 'accepted', data: [] } });
  expect(await db.incoming_goods.findFirst()).toEqual(original);
  expect(await db.insw_queue_cycle.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'SUCCEEDED' });
  // Existing service reads against the real disposable DB; no application DB.
  Object.assign(globalThis, { prisma: db, prismaVersion: 2 });
  // The transport service's existing module imports Prisma eagerly. Rebind its
  // test module export explicitly; worker code never imports that singleton.
  Object.assign(require('../lib/prisma'), { prisma: db });
  const { INSWTransmissionService } = require('../lib/services/insw-transmission.service') as typeof import('../lib/services/insw-transmission.service');
  const reader = new INSWTransmissionService();
  expect((await reader.getTransmissionLogDetail(1370, log.id))?.insw_request_payload).toEqual(payload('C2B'));
  expect(await reader.getTransmissionLogDetail(1371, log.id)).toBeNull();
  expect(await reader.getTransmissionLogPage({ company_code: 1370, limit: 10, offset: 0 })).toMatchObject({ total: 1 });
  expect(await reader.getTransmissionLogs({ company_code: 1370, limit: 10000 })).toHaveLength(1); // Export's exact service contract.
  expect(await reader.getTransmissionLogs({ company_code: 1371 })).toHaveLength(0);
  expect(await reader.getTransmissionLogMetadata({ company_code: 1370 })).toEqual({ transactionTypes: ['incoming'], statuses: ['SUCCESS'] });
  const counts = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM insw_tracking_log
    WHERE company_code = 1370 AND insw_status IN ('SUCCESS','FAILED') AND created_at >= NOW() - INTERVAL '7 days'`;
  expect(Number(counts[0].count)).toBe(1);
  const auth = require('../lib/api-auth'); const company = require('../lib/company-validation');
  const savedAuth = auth.checkAuth; const savedCompany = company.validateCompanyCode;
  try {
    Object.assign(auth, { checkAuth: async () => ({ authenticated: true, session: {} }) });
    Object.assign(company, { validateCompanyCode: () => ({ success: true, companyCode: 1370 }) });
    const detailRoute = require('../app/api/insw/logs/[id]/route');
    const detail = await detailRoute.GET(new Request(endpoint), { params: Promise.resolve({ id: log.id.toString() }) });
    expect((await detail.json()).data.insw_response).toEqual(log.insw_response);
    const exported = await require('../app/api/insw/logs/export/route').GET(new Request(`${endpoint}?transaction_type=incoming`));
    expect(exported.status).toBe(200);
    const ExcelJS = require('exceljs'); const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await exported.arrayBuffer()));
    expect(workbook.worksheets[0].rowCount).toBe(2);
    expect(workbook.worksheets[0].getRow(2).getCell(6).value).toBe('SUCCESS');
    const chart = await require('../app/api/insw/logs/chart-stats/route').GET();
    expect((await chart.json()).data.reduce((sum: number, d: { success: number }) => sum + d.success, 0)).toBe(1);
    Object.assign(company, { validateCompanyCode: () => ({ success: true, companyCode: 1371 }) });
    expect((await detailRoute.GET(new Request(endpoint), { params: Promise.resolve({ id: log.id.toString() }) })).status).toBe(404);
  } finally { Object.assign(auth, { checkAuth: savedAuth }); Object.assign(company, { validateCompanyCode: savedCompany }); }
});

for (const [label, table, when, event] of [
  ['certainty checkpoint', 'insw_queue_cycle', "NEW.status = 'HELD'", 'UPDATE'],
  ['history insert', 'insw_tracking_log', 'true', 'INSERT'],
  ['attempt completion', 'insw_queue_attempt', 'NEW.completed_at IS NOT NULL', 'UPDATE'],
  ['cycle completion', 'insw_queue_cycle', "NEW.status = 'SUCCEEDED'", 'UPDATE'],
  ['gate release', 'insw_dispatch_gate', 'NEW.busy_attempt_id IS NULL', 'UPDATE'],
] as const) test(`known success ${label} DB failure: rollback + local-only repair + race`, async () => {
  const original = await source(); const { job, finalize, outcome } = await admission();
  await db.$executeRawUnsafe(`CREATE FUNCTION c2b_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${when} THEN RAISE EXCEPTION 'C2B injected'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe(`CREATE TRIGGER c2b_fail BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION c2b_fail()`);
  try {
    await expect(finalize(outcome, Date.now())).rejects.toThrow('C2B injected');
    expect(await db.insw_tracking_log.count()).toBe(0);
    const cycle = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: job.id } });
    expect(cycle.status).toBe(label === 'certainty checkpoint' ? 'CLAIMED' : 'HELD');
    if (cycle.status === 'HELD') expect(cycle).toMatchObject({ delivery_state: 'KNOWN_SUCCESS', hold_reason: 'LOCAL_FINALIZATION_REQUIRED' });
    expect((await db.insw_dispatch_gate.findFirst())?.busy_attempt_id).toBe(job.attemptId);
    await expect(admitNext(db, (await db.insw_dispatch_gate.findFirst())!.owner_token!)).rejects.toThrow('STREAM_BUSY');
    expect(await db.incoming_goods.findFirst()).toEqual(original);
  } finally {
    await db.$executeRawUnsafe(`DROP TRIGGER c2b_fail ON ${table}`); await db.$executeRawUnsafe('DROP FUNCTION c2b_fail()');
  }
  await Promise.all([finalize(outcome, Date.now()), finalize(outcome, Date.now())]);
  expect(arrivals).toHaveLength(1); expect(await db.insw_tracking_log.count()).toBe(1);
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe('SUCCEEDED');
});

for (const [http, body, kind, status] of [
  [503, { status: false }, 'TRANSIENT_FAILURE', 'FAILED'], [429, { status: false }, 'TRANSIENT_FAILURE', 'FAILED'],
  [422, { status: false, message: 'invalid' }, 'PERMANENT_FAILURE', 'FAILED'],
  [401, { status: false }, 'PERMANENT_FAILURE', 'FAILED'],
  [400, { status: false, code: '02', message: 'Atas nomor dokumen kegiatan C2B sudah pernah dikirim.' }, 'DUPLICATE_POSSIBILITY', 'HELD'],
  [400, { status: false, code: '02', message: 'Atas nomor dokumen kegiatan OTHER sudah pernah dikirim.' }, 'UNKNOWN', 'HELD'],
  [400, { status: false, code: 2, message: 'C2B' }, 'UNKNOWN', 'HELD'],
  [500, { status: true }, 'UNKNOWN', 'HELD'], [200, { code: '00' }, 'UNKNOWN', 'HELD'],
] as const) test(`HTTP ${http} ${kind} ${JSON.stringify(body)} never false success`, async () => {
  await source(); respond = res => { res.writeHead(http, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  const { finalize, outcome } = await admission(); expect(outcome.classification.kind).toBe(kind);
  await finalize(outcome, Date.now()); await finalize(outcome, Date.now());
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe(status);
  expect(await db.insw_tracking_log.count()).toBe(1);
  expect((await db.insw_tracking_log.findFirst())?.insw_status).toBe('FAILED'); expect(arrivals).toHaveLength(1);
});

test('retained worker injection: retry goes behind next source, 3600ms spacing, immutable payload and 10 snapshot', async () => {
  await policy(10); await source('FIRST'); await source('SECOND');
  let calls = 0;
  respond = res => { res.setHeader('content-type', 'application/json'); res.statusCode = ++calls === 1 ? 503 : 200;
    res.end(JSON.stringify({ status: calls !== 1 })); };
  statements = []; const started = performance.now();
  await runIsolatedWorker({ db, request, signal: new AbortController().signal, timeoutMs: 1000, maxJobs: 3,
    prepareFinalizer: (token, job) => prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint }) });
  const measured = [...statements];
  expect(arrivals.map(r => JSON.parse(r.body).data[0].dokumenKegiatan[0].nomorDokKegiatan)).toEqual(['FIRST', 'SECOND', 'FIRST']);
  for (let i = 1; i < 3; i++) expect(arrivals[i].at - arrivals[i - 1].at).toBeGreaterThanOrEqual(3600);
  expect(arrivals[0].body).toBe(arrivals[2].body);
  expect((await db.insw_queue_cycle.findMany()).every(c => c.status === 'SUCCEEDED' && c.max_auto_retry_snapshot === 10)).toBe(true);
  expect((await db.insw_tracking_log.findMany({ orderBy: { id: 'asc' } })).map(l => l.retry_count)).toEqual([0, 0, 1]);
  console.log('C2B observed worker (one retry + two successes)', JSON.stringify({ elapsedMs: performance.now() - started,
    queries: measured.length, reads: measured.filter(q => /^SELECT/i.test(q.query.trim())).length,
    inserts: measured.filter(q => /^INSERT/i.test(q.query.trim())).length, updates: measured.filter(q => /^UPDATE/i.test(q.query.trim())).length,
    requestBytes: arrivals.map(r => Buffer.byteLength(r.body)), responseBytes: [16, 15, 15] }));
});

test('bounded response evidence: exact 1MiB accepted, excess held, malformed body preserved without fabrication', async () => {
  await source();
  respond = res => res.end('x'.repeat(MAX_RESPONSE_BYTES + 1));
  const { outcome, finalize } = await admission();
  expect(outcome.classification).toMatchObject({ kind: 'UNKNOWN', reasonCode: 'RESPONSE_TOO_LARGE' });
  expect(outcome.responseEvidence).toMatchObject({ state: 'TOO_LARGE', raw: null });
  await finalize(outcome, Date.now());
  expect((await db.insw_tracking_log.findFirst())?.insw_response).toBeNull();
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe('HELD');
  const exact = await executeFrozenRequest({ payload: payload('C2B'), sha256: (await db.insw_queue_cycle.findFirst())!.payload_sha256,
    captureResponse: true, timeoutMs: 1000, request: async () => new Response('x'.repeat(MAX_RESPONSE_BYTES)) });
  expect(exact.responseEvidence?.raw?.length).toBe(MAX_RESPONSE_BYTES);
  expect(exact.classification.kind).toBe('UNKNOWN');
});

test('malformed actual response text remains available by legacy payload detail', async () => {
  await source(); respond = res => { res.statusCode = 502; res.end('actual simulator error'); };
  const { finalize, outcome } = await admission(); await finalize(outcome, Date.now());
  expect((await db.insw_tracking_log.findFirst())?.insw_response).toMatchObject({ rawResponse: 'actual simulator error', httpStatus: 502 });
});

test('timeout with unavailable response drains then holds under Phase 1 owner policy', async () => {
  await policy(1, 3600); await source(); let calls = 0;
  respond = res => { const n = ++calls; setTimeout(() => res.end('{"status":true}'), n === 1 ? 150 : 0); };
  let active = 0; let maxActive = 0;
  await runIsolatedWorker({ db, signal: new AbortController().signal, timeoutMs: 40, maxJobs: 1,
    request: async (body) => { active++; maxActive = Math.max(maxActive, active);
      try { await new Promise(r => setTimeout(r, calls === 0 ? 100 : 0)); return await request(body, new AbortController().signal); }
      finally { active--; } },
    prepareFinalizer: (token, job) => prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint }) });
  expect(maxActive).toBe(1); expect(arrivals).toHaveLength(1);
  const logs = await db.insw_tracking_log.findMany({ orderBy: { id: 'asc' } });
  expect(logs[0].insw_response).toBeNull(); expect(logs[0].metadata).toMatchObject({ reasonCode: 'REQUEST_TIMEOUT' });
  expect(logs).toHaveLength(1);
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe('HELD');
});

test('pre-cancel and contradictory caller evidence cannot fabricate success; stale owners cannot repair', async () => {
  await source(); const { token, job, finalize, outcome } = await admission();
  await expect(finalize({ ...outcome, responseEvidence: { state: 'UNAVAILABLE', raw: null, bytes: 0 } }, Date.now()))
    .rejects.toThrow('SUCCESS_REQUIRES_COMPLETE_RESPONSE');
  const controller = new AbortController(); controller.abort();
  const cancelled = await executeFrozenRequest({ payload: job.frozen_payload, sha256: job.payload_sha256, captureResponse: true,
    timeoutMs: 1000, signal: controller.signal, request });
  expect(cancelled.delivery).toBe('NOT_STARTED'); expect(arrivals).toHaveLength(1);
  await db.$executeRaw`UPDATE insw_dispatch_gate SET owner_token = gen_random_uuid() WHERE id = 1`;
  await expect(finalize(outcome, Date.now())).rejects.toThrow('STREAM_OWNER_LOST');
  expect(await db.insw_tracking_log.count()).toBe(0);
  expect(token).toBe(job.owner_token);
});

test('BZ and unsupported batching fail closed before HTTP; no silent splitting', async () => {
  await expect(source('BZ', 1371)).rejects.toThrow('SEZ_COMPANY_REQUIRED');
  const token = await acquireOperationalOwnership(db);
  const bz = await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1371, operation: 'INCOMING',
    reference: 'BZ', revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' }, intent: 'SOURCE_COMMIT',
    requestedBy: 'forged-fixture', payload: payload('BZ') });
  expect((await admitNext(db, token)).job).toBeNull();
  expect(await db.insw_queue_attempt.count()).toBe(0);
  const job = { ...await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: bz.id } }),
    attemptId: '00000000-0000-0000-0000-000000000000', admissionPolicyVersion: 1 };
  await expect(prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint })).rejects.toThrow('SEZ_COMPANY_REQUIRED');
  expect(() => prepareIncomingHandoff({ companyCode: 1370, wmsReference: 'BATCH', businessDate: '2026-10-24', revision: 'ACCEPTED_WMS_ID',
    requestedBy: 'test', authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT', payload: { data: [payload('A').data[0], payload('B').data[0]] } })).toThrow('one complete Incoming');
  const bad = await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode: 1370,
    reference: 'BATCH', revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' }, intent: 'SOURCE_COMMIT', requestedBy: 'test',
    payload: { data: [payload('A').data[0], payload('B').data[0]] } });
  const badRow = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: bad.id } });
  await expect(prepareIsolatedIncomingFinalizer(db, token, { ...badRow, attemptId: job.attemptId, admissionPolicyVersion: 1 }, { endpointUrl: endpoint }))
    .rejects.toThrow('UNSUPPORTED_INCOMING_IDENTITY_OR_BATCH');
  expect(arrivals).toHaveLength(0);
});

test('commit acknowledgement loss reuses durable completed log; conflicting repair is rejected', async () => {
  await source(); const { token, job, outcome } = await admission();
  let committed = 0;
  const uncertain = new Proxy(db, { get(target, key) {
    if (key === '$transaction') return async (...args: Parameters<PrismaClient['$transaction']>) => {
      const result = await (target.$transaction as Function).apply(target, args);
      if (++committed === 2) throw new Error('SIMULATED_COMMIT_ACK_LOST');
      return result;
    };
    const member = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
  } });
  const finalize = await prepareIsolatedIncomingFinalizer(uncertain, token, job, { endpointUrl: endpoint });
  await expect(finalize(outcome, Date.now())).rejects.toThrow('SIMULATED_COMMIT_ACK_LOST');
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe('SUCCEEDED');
  await finalize(outcome, Date.now());
  await expect(finalize({ ...outcome, businessCode: 'CHANGED' }, Date.now())).rejects.toThrow('OUTCOME_REPAIR_CONFLICT');
  expect(await db.insw_tracking_log.count()).toBe(1); expect(arrivals).toHaveLength(1);
});

test('worker retries failed local writer in memory and never requests the next HTTP during hold', async () => {
  await source();
  await db.$executeRawUnsafe('CREATE SEQUENCE c2b_fail_count');
  await db.$executeRawUnsafe(`CREATE FUNCTION c2b_transient() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF nextval('c2b_fail_count') <= 2 THEN RAISE EXCEPTION 'temporary local writer failure'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER c2b_transient BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION c2b_transient()');
  try {
    await runIsolatedWorker({ db, request, signal: new AbortController().signal, timeoutMs: 1000, maxJobs: 1,
      prepareFinalizer: (token, job) => prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint }) });
    expect(arrivals).toHaveLength(1); expect(await db.insw_tracking_log.count()).toBe(1);
    expect((await db.insw_queue_cycle.findFirst())?.status).toBe('SUCCEEDED');
    const [count] = await db.$queryRaw<{ last_value: bigint }[]>`SELECT last_value FROM c2b_fail_count`;
    expect(Number(count.last_value)).toBe(3);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER c2b_transient ON insw_tracking_log');
    await db.$executeRawUnsafe('DROP FUNCTION c2b_transient()'); await db.$executeRawUnsafe('DROP SEQUENCE c2b_fail_count');
  }
});

test('single success plus retry: bounded fixed statement/storage/transaction evidence', async () => {
  await policy(10); await source(); const token = await acquireOperationalOwnership(db);
  const samples: unknown[] = [];
  for (let index = 0; index < 2; index++) {
    let next = await admitNext(db, token);
    while (!next.job) { await new Promise(r => setTimeout(r, next.waitMs || 10)); next = await admitNext(db, token); }
    const job = next.job;
    const transactionMs: number[] = [];
    const instrumented = new Proxy(db, { get(target, key) {
      if (key === '$transaction') return async (...args: Parameters<PrismaClient['$transaction']>) => {
        const start = performance.now();
        try { return await (target.$transaction as Function).apply(target, args); }
        finally { transactionMs.push(performance.now() - start); }
      };
      const member = Reflect.get(target, key); return typeof member === 'function' ? member.bind(target) : member;
    } });
    const finalize = await prepareIsolatedIncomingFinalizer(instrumented, token, job, { endpointUrl: endpoint });
    respond = res => { res.setHeader('content-type', 'application/json'); res.statusCode = index ? 200 : 503;
      res.end(JSON.stringify({ status: index === 1 })); };
    const outcome = await executeFrozenRequest({ payload: job.frozen_payload, sha256: job.payload_sha256,
      captureResponse: true, timeoutMs: 1000, request: async (body, signal) => {
        const pending = request(body, signal); await recordActualStart(db, token, job); return pending;
      } });
    // Prisma emits query events asynchronously; flush prior framing before the
    // measured interval and completion events before taking the sample.
    await new Promise(r => setTimeout(r, 25)); statements = []; const began = performance.now();
    await finalize(outcome, Date.now()); const elapsedMs = performance.now() - began;
    await new Promise(r => setTimeout(r, 25)); const measured = [...statements];
    const counts = { reads: measured.filter(q => /^SELECT/i.test(q.query.trim())).length,
      inserts: measured.filter(q => /^INSERT/i.test(q.query.trim())).length, updates: measured.filter(q => /^UPDATE/i.test(q.query.trim())).length,
      framing: measured.filter(q => /^(BEGIN|COMMIT)/i.test(q.query.trim())).length };
    expect(counts.inserts).toBe(1); expect(measured.length).toBeLessThanOrEqual(25);
    samples.push({ retryIndex: index, ...counts, elapsedMs, transactionMs,
      requestBytes: Buffer.byteLength(arrivals[index].body), responseBytes: outcome.responseEvidence?.bytes });
  }
  const [storage] = await db.$queryRaw<{ request_bytes: bigint; response_bytes: bigint; metadata_bytes: bigint; row_bytes: bigint }[]>`
    SELECT sum(octet_length(insw_request_payload::text)) AS request_bytes, sum(octet_length(insw_response::text)) AS response_bytes,
      sum(octet_length(metadata::text)) AS metadata_bytes, sum(pg_column_size(l)) AS row_bytes FROM insw_tracking_log l`;
  console.log('C2B fixed finalizer measurements', JSON.stringify({ samples, storage }, (_key, value) => typeof value === 'bigint' ? String(value) : value));
});

test('cancelled in-flight attempt is durably held with no invented response', async () => {
  await source(); const controller = new AbortController();
  respond = res => setTimeout(() => res.end('{"status":true}'), 150);
  await runIsolatedWorker({ db, signal: controller.signal, timeoutMs: 1000, maxJobs: 1,
    request: (body, signal) => { const invoked = request(body, signal); setTimeout(() => controller.abort(), 20); return invoked; },
    prepareFinalizer: (token, job) => prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint }) });
  const log = await db.insw_tracking_log.findFirstOrThrow();
  expect(log.insw_status).toBe('FAILED'); expect(log.insw_response).toBeNull();
  expect(log.metadata).toMatchObject({ reasonCode: 'REQUEST_CANCELLED' });
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe('HELD');
  expect(await db.insw_queue_attempt.count()).toBe(1);
});

test('partial streamed body timeout stays unknown and raw evidence is unavailable', async () => {
  await source();
  respond = res => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"status":');
    setTimeout(() => res.end('true}'), 150); };
  const token = await acquireOperationalOwnership(db); const job = (await admitNext(db, token)).job!;
  const finalize = await prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint });
  const outcome = await executeFrozenRequest({ payload: job.frozen_payload, sha256: job.payload_sha256,
    timeoutMs: 40, captureResponse: true, request });
  expect(outcome.responseEvidence).toMatchObject({ state: 'UNAVAILABLE', raw: null });
  expect(outcome.delivery).toBe('POSSIBLY_STARTED'); expect(outcome.errorClass).toBe('TIMEOUT');
  await finalize(outcome, Date.now());
  expect((await db.insw_tracking_log.findFirst())?.insw_response).toBeNull();
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe('HELD'); // Phase 1: unknown delivery always requires review, even at zero retries.
});

test('new adapter cannot run on the retained C1 database boundary or in production mode', async () => {
  await source(); const token = await acquireOperationalOwnership(db); const job = (await admitNext(db, token)).job!;
  const previous = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    await expect(prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint })).rejects.toThrow('ISOLATED_TEST_ONLY');
  } finally { Object.assign(process.env, { NODE_ENV: previous }); }
  const fake = new Proxy(db, { get(target, key) {
    if (key === '$queryRaw') return async () => [{ name: 'other_phase_c1_test', host: '127.0.0.1' }];
    return Reflect.get(target, key);
  } });
  await expect(prepareIsolatedIncomingFinalizer(fake, token, job, { endpointUrl: endpoint })).rejects.toThrow('ISOLATED_TEST_ONLY');
  expect(arrivals).toHaveLength(0);
});

test('failed transient result writer keeps busy claim; only durable local repair can requeue', async () => {
  await policy(10); await source(); respond = res => { res.statusCode = 503; res.end('{"status":false}'); };
  const { job, finalize, outcome } = await admission();
  await db.$executeRawUnsafe(`CREATE FUNCTION c2b_reject_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'result writer unavailable'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER c2b_reject_result BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION c2b_reject_result()');
  try {
    await expect(finalize(outcome, Date.now())).rejects.toThrow('result writer unavailable');
    expect(await db.insw_tracking_log.count()).toBe(0);
    expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'CLAIMED', retry_index: 0 });
    expect((await db.insw_dispatch_gate.findFirst())?.busy_attempt_id).toBe(job.attemptId);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER c2b_reject_result ON insw_tracking_log'); await db.$executeRawUnsafe('DROP FUNCTION c2b_reject_result()');
  }
  await finalize(outcome, Date.now()); await finalize(outcome, Date.now());
  expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'READY', retry_index: 1 });
  expect(await db.insw_tracking_log.count()).toBe(1); expect(arrivals).toHaveLength(1);
});

test('exhausted local repair retains a durable success hold and never selects another HTTP', async () => {
  await source();
  await db.$executeRawUnsafe(`CREATE FUNCTION c2b_reject_all() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'all local repairs unavailable'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER c2b_reject_all BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION c2b_reject_all()');
  try {
    await expect(runIsolatedWorker({ db, request, signal: new AbortController().signal, timeoutMs: 1000, maxJobs: 2,
      prepareFinalizer: (token, job) => prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint }) }))
      .rejects.toThrow('all local repairs unavailable');
    expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'HELD', delivery_state: 'KNOWN_SUCCESS', hold_reason: 'LOCAL_FINALIZATION_REQUIRED' });
    expect((await db.insw_dispatch_gate.findFirst())?.busy_attempt_id).not.toBeNull();
    expect(await db.insw_tracking_log.count()).toBe(0); expect(arrivals).toHaveLength(1);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER c2b_reject_all ON insw_tracking_log'); await db.$executeRawUnsafe('DROP FUNCTION c2b_reject_all()');
  }
});

test('valid JSON at the response ceiling retains full legacy payload and measured memory', async () => {
  await source();
  const padding = MAX_RESPONSE_BYTES - Buffer.byteLength(JSON.stringify({ status: true, message: '' }));
  const responseBody = JSON.stringify({ status: true, message: 'x'.repeat(padding) });
  const before = process.memoryUsage();
  respond = res => { res.setHeader('content-type', 'application/json'); res.end(responseBody); };
  const { finalize, outcome } = await admission(); await finalize(outcome, Date.now());
  const log = await db.insw_tracking_log.findFirstOrThrow();
  expect(log.insw_status).toBe('SUCCESS');
  expect((log.insw_response as { message: string }).message.length).toBe(padding);
  expect(log.metadata).toMatchObject({ responseBytes: MAX_RESPONSE_BYTES, responseEvidence: 'COMPLETE' });
  const after = process.memoryUsage();
  console.log('C2B 1MiB response memory sample', JSON.stringify({ responseBytes: MAX_RESPONSE_BYTES,
    beforeHeap: before.heapUsed, afterHeap: after.heapUsed, beforeRss: before.rss, afterRss: after.rss }));
});

test('checkpoint hold retains live-owner recovery denial; verified reaped fixture clears stream without repost', async () => {
  await source(); const { token, finalize, outcome } = await admission();
  await db.$executeRawUnsafe(`CREATE FUNCTION c2b_recovery_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'retain hold'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER c2b_recovery_fail BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION c2b_recovery_fail()');
  try { await expect(finalize(outcome, Date.now())).rejects.toThrow('retain hold'); }
  finally { await db.$executeRawUnsafe('DROP TRIGGER c2b_recovery_fail ON insw_tracking_log'); await db.$executeRawUnsafe('DROP FUNCTION c2b_recovery_fail()'); }
  const recovery = { expectedToken: token, operator: 'synthetic-operator', evidence: 'Isolated fixture only; supervisor disabled and child reaped', shutdownAcknowledged: true };
  await expect(recoverOperationalOwnership(db, recovery)).rejects.toThrow('OWNER_PROCESS_NOT_REAPED');
  // Explicitly synthetic gate identity fixture from a child that has exited and
  // been synchronously reaped. No process identity is fabricated in production.
  const identity = execFileSync(process.execPath, ['--import', 'tsx', '-e',
    "process.stdout.write(JSON.stringify(require('./lib/insw-worker/process-identity.ts').processIdentity()))"], { encoding: 'utf8' });
  await db.$executeRaw`UPDATE insw_dispatch_gate SET process_identity = ${identity}::jsonb WHERE id = 1`;
  expect(await recoverOperationalOwnership(db, recovery)).toEqual({ held: 1 });
  expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'HELD', delivery_state: 'KNOWN_SUCCESS', hold_reason: 'LOCAL_FINALIZATION_REQUIRED' });
  expect((await db.insw_dispatch_gate.findFirst())?.busy_attempt_id).toBeNull();
  await expect(finalize(outcome, Date.now())).rejects.toThrow('STREAM_OWNER_LOST');
  expect(arrivals).toHaveLength(1); expect(await db.insw_tracking_log.count()).toBe(0);
});

test('bounded reader cancellation must drain before unknown delivery can be held', async () => {
  await policy(1); await source();
  let release!: () => void; let cancelEntered!: () => void;
  const cancellation = new Promise<void>(r => release = r);
  const cancelling = new Promise<void>(r => cancelEntered = r);
  let invocations = 0;
  const running = runIsolatedWorker({ db, signal: new AbortController().signal, timeoutMs: 40, maxJobs: 1,
    request: async () => {
      if (++invocations > 1) return Response.json({ status: true });
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"status":')); },
        cancel() { cancelEntered(); return cancellation; } }), { headers: { 'content-type': 'application/json' } });
    },
    prepareFinalizer: (token, job) => prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: endpoint }) });
  await cancelling;
  try {
    // Beyond the full required interval, the unsettled cancel still owns the stream.
    await new Promise(r => setTimeout(r, 3700));
    expect(invocations).toBe(1); expect(await db.insw_tracking_log.count()).toBe(0);
    expect((await db.insw_dispatch_gate.findFirst())?.busy_attempt_id).not.toBeNull();
  } finally { release(); }
  await running;
  expect(invocations).toBe(1); expect(await db.insw_tracking_log.count()).toBe(1);
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe('HELD');
});
