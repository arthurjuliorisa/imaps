import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { isolatedIncomingPilot } from '../lib/insw-worker/incoming-pilot';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { prepareIsolatedIncomingFinalizer } from '../lib/insw-worker/incoming-finalizer';
import { prepareIncomingHandoff } from '../lib/insw-queue/incoming-handoff';
import { enqueueExisting } from '../lib/insw-queue/queue.repository';
import { readPolicy, updatePolicy } from '../lib/insw-queue/policy.repository';
import { acquireOperationalOwnership, admitNext, recoverOperationalOwnership } from '../lib/insw-worker/operational.repository';

const url = process.env.INSW_OUTCOME_TEST_DATABASE_URL;
test.skip(!url, 'NEW empty disposable loopback *_phase_c2b_test required');
let db: PrismaClient; let server: Server; let endpoint: string;
let arrivals: { at: number; body: unknown }[]; let handler: (res: ServerResponse) => void;
let active = 0; let maxActive = 0; let transactionOpen = 0; let transactionMs: number[] = []; let queries: string[] = []; let children: ChildProcess[] = [];
const messages = new Map<ChildProcess, string[]>();
const authorization = 'DISPOSABLE_INCOMING_FIXTURES_ONLY' as const;
async function fixture(company: number, nonFacility = false, ref = `SOURCE-${company}-${nonFacility}`) {
  const row = await db.incoming_goods.create({ data: { company_code: company, owner: company, wms_id: ref,
    incoming_date: new Date('2026-10-24'), ppkek_number: nonFacility ? 'N' : 'PP123',
    customs_document_type: nonFacility ? null : 'BC23', is_non_facility: nonFacility,
    customs_registration_date: nonFacility ? null : new Date('2026-10-23'),
    incoming_evidence_number: nonFacility ? 'N' : 'EVIDENCE', shipper_name: 'Synthetic Supplier', timestamp: new Date() } });
  await db.incoming_good_items.createMany({ data: [1, 2].map(n => ({ incoming_good_id: row.id,
    incoming_good_company: company, incoming_good_date: row.incoming_date, item_type: 'ROH', item_code: `ITEM-${n}`,
    item_name: `Synthetic ${n}`, uom: 'PCS', qty: n * 1.125, currency: 'USD', amount: n * 12.3456 })) });
  return row;
}
async function pilot(ids: number[], database = db) { return isolatedIncomingPilot(database, { authorization, sourceIds: ids, endpoint }); }
async function policy(retries: number, interval = 3600) {
  const p = await readPolicy(db); await updatePolicy(db, p.version,
    { min_processing_interval_ms: interval, max_auto_retry: retries }, 'fixture', 'Disposable Phase 1 only');
}
function child(ids: number[], captureId?: number, company?: number, maxJobs = 1) {
  const p = fork('scripts/test-fixtures/insw-incoming-pilot.ts', [], { execArgv: ['--import', 'tsx'],
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/unavailable',
      INSW_OUTCOME_TEST_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  messages.set(p, []); p.on('message', (m: { event: string }) => messages.get(p)!.push(m.event));
  p.stderr?.on('data', data => process.stderr.write(data)); children.push(p);
  p.send({ sourceIds: ids, endpoint, captureId, company, maxJobs }); return p;
}
async function event(p: ChildProcess, name: string) {
  await expect.poll(() => messages.get(p)!.includes(name), { timeout: 15000 }).toBe(true);
}
async function reap(p: ChildProcess) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  await new Promise<void>(resolve => { p.once('close', () => resolve()); p.kill('SIGKILL'); });
}
async function recover() {
  const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  return recoverOperationalOwnership(db, { expectedToken: gate.owner_token!, operator: 'fixture',
    evidence: 'Fixture child killed and close/reap awaited; no supervisor', shutdownAcknowledged: true });
}
test.beforeAll(async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(parsed.pathname)
    || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search || parsed.hash) throw new Error('UNSAFE_TEST_DATABASE');
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', e => queries.push(e.query));
  db = new Proxy(client, { get(target, key) {
    if (key === '$transaction') return async (...args: unknown[]) => {
      const start = performance.now(); transactionOpen++;
      try { return await (target.$transaction as Function).apply(target, args); }
      finally { transactionOpen--; transactionMs.push(performance.now() - start); }
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  const [state] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  if (state.count !== BigInt(0)) throw new Error('NEW_EMPTY_DATABASE_REQUIRED');
  for (const name of readdirSync('prisma/migrations').sort().filter(n => existsSync(`prisma/migrations/${n}/migration.sql`))) {
    execFileSync('psql', [url!, '-X', '-v', 'ON_ERROR_STOP=1', '-f', `prisma/migrations/${name}/migration.sql`], { stdio: 'pipe' });
  }
  // Exact existing report view; no alternate converter projection.
  const sql = readFileSync('scripts/sql/04_create_views.sql', 'utf8');
  const start = sql.indexOf('CREATE OR REPLACE VIEW vw_laporan_pemasukan AS');
  await db.$executeRawUnsafe(sql.slice(start, sql.indexOf(';', start) + 1));
  await db.companies.createMany({ data: [1370, 1380, 1310].map(code => ({ code, name: `Fixture ${code}`,
    company_type: code === 1310 ? 'BZ' : 'SEZ' })) });
  await db.insw_uom_mapping.create({ data: { wms_uom: 'PCS', insw_uom: 'PCE' } });
  server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    expect(req.headers['x-insw-key']).toBe('isolated-fixture-key');
    expect(req.headers['x-unique-key']).toBe('isolated-fixture-unique'); expect(req.method).toBe('POST');
    arrivals.push({ at: Date.now(), body: JSON.parse(body) }); active++; maxActive = Math.max(maxActive, active);
    res.once('close', () => active--); handler(res);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/transaksi`;
});
test.beforeEach(async () => {
  arrivals = []; active = 0; maxActive = 0; queries = []; transactionMs = [];
  handler = res => { res.setHeader('content-type', 'application/json'); res.end('{"status":true,"code":"00","data":[]}'); };
  await db.$executeRaw`UPDATE insw_dispatch_gate SET busy_attempt_id = NULL, owner_token = NULL, lease_until = NULL,
    last_started_at = NULL, recovery_barrier_at = NULL, prior_interval_ms = NULL, process_identity = NULL WHERE id = 1`;
  await db.insw_tracking_log.deleteMany(); await db.insw_queue_attempt.deleteMany(); await db.insw_queue_cycle.deleteMany();
  await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany(); await policy(0);
});
test.afterEach(async () => { for (const p of children) await reap(p); children = []; });
test.afterAll(async () => { server?.closeAllConnections(); if (server?.listening) await new Promise<void>(r => server.close(() => r())); await db?.$disconnect(); });

for (const company of [1370, 1380]) for (const nonFacility of [false, true]) {
  test(`${company} ${nonFacility ? 'N/N/N' : 'standard'} committed converter → frozen queue → HTTP → legacy tracking`, async () => {
    const row = await fixture(company, nonFacility); const p = await pilot([row.id]);
    const baseline = await new INSWIntegrationService('', '', true, db).convertPemasukanToINSW(company, [row.id]);
    expect(baseline.data[0].dokumenKegiatan[0].barangTransaksi).toHaveLength(2);
    if (nonFacility) for (const item of baseline.data[0].dokumenKegiatan[0].barangTransaksi) expect(item.dokumen).toEqual([]);
    queries = []; const result = await p.capture(company, row.id);
    const captureQueries = queries.length;
    const frozen = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: result.id } });
    expect(frozen.frozen_payload).toEqual(baseline); expect(frozen.max_auto_retry_snapshot).toBe(0);
    await db.incoming_good_items.updateMany({ where: { incoming_good_id: row.id }, data: { qty: 99 } });
    expect((await p.capture(company, row.id)).created).toBe(false);
    await p.run({ maxJobs: 1, signal: new AbortController().signal });
    expect(arrivals).toHaveLength(1); expect(arrivals[0].body).toEqual(baseline);
    const log = await db.insw_tracking_log.findFirstOrThrow();
    expect(log).toMatchObject({ transaction_id: row.id, transaction_type: 'incoming', company_code: company,
      wms_id: row.wms_id, insw_status: 'SUCCESS', insw_request_payload: baseline, retry_count: 0 });
    expect(log.queue_attempt_id).not.toBeNull(); expect(log.insw_response).toMatchObject({ status: true });
    expect((await db.insw_queue_cycle.findFirst())?.status).toBe('SUCCEEDED');
    expect((await p.capture(company, row.id)).created).toBe(false); expect(await db.insw_queue_cycle.count()).toBe(1);
    console.log('PHASE1 performance', JSON.stringify({ company, nonFacility, captureQueries, transactionMs })); expect(captureQueries).toBeLessThan(30);
  });
}

test('BZ, source/company mismatch, missing fixture authorization, endpoint refusal and forged READY all fail before HTTP', async () => {
  const bz = await fixture(1310); const sez = await fixture(1370); const p = await pilot([bz.id, sez.id]);
  for (const company of [1310, 1371, 9999]) {
    await expect(p.capture(company, bz.id)).rejects.toThrow('SEZ_COMPANY_REQUIRED');
  }
  await expect(p.capture(1380, sez.id)).rejects.toThrow('AUTHORIZED_SOURCE_COMPANY_REQUIRED');
  await expect((await pilot([])).capture(1370, sez.id)).rejects.toThrow('AUTHORIZED_SOURCE_COMPANY_REQUIRED');
  expect(await db.insw_queue_cycle.count()).toBe(0); expect(arrivals).toHaveLength(0);
  await expect(isolatedIncomingPilot(db, { authorization, sourceIds: [sez.id], endpoint: 'https://example.com' })).rejects.toThrow('LOOPBACK_HTTP_REQUIRED');
  const payload = await new INSWIntegrationService('', '', true, db).convertPemasukanToINSW(1310, [bz.id]);
  await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1310, operation: 'INCOMING',
    reference: bz.wms_id, revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' }, payload, requestedBy: 'forged-fixture', intent: 'SOURCE_COMMIT' });
  const forged = await db.insw_queue_cycle.findFirstOrThrow();
  const recoveryCount = await db.insw_worker_recovery.count();
  const token = await acquireOperationalOwnership(db);
  const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  for (let i = 0; i < 3; i++) expect((await admitNext(db, token)).job).toBeNull();
  expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate);
  expect(await db.insw_queue_cycle.findFirstOrThrow()).toEqual(forged);
  expect(await db.insw_queue_attempt.count()).toBe(0);
  expect(await db.insw_tracking_log.count()).toBe(0);
  expect(await db.insw_worker_recovery.count()).toBe(recoveryCount);
  await expect(prepareIsolatedIncomingFinalizer(db, token,
    { ...forged, attemptId: '00000000-0000-0000-0000-000000000000', admissionPolicyVersion: 1 }, { endpointUrl: endpoint }))
    .rejects.toThrow('SEZ_COMPANY_REQUIRED');
  expect(arrivals).toHaveLength(0);
});

for (const company of [1370, 1380]) test(`${company} large single source keeps every item through preparation, capture and HTTP`, async () => {
  test.setTimeout(120000);
  const nonFacility = company === 1370;
  const row = await fixture(company, nonFacility);
  const count = nonFacility ? 12000 : 55000;
  if (!nonFacility) await db.incoming_goods.update({ where: { id: row.id }, data: { ppkek_number: 'P'.repeat(50) } });
  await db.incoming_good_items.deleteMany({ where: { incoming_good_id: row.id } });
  const items = Array.from({ length: count }, (_, n) => ({ incoming_good_id: row.id,
    incoming_good_company: company, incoming_good_date: row.incoming_date, item_type: 'ROH', item_code: `ITEM-${n}`,
    item_name: 'x'.repeat(200), uom: 'PCS', qty: 1.125, currency: 'USD' as const, amount: 12.3456 }));
  // Bulk fixture writes; no per-item DB awaits in capture/conversion.
  for (let offset = 0; offset < items.length; offset += 1000) await db.incoming_good_items.createMany({ data: items.slice(offset, offset + 1000) });
  const sourceBytes = Buffer.byteLength(JSON.stringify({ wms_id: row.wms_id, company_code: company,
    owner: company, customs_document_type: nonFacility ? 'N' : 'BC23', ppkek_number: nonFacility ? 'N' : 'P'.repeat(50),
    customs_registration_date: nonFacility ? 'N' : '2026-10-23', incoming_evidence_number: 'EVIDENCE',
    incoming_date: '2026-10-24', invoice_number: 'INV', invoice_date: '2026-10-23', shipper_name: 'Synthetic Supplier',
    timestamp: '2026-10-24T00:00:00Z', items: items.map(({ item_type, item_code, item_name, uom, qty, currency, amount }) =>
      ({ item_type, item_code, item_name, uom, qty, currency, amount })) }));
  expect(sourceBytes).toBeGreaterThan(1024 * 1024); expect(sourceBytes).toBeLessThan(20 * 1024 * 1024);
  const baseline = await new INSWIntegrationService('', '', true, db).convertPemasukanToINSW(company, [row.id]);
  const envelopeBytes = Buffer.byteLength(JSON.stringify(baseline));
  if (!nonFacility) expect(envelopeBytes).toBeGreaterThan(20 * 1024 * 1024);
  expect(() => prepareIncomingHandoff({ companyCode: company, wmsReference: row.wms_id!, revision: 'ACCEPTED_WMS_ID',
    businessDate: '2026-10-24', requestedBy: 'test', payload: baseline, authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' })).not.toThrow();
  const p = await pilot([row.id]); const result = await p.capture(company, row.id);
  expect((await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: result.id } })).frozen_payload).toEqual(baseline);
  await p.run({ maxJobs: 1, signal: new AbortController().signal });
  expect(arrivals).toHaveLength(1); expect(arrivals[0].body).toEqual(baseline);
  const sent = (arrivals[0].body as any).data[0].dokumenKegiatan[0].barangTransaksi;
  expect(sent).toHaveLength(count); expect(new Set(sent.map((item: any) => item.kdBarang)).size).toBe(count);
  if (nonFacility) expect(sent.every((item: any) => item.dokumen.length === 0)).toBe(true);
  expect((await db.insw_tracking_log.findFirstOrThrow()).insw_request_payload).toEqual(baseline);
  console.log('PHASE1 large parity', { company, count, sourceBytes, envelopeBytes, transactionMs,
    maxRssKiB: process.resourceUsage().maxRSS, heapUsed: process.memoryUsage().heapUsed });
});

test('invalid READY tail cannot starve either SEZ company and receives zero lifecycle writes', async () => {
  const a = await fixture(1370); const b = await fixture(1380, true); const bz = await fixture(1310);
  const payload = await new INSWIntegrationService('', '', true, db).convertPemasukanToINSW(1370, [a.id]);
  for (const companyCode of [1310, 1371, 9999, 1370, 1380]) {
    await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode, operation: 'INCOMING',
      reference: bz.wms_id, revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' }, payload,
      requestedBy: 'forged-fixture', intent: 'SOURCE_COMMIT' });
  }
  for (const [reference, revision, businessDate] of [
    [a.wms_id, 'WRONG_REVISION', '2026-10-24'], [a.wms_id, 'ACCEPTED_WMS_ID', '2026-10-23'],
  ]) await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1370, operation: 'INCOMING',
    reference, revision, businessDate }, payload, requestedBy: 'forged-fixture', intent: 'SOURCE_COMMIT' });
  await db.insw_queue_cycle.create({ data: { company_code: 1370, operation: 'INCOMING', identity_key: 'malformed-identity',
    source_revision: 'ACCEPTED_WMS_ID', business_date: 'not-a-date', wms_reference: a.wms_id,
    cycle: 1, intent: 'SOURCE_COMMIT', requested_by: 'forged-fixture', frozen_payload: JSON.parse(JSON.stringify(payload)), payload_sha256: '0'.repeat(64),
    max_auto_retry_snapshot: 0 } });
  const recoveryCount = await db.insw_worker_recovery.count();
  const invalid = await db.insw_queue_cycle.findMany({ orderBy: { tail_key: 'asc' } });
  const p = await pilot([a.id, b.id]); await p.capture(1370, a.id); await p.capture(1380, b.id);
  await p.run({ maxJobs: 2, signal: new AbortController().signal });
  expect(arrivals).toHaveLength(2);
  expect(await db.insw_queue_cycle.findMany({ where: { id: { in: invalid.map(r => r.id) } }, orderBy: { tail_key: 'asc' } })).toEqual(invalid);
  expect(await db.insw_queue_attempt.count({ where: { queue_id: { in: invalid.map(r => r.id) } } })).toBe(0);
  expect(await db.insw_queue_attempt.count()).toBe(2); expect(await db.insw_tracking_log.count()).toBe(2);
  expect((await db.insw_tracking_log.findMany()).map(r => r.company_code).sort()).toEqual([1370, 1380]);
  expect(await db.insw_worker_recovery.count()).toBe(recoveryCount);
});

test('approved code with actual BZ type is rejected at capture and ignored at READY claim', async () => {
  const row = await fixture(1370); const p = await pilot([row.id]); const captured = await p.capture(1370, row.id);
  const original = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: captured.id } });
  const token = await acquireOperationalOwnership(db); const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  await db.companies.update({ where: { code: 1370 }, data: { company_type: 'BZ' } });
  try {
    await expect(p.capture(1370, row.id)).rejects.toThrow('AUTHORIZED_SOURCE_COMPANY_REQUIRED');
    expect((await admitNext(db, token)).job).toBeNull();
    expect(await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: captured.id } })).toEqual(original);
    expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate);
    expect(await db.insw_queue_attempt.count()).toBe(0); expect(await db.insw_tracking_log.count()).toBe(0);
    await expect(prepareIsolatedIncomingFinalizer(db, token,
      { ...original, attemptId: '00000000-0000-0000-0000-000000000000', admissionPolicyVersion: 1 }, { endpointUrl: endpoint }))
      .rejects.toThrow('INCOMING_SOURCE_IDENTITY_UNCONFIRMED');
    expect(arrivals).toHaveLength(0);
  } finally { await db.companies.update({ where: { code: 1370 }, data: { company_type: 'SEZ' } }); }
});

test('capturing process exits, READY persists, new worker sends; in-flight death recovers to HOLD without repost', async () => {
  const row = await fixture(1370); const capturing = child([row.id], row.id, 1370); await event(capturing, 'captured'); await reap(capturing);
  expect((await db.insw_queue_cycle.findFirst())?.status).toBe('READY');
  handler = () => {}; const sending = child([row.id]); await event(sending, 'admitted');
  await expect.poll(() => arrivals.length).toBe(1); await reap(sending);
  await recover(); expect((await db.insw_queue_cycle.findFirst())?.status).toBe('HELD');
  const restarted = child([row.id]); await event(restarted, 'owned');
  await new Promise(r => setTimeout(r, 3800)); expect(arrivals).toHaveLength(1); await reap(restarted);
});

test('two companies, competing processes, short and long HTTP: global no overlap and 3600ms floor despite policy 1ms', async () => {
  const a = await fixture(1370); const b = await fixture(1380); const c = await fixture(1370, true);
  await policy(0, 1); const p = await pilot([a.id, b.id, c.id]);
  for (const row of [a, b, c]) await p.capture(row.company_code, row.id);
  handler = res => setTimeout(() => res.end('{"status":true}'), arrivals.length === 2 ? 3900 : 20);
  const owner = child([a.id, b.id, c.id], undefined, undefined, 3); await event(owner, 'owned');
  const competitor = child([a.id, b.id, c.id]); await event(competitor, 'blocked');
  await event(owner, 'drained'); expect(arrivals).toHaveLength(3); expect(maxActive).toBe(1);
  const gaps = arrivals.slice(1).map((arrival, i) => arrival.at - arrivals[i].at);
  console.log('PHASE1 start gaps ms', gaps); for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(3600);
});

test('known explicit transient rejection retries frozen payload at tail; max snapshot 10, default 0', async () => {
  await policy(10); const a = await fixture(1370); const b = await fixture(1380); const p = await pilot([a.id, b.id]);
  await p.capture(1370, a.id); await p.capture(1380, b.id);
  handler = res => { res.setHeader('content-type', 'application/json'); res.statusCode = arrivals.length === 1 ? 503 : 200;
    res.end(JSON.stringify({ status: arrivals.length !== 1 })); };
  await p.run({ maxJobs: 3, signal: new AbortController().signal });
  expect(arrivals.map(a => (a.body as any).data[0].dokumenKegiatan[0].nomorDokKegiatan)).toEqual([a.wms_id, b.wms_id, a.wms_id]);
  expect(arrivals[0].body).toEqual(arrivals[2].body); expect(await db.insw_tracking_log.count()).toBe(3);
  expect((await db.insw_queue_cycle.findMany()).every(c => c.status === 'SUCCEEDED')).toBe(true);
});

for (const kind of ['timeout', 'duplicate', 'permanent'] as const) test(`${kind} never loops or becomes SUCCESS`, async () => {
  await policy(10); const row = await fixture(1370); const p = await pilot([row.id]); await p.capture(1370, row.id);
  handler = res => { if (kind === 'timeout') { setTimeout(() => res.end('{"status":true}'), 250); return; }
    res.statusCode = kind === 'permanent' ? 401 : 400; res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: false, code: '02', message: `Atas nomor dokumen kegiatan ${row.wms_id} sudah pernah dikirim` })); };
  await p.run({ maxJobs: 1, timeoutMs: kind === 'timeout' ? 50 : 1000, signal: new AbortController().signal });
  expect(arrivals).toHaveLength(1); expect((await db.insw_queue_cycle.findFirst())?.status).toBe(kind === 'permanent' ? 'FAILED' : 'HELD');
  expect((await db.insw_tracking_log.findFirst())?.insw_status).toBe('FAILED'); expect(await db.insw_queue_attempt.count()).toBe(1);
});

test('success + exhausted local writer repairs retains durable hold and exactly one POST', async () => {
  const row = await fixture(1370); const p = await pilot([row.id]); await p.capture(1370, row.id);
  await db.$executeRawUnsafe(`CREATE FUNCTION phase1_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'phase1 local failure'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER phase1_reject BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION phase1_reject()');
  try {
    await expect(p.run({ maxJobs: 2, signal: new AbortController().signal })).rejects.toThrow('phase1 local failure');
    expect(arrivals).toHaveLength(1); expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'HELD',
      delivery_state: 'KNOWN_SUCCESS', hold_reason: 'LOCAL_FINALIZATION_REQUIRED' });
    expect(await db.insw_tracking_log.count()).toBe(0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER phase1_reject ON insw_tracking_log'); await db.$executeRawUnsafe('DROP FUNCTION phase1_reject()');
  }
});

test('zero retry default stops known rejection; policy above 10 still permits only 10 additional attempts', async () => {
  const row = await fixture(1370); const p = await pilot([row.id]);
  // Misconfigured snapshot above the business ceiling is clamped by finalization.
  await policy(11); await p.capture(1370, row.id);
  handler = res => { res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end('{"status":false}'); };
  await p.run({ maxJobs: 11, signal: new AbortController().signal });
  expect(arrivals).toHaveLength(11); expect(await db.insw_queue_attempt.count()).toBe(11);
  expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'FAILED', retry_index: 10 });
});

test('default zero automatic retries stops even a known transient rejection', async () => {
  const row = await fixture(1380); const p = await pilot([row.id]); await p.capture(1380, row.id);
  handler = res => { res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.end('{"status":false}'); };
  await p.run({ maxJobs: 1, signal: new AbortController().signal });
  expect(arrivals).toHaveLength(1); expect((await db.insw_queue_cycle.findFirst())?.status).toBe('FAILED');
});

test('HTTP wait retains stream ownership while DB transactions have settled', async () => {
  const row = await fixture(1370); const p = await pilot([row.id]); await p.capture(1370, row.id);
  let response: ServerResponse | undefined; handler = res => { response = res; };
  const running = p.run({ maxJobs: 1, signal: new AbortController().signal });
  await expect.poll(() => arrivals.length).toBe(1);
  // Start timestamp bookkeeping may briefly run concurrently with HTTP. It must
  // settle independently, without waiting for the remote response.
  await expect.poll(() => transactionOpen).toBe(0);
  await new Promise(resolve => setTimeout(resolve, 500)); expect(transactionOpen).toBe(0);
  expect((await db.insw_dispatch_gate.findFirst())?.busy_attempt_id).not.toBeNull();
  response!.end('{"status":true}'); await running;
  console.log('PHASE1 transactions during delayed HTTP', JSON.stringify(transactionMs));
});

for (const body of ['<html>unavailable</html>', '{"message":"unavailable"}']) {
  test(`503 without explicit remote status:false holds: ${body}`, async () => {
    await policy(10); const row = await fixture(1370); const p = await pilot([row.id]); await p.capture(1370, row.id);
    handler = res => { res.statusCode = 503; res.end(body); };
    await p.run({ maxJobs: 1, signal: new AbortController().signal });
    expect(arrivals).toHaveLength(1); expect((await db.insw_queue_cycle.findFirst())?.status).toBe('HELD');
  });
}

test('concurrent duplicate admission freezes one cycle, with no HTTP during capture', async () => {
  const row = await fixture(1370); const p = await pilot([row.id]);
  const results = await Promise.all([p.capture(1370, row.id), p.capture(1370, row.id)]);
  expect(results[0].id).toBe(results[1].id); expect(await db.insw_queue_cycle.count()).toBe(1);
  expect(results.filter(result => result.created)).toHaveLength(1); expect(arrivals).toHaveLength(0);
});
