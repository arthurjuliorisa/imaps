import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { isolatedProductionPilot } from '../lib/insw-worker/production-pilot';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { prepareIsolatedMaterialUsageFinalizer, prepareIsolatedProductionOutputFinalizer } from '../lib/insw-worker/incoming-finalizer';
import { prepareMaterialUsageHandoff, prepareProductionOutputHandoff } from '../lib/insw-queue/incoming-handoff';
import { enqueueExisting } from '../lib/insw-queue/queue.repository';
import { readPolicy, updatePolicy } from '../lib/insw-queue/policy.repository';
import { acquireOperationalOwnership, admitNext, recoverOperationalOwnership } from '../lib/insw-worker/operational.repository';

const url = process.env.INSW_OUTCOME_TEST_DATABASE_URL;
test.skip(!url, 'NEW empty disposable loopback *_phase_c2b_test required');
let db: PrismaClient; let server: Server; let endpoint: string;
let arrivals: { at: number; body: unknown }[]; let handler: (res: ServerResponse) => void;
let active = 0; let maxActive = 0; let transactionOpen = 0; let transactionMs: number[] = []; let queries: string[] = []; let children: ChildProcess[] = [];
const messages = new Map<ChildProcess, string[]>();
type Operation = 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT';
const authorization = 'DISPOSABLE_MU_PO_FIXTURES_ONLY' as const;
async function productionFixture(operation: Operation, company: number, reversed = false, ref = `${operation}-${company}-${reversed}`) {
  const data = { company_code: company, owner: company, wms_id: ref, transaction_date: new Date('2026-10-24'),
    internal_evidence_number: 'SAME-EVIDENCE', reversal: reversed ? 'Y' : null, section: 'Fixture section', timestamp: new Date() };
  if (operation === 'MATERIAL_USAGE') {
    const row = await db.material_usages.create({ data: { ...data, work_order_number: 'MU-WO' } });
    await db.material_usage_items.createMany({ data: ['PP123', 'N', null].flatMap((ppkek_number, n) => [1, 2].map(m => ({
      material_usage_id: row.id, material_usage_company: company, material_usage_date: row.transaction_date,
      item_type: m === 1 ? 'ROH' : 'HALB', item_code: `MATERIAL-${m}`, item_name: `Material ${m}`,
      uom: 'PCS', qty: (n + 1) * m * 1.125, amount: n === 2 ? null : m * 12.3456,
      ppkek_number, component_demand_qty: m * 100.125 }))) });
    return row;
  }
  const row = await db.production_outputs.create({ data });
  await db.production_output_items.createMany({ data: [1, 2].map(n => ({ production_output_id: row.id,
    production_output_company: company, production_output_date: row.transaction_date,
    item_type: n === 1 ? 'FERT' : 'HALB', item_code: `OUTPUT-${n}`, item_name: `Output ${n}`, uom: 'PCS',
    qty: n * 1.125, amount: n === 2 ? null : 12.3456, work_order_number: `WO-${n}`,
    planned_production_qty: n * 100.125, identify_product: n === 1 ? 'Y' : 'N' })) });
  return row;
}
async function policy(retries: number, interval = 3600) {
  const p = await readPolicy(db); await updatePolicy(db, p.version,
    { min_processing_interval_ms: interval, max_auto_retry: retries }, 'fixture', 'Disposable Phase 2B only');
}
function productionChild(operation: Operation, ids: number[], captureId?: number, company?: number, maxJobs = 1, incomingSourceIds: number[] = [], stopBeforeSend = false) {
  const p = fork('scripts/test-fixtures/insw-production-pilot.ts', [], { execArgv: ['--import', 'tsx'],
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/unavailable',
      INSW_OUTCOME_TEST_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  messages.set(p, []); p.on('message', (m: { event: string }) => messages.get(p)!.push(m.event));
  p.stderr?.on('data', data => process.stderr.write(data)); children.push(p);
  p.send({ operation, materialUsageSourceIds: operation === 'MATERIAL_USAGE' ? ids : [],
    productionOutputSourceIds: operation === 'PRODUCTION_OUTPUT' ? ids : [], endpoint, captureId, company, maxJobs, incomingSourceIds, stopBeforeSend }); return p;
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
  for (const view of ['vw_laporan_pemasukan', 'vw_laporan_pengeluaran']) {
    const start = sql.indexOf(`CREATE OR REPLACE VIEW ${view} AS`);
    await db.$executeRawUnsafe(sql.slice(start, sql.indexOf(';', start) + 1));
  }
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
  await db.material_usage_items.deleteMany(); await db.material_usages.deleteMany();
  await db.production_output_items.deleteMany(); await db.production_outputs.deleteMany();
  await db.outgoing_good_items.deleteMany(); await db.outgoing_goods.deleteMany();
  await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany(); await policy(0);
});
test.afterEach(async () => { for (const p of children) await reap(p); children = []; });
test.afterAll(async () => { server?.closeAllConnections(); if (server?.listening) await new Promise<void>(r => server.close(() => r())); await db?.$disconnect(); });

for (const operation of ['MATERIAL_USAGE', 'PRODUCTION_OUTPUT'] as const) test.describe(operation, () => {
  const transactionType = operation === 'MATERIAL_USAGE' ? 'material_usage' : 'production_output';
  const sourceTable: any = operation === 'MATERIAL_USAGE' ? new Proxy({}, { get: (_, k) => (db.material_usages as any)[k].bind(db.material_usages) })
    : new Proxy({}, { get: (_, k) => (db.production_outputs as any)[k].bind(db.production_outputs) });
  const detailTable: any = new Proxy({}, { get: (_, k) => { const t: any = operation === 'MATERIAL_USAGE' ? db.material_usage_items : db.production_output_items; return t[k].bind(t); } });
  const sourceForeignKey = operation === 'MATERIAL_USAGE' ? 'material_usage_id' : 'production_output_id';
  const detailCompanyKey = operation === 'MATERIAL_USAGE' ? 'material_usage_company' : 'production_output_company';
  const detailDateKey = operation === 'MATERIAL_USAGE' ? 'material_usage_date' : 'production_output_date';
  const detailCount = operation === 'MATERIAL_USAGE' ? 6 : 2;
  const activity = (reversed: boolean) => (operation === 'PRODUCTION_OUTPUT') !== reversed ? '30' : '31';
  const fixture = (company: number, reversed = false, ref?: string) => productionFixture(operation, company, reversed, ref);
  const prepareFinalizer = operation === 'MATERIAL_USAGE' ? prepareIsolatedMaterialUsageFinalizer : prepareIsolatedProductionOutputFinalizer;
  const prepareHandoff = (input: Parameters<typeof prepareMaterialUsageHandoff>[0]) =>
    operation === 'MATERIAL_USAGE' ? prepareMaterialUsageHandoff(input, null) : prepareProductionOutputHandoff(input, null);
  async function convertSource(company: number, ids: number[]) {
    const converter = new INSWIntegrationService('', '', true, db);
    return operation === 'MATERIAL_USAGE' ? converter.convertMaterialUsageToINSW(company, ids) : converter.convertProductionOutputToINSW(company, ids);
  }
  async function pilot(ids: number[], database = db) {
    const p = await isolatedProductionPilot(database, { authorization, endpoint,
      materialUsageSourceIds: operation === 'MATERIAL_USAGE' ? ids : [], productionOutputSourceIds: operation === 'PRODUCTION_OUTPUT' ? ids : [] });
    return { capture: operation === 'MATERIAL_USAGE' ? p.captureMaterialUsage : p.captureProductionOutput, run: p.run };
  }
  const child = (ids: number[], captureId?: number, company?: number, maxJobs = 1, incomingSourceIds: number[] = [], stopBeforeSend = false) =>
    productionChild(operation, ids, captureId, company, maxJobs, incomingSourceIds, stopBeforeSend);
for (const company of [1370, 1380]) for (const reversed of [false, true]) {
  test(`${company} ${reversed ? 'reversed' : 'normal'} committed converter → frozen queue → HTTP → legacy tracking`, async () => {
    const row = await fixture(company, reversed); const p = await pilot([row.id]);
    const baseline = await convertSource(company, [row.id]);
    expect(baseline.data[0].dokumenKegiatan[0].barangTransaksi).toHaveLength(detailCount);
    expect(baseline.data[0].kdKegiatan).toBe(activity(reversed));
    const headerBefore = await sourceTable.findUniqueOrThrow({ where: { id: row.id } });
    const before = await detailTable.findMany({ orderBy: { id: 'asc' } });
    if (operation === 'MATERIAL_USAGE') {
      expect(before.map((r: any) => r.ppkek_number)).toEqual(['PP123', 'PP123', 'N', 'N', null, null]);
      expect(before.map((r: any) => Number(r.component_demand_qty))).toEqual([100.125, 200.25, 100.125, 200.25, 100.125, 200.25]);
    } else {
      expect(before.map((r: any) => r.work_order_number)).toEqual(['WO-1', 'WO-2']);
      expect(before.map((r: any) => Number(r.planned_production_qty))).toEqual([100.125, 200.25]);
      expect(before.map((r: any) => r.identify_product)).toEqual(['Y', 'N']);
    }
    const items = baseline.data[0].dokumenKegiatan[0].barangTransaksi;
    expect(items.map(i => [i.kdBarang, i.jumlah, i.nilai, i.kdSatuan, i.dokumen])).toEqual(
      before.map((r: any) => [r.item_code, Number(r.qty), Number(r.amount ?? 0), 'PCE', []]));
    queries = []; const result = await p.capture(company, row.id);
    const captureQueries = queries.length;
    const frozen = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: result.id } });
    expect(frozen.frozen_payload).toEqual(baseline); expect(frozen.max_auto_retry_snapshot).toBe(0);

    expect((await p.capture(company, row.id)).created).toBe(false);
    await p.run({ maxJobs: 1, signal: new AbortController().signal });
    expect(arrivals).toHaveLength(1); expect(arrivals[0].body).toEqual(baseline);
    const log = await db.insw_tracking_log.findFirstOrThrow();
    expect(log).toMatchObject({ transaction_id: row.id, transaction_type: transactionType, company_code: company,
      wms_id: row.wms_id, insw_activity_code: activity(reversed), insw_status: 'SUCCESS', insw_request_payload: baseline, retry_count: 0 });
    expect(log.queue_attempt_id).not.toBeNull(); expect(log.insw_response).toMatchObject({ status: true });
    expect((await db.insw_queue_cycle.findFirst())?.status).toBe('SUCCEEDED');
    expect((await p.capture(company, row.id)).created).toBe(false); expect(await db.insw_queue_cycle.count()).toBe(1);
    expect(await detailTable.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
    expect(await sourceTable.findUniqueOrThrow({ where: { id: row.id } })).toEqual(headerBefore);
    console.log('PHASE2B performance', JSON.stringify({ operation, company, reversed, captureQueries, transactionMs })); expect(captureQueries).toBeLessThan(30);
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
  await expect(isolatedProductionPilot(db, { authorization, materialUsageSourceIds: [], productionOutputSourceIds: [], endpoint: 'https://example.com' })).rejects.toThrow('LOOPBACK_HTTP_REQUIRED');
  const payload = await convertSource(1310, [bz.id]);
  await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1310, operation,
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
  await expect(prepareFinalizer(db, token,
    { ...forged, attemptId: '00000000-0000-0000-0000-000000000000', admissionPolicyVersion: 1 }, { endpointUrl: endpoint }))
    .rejects.toThrow('SEZ_COMPANY_REQUIRED');
  expect(arrivals).toHaveLength(0);
});

for (const company of [1370, 1380]) test(`${company} large complete source exceeds 1 MiB without row loss`, async () => {
  test.setTimeout(120000);
  const row = await fixture(company); const count = operation === 'MATERIAL_USAGE' && company === 1370 ? 70000 : 12000;
  await detailTable.deleteMany();
  const details = Array.from({ length: count }, (_, n) => ({ [sourceForeignKey]: row.id, [detailCompanyKey]: company,
    [detailDateKey]: row.transaction_date, item_type: operation === 'MATERIAL_USAGE' ? 'ROH' : 'HALB',
    item_code: operation === 'MATERIAL_USAGE' ? 'MATERIAL-LARGE' : `ITEM-${n}`, item_name: 'x'.repeat(200), uom: 'PCS', qty: 1.125, amount: 12.3456,
    ...(operation === 'MATERIAL_USAGE' ? { ppkek_number: [null, 'N', 'PP123'][n % 3], component_demand_qty: 100.125 }
      : { work_order_number: `WO-${n}`, planned_production_qty: 200.125, identify_product: 'Y' }) }));
  for (let offset = 0; offset < count; offset += 1000) await detailTable.createMany({ data: details.slice(offset, offset + 1000) });
  const sourceBytes = Buffer.byteLength(JSON.stringify({ wms_id: row.wms_id, company_code: company, owner: company,
    transaction_date: '2026-10-24', internal_evidence_number: 'SAME-EVIDENCE', timestamp: '2026-10-24T00:00:00Z',
    ...(operation === 'MATERIAL_USAGE' ? { work_order_number: 'MU-WO' } : {}),
    items: operation === 'MATERIAL_USAGE' ? [{ item_type: 'ROH', item_code: 'MATERIAL-LARGE', item_name: 'x'.repeat(200),
      uom: 'PCS', amount: 12.3456, component_demand_qty: 100.125,
      traceability_data: details.map(d => {
        if (!('ppkek_number' in d)) throw new Error('MU_TRACE_FIXTURE_REQUIRED');
        return { ppkek_number: d.ppkek_number, qty: d.qty };
      }) }]
      : details.map(d => {
        if (!('work_order_number' in d)) throw new Error('PO_WO_FIXTURE_REQUIRED');
        return { item_type: d.item_type, item_code: d.item_code, item_name: d.item_name, uom: d.uom,
          amount: d.amount, qty: d.qty, work_order_number: d.work_order_number,
          planned_production_qty: d.planned_production_qty, identify_product: d.identify_product };
      }) }));
  expect(sourceBytes).toBeLessThan(20 * 1024 * 1024);
  const baseline = await convertSource(company, [row.id]);
  const envelopeBytes = Buffer.byteLength(JSON.stringify(baseline)); expect(envelopeBytes).toBeGreaterThan(1024 * 1024);
  if (count === 70000) expect(envelopeBytes).toBeGreaterThan(20 * 1024 * 1024);
  queries = []; transactionMs = []; const p = await pilot([row.id]); const result = await p.capture(company, row.id);
  const captureQueries = queries.length; expect(captureQueries).toBeLessThan(30);
  expect((await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: result.id } })).frozen_payload).toEqual(baseline);
  await p.run({ maxJobs: 1, signal: new AbortController().signal });
  expect(arrivals).toHaveLength(1); expect(arrivals[0].body).toEqual(baseline);
  expect((arrivals[0].body as any).data[0].dokumenKegiatan[0].barangTransaksi).toHaveLength(count);
  expect((await db.insw_tracking_log.findFirstOrThrow()).insw_request_payload).toEqual(baseline);
  console.log('PHASE2B large parity', { operation, company, count, sourceBytes, envelopeBytes, captureQueries, transactionMs,
    maxRssKiB: process.resourceUsage().maxRSS, heapUsed: process.memoryUsage().heapUsed });
});

test('invalid READY tail cannot starve either SEZ company and receives zero lifecycle writes', async () => {
  const a = await fixture(1370); const b = await fixture(1380, true); const bz = await fixture(1310);
  const payload = await convertSource(1370, [a.id]);
  for (const companyCode of [1310, 1371, 9999, 1370, 1380]) {
    await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode, operation,
      reference: bz.wms_id, revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' }, payload,
      requestedBy: 'forged-fixture', intent: 'SOURCE_COMMIT' });
  }
  for (const [reference, revision, businessDate] of [
    [a.wms_id, 'WRONG_REVISION', '2026-10-24'], [a.wms_id, 'ACCEPTED_WMS_ID', '2026-10-23'],
  ]) await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1370, operation,
    reference, revision, businessDate }, payload, requestedBy: 'forged-fixture', intent: 'SOURCE_COMMIT' });
  await db.insw_queue_cycle.create({ data: { company_code: 1370, operation, identity_key: 'malformed-identity',
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
    await expect(prepareFinalizer(db, token,
      { ...original, attemptId: '00000000-0000-0000-0000-000000000000', admissionPolicyVersion: 1 }, { endpointUrl: endpoint }))
      .rejects.toThrow(`${operation}_SOURCE_IDENTITY_UNCONFIRMED`);
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
  expect((await p.capture(1370, row.id)).created).toBe(false); expect(await db.insw_queue_cycle.count()).toBe(1);
});

test('success + exhausted local writer repairs retains durable hold and exactly one POST', async () => {
  const row = await fixture(1370); const p = await pilot([row.id]); await p.capture(1370, row.id);
  await db.$executeRawUnsafe(`CREATE FUNCTION phase2b_reject() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'phase2b local failure'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER phase2b_reject BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION phase2b_reject()');
  try {
    await expect(p.run({ maxJobs: 2, signal: new AbortController().signal })).rejects.toThrow('phase2b local failure');
    expect(arrivals).toHaveLength(1); expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'HELD',
      delivery_state: 'KNOWN_SUCCESS', hold_reason: 'LOCAL_FINALIZATION_REQUIRED' });
    expect(await db.insw_tracking_log.count()).toBe(0);
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER phase2b_reject ON insw_tracking_log'); await db.$executeRawUnsafe('DROP FUNCTION phase2b_reject()');
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
  console.log('PHASE2B transactions during delayed HTTP', JSON.stringify(transactionMs));
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


test('known success repairs a transient local tracking failure without a second HTTP', async () => {
  const row = await fixture(1380); const p = await pilot([row.id]); await p.capture(1380, row.id);
  await db.$executeRawUnsafe('CREATE SEQUENCE phase2b_failure_count');
  await db.$executeRawUnsafe(`CREATE FUNCTION phase2b_once() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN IF nextval('phase2b_failure_count') = 1 THEN RAISE EXCEPTION 'local once'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER phase2b_once BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION phase2b_once()');
  try {
    await p.run({ maxJobs: 1, signal: new AbortController().signal });
    expect(arrivals).toHaveLength(1); expect(await db.insw_tracking_log.count()).toBe(1);
    expect(await db.insw_queue_attempt.count()).toBe(1);
    expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'SUCCEEDED', delivery_state: 'KNOWN_SUCCESS' });
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER phase2b_once ON insw_tracking_log');
    await db.$executeRawUnsafe('DROP FUNCTION phase2b_once()'); await db.$executeRawUnsafe('DROP SEQUENCE phase2b_failure_count');
  }
});

test('crash after claim but before HTTP conservatively holds with zero sends', async () => {
  const row = await fixture(1370); const p = await pilot([row.id]); await p.capture(1370, row.id);
  const stopped = child([row.id], undefined, undefined, 1, [], true); await event(stopped, 'admitted');
  await reap(stopped); expect(arrivals).toHaveLength(0); await recover();
  expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'HELD', hold_reason: 'DELIVERY_UNKNOWN' });
  const restarted = child([row.id]); await event(restarted, 'owned');
  await new Promise(resolve => setTimeout(resolve, 3800)); expect(arrivals).toHaveLength(0); await reap(restarted);
});


test('two same-company sources with identical evidence/date remain independent single-source requests', async () => {
  const a = await fixture(1370, false, 'OUT-A'); const b = await fixture(1370, false, 'OUT-B');
  await detailTable.updateMany({ where: { [sourceForeignKey]: b.id }, data: { qty: 8.125, amount: 99.1234 } });
  const converter = new INSWIntegrationService('', '', true, db);
  const baselines = await Promise.all([a, b].map(row => convertSource(1370, [row.id])));
  const p = await pilot([a.id, b.id]); await p.capture(1370, a.id); await p.capture(1370, b.id);
  await p.run({ maxJobs: 2, signal: new AbortController().signal });
  expect(arrivals.map(a => a.body)).toEqual(baselines);
  expect(arrivals.map(a => (a.body as any).data[0].dokumenKegiatan[0].barangTransaksi.length)).toEqual([detailCount, detailCount]);
  expect(await db.insw_queue_cycle.count()).toBe(2); expect(await db.insw_tracking_log.count()).toBe(2);
});

test('Domain preparation and final pre-HTTP defense reject a multi-document envelope without lifecycle writes', async () => {
  const a = await fixture(1370); const b = await fixture(1380);
  const converter = new INSWIntegrationService('', '', true, db);
  const payload = await convertSource(1370, [a.id]);
  const other = await convertSource(1380, [b.id]);
  payload.data[0].dokumenKegiatan.push(other.data[0].dokumenKegiatan[0]);
  expect(() => prepareHandoff({ companyCode: 1370, wmsReference: a.wms_id, revision: 'ACCEPTED_WMS_ID',
    businessDate: '2026-10-24', requestedBy: 'fixture', payload,
    authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' })).toThrow(`Expected one complete ${operation === 'MATERIAL_USAGE' ? 'Material Usage' : 'Production Output'} transmission`);
  expect(await db.insw_queue_cycle.count()).toBe(0);
  const forged = await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1370, operation,
    reference: a.wms_id, revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' }, payload,
    requestedBy: 'forged-fixture', intent: 'SOURCE_COMMIT' });
  const row = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: forged.id } });
  const token = await acquireOperationalOwnership(db); const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  await expect(prepareFinalizer(db, token,
    { ...row, attemptId: '00000000-0000-0000-0000-000000000000', admissionPolicyVersion: 1 }, { endpointUrl: endpoint }))
    .rejects.toThrow(`UNSUPPORTED_${operation}_IDENTITY_OR_BATCH`);
  expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate);
  expect(await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: forged.id } })).toEqual(row);
  expect(await db.insw_queue_attempt.count()).toBe(0); expect(await db.insw_tracking_log.count()).toBe(0);
  expect(arrivals).toHaveLength(0);
});

test('missing, deleted, revised, malformed and cross-company sources create no lifecycle evidence', async () => {
  const row = await fixture(1370); const p = await pilot([row.id, 2147483647]);
  await expect(p.capture(1370, 2147483647)).rejects.toThrow('AUTHORIZED_SOURCE_COMPANY_REQUIRED');
  await expect(p.capture(1380, row.id)).rejects.toThrow('AUTHORIZED_SOURCE_COMPANY_REQUIRED');
  await expect(p.capture(1370, NaN)).rejects.toThrow();
  await sourceTable.update({ where: { id: row.id }, data: { deleted_at: new Date() } });
  await expect(p.capture(1370, row.id)).rejects.toThrow('AUTHORIZED_SOURCE_COMPANY_REQUIRED');
  await sourceTable.update({ where: { id: row.id }, data: { deleted_at: null, wms_id: ' malformed ' } });
  await expect(p.capture(1370, row.id)).rejects.toThrow('Invalid WMS reference');
  await sourceTable.update({ where: { id: row.id }, data: { wms_id: row.wms_id } });
  expect(await db.insw_queue_cycle.count()).toBe(0);
  const payload = await convertSource(1370, [row.id]);
  const captured = await p.capture(1370, row.id);
  await sourceTable.update({ where: { id: row.id }, data: { transaction_date: new Date('2026-10-23') } });
  const invalid = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: captured.id } });
  const token = await acquireOperationalOwnership(db); const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  expect((await admitNext(db, token)).job).toBeNull();
  expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate);
  expect(await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: captured.id } })).toEqual(invalid);
  await expect(prepareFinalizer(db, token, { ...invalid, attemptId: '00000000-0000-0000-0000-000000000000',
    admissionPolicyVersion: 1 }, { endpointUrl: endpoint })).rejects.toThrow(`${operation}_SOURCE_IDENTITY_UNCONFIRMED`);
  expect(await db.insw_queue_attempt.count()).toBe(0); expect(await db.insw_tracking_log.count()).toBe(0);
  expect(await db.insw_worker_recovery.count({ where: { old_owner_token: token } })).toBe(0); expect(arrivals).toHaveLength(0);
  expect(invalid.frozen_payload).toEqual(payload);
});

test('missing mapping fails capture without omitting details or writing a queue job', async () => {
  const row = await fixture(1370); await detailTable.updateMany({ data: { uom: 'UNMAPPED' } });
  const before = await detailTable.findMany({ orderBy: { id: 'asc' } });
  await expect(convertSource(1370, [row.id])).rejects.toThrow('UOM mapping');
  await expect((await pilot([row.id])).capture(1370, row.id)).rejects.toThrow('UOM mapping');
  expect(await detailTable.findMany({ orderBy: { id: 'asc' } })).toEqual(before);
  expect(await db.insw_queue_cycle.count()).toBe(0); expect(await db.insw_queue_attempt.count()).toBe(0);
  expect(await db.insw_tracking_log.count()).toBe(0); expect(arrivals).toHaveLength(0);
});

test('forged multi-source and wrong-activity READY remain untouched and eligible later work proceeds', async () => {
  const a = await fixture(1370, false, 'BAD-BATCH'); const b = await fixture(1380, false, 'BAD-ACTIVITY');
  const c = await fixture(1370, false, 'VALID-LATER');
  const payload = await convertSource(1370, [a.id]);
  payload.data[0].dokumenKegiatan.push((await convertSource(1380, [b.id])).data[0].dokumenKegiatan[0]);
  await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1370, operation,
    reference: a.wms_id, revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' }, payload,
    requestedBy: 'forged', intent: 'SOURCE_COMMIT' });
  const wrong = await convertSource(1380, [b.id]); wrong.data[0].kdKegiatan = activity(true) as any;
  await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1380, operation,
    reference: b.wms_id, revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' }, payload: wrong,
    requestedBy: 'forged', intent: 'SOURCE_COMMIT' });
  const invalid = await db.insw_queue_cycle.findMany({ orderBy: { tail_key: 'asc' } });
  const p = await pilot([a.id, b.id, c.id]); await p.capture(1370, c.id);
  await p.run({ maxJobs: 1, signal: new AbortController().signal });
  expect(arrivals.map(a => a.body)).toEqual([await convertSource(1370, [c.id])]);
  expect(await db.insw_queue_cycle.findMany({ where: { id: { in: invalid.map(r => r.id) } }, orderBy: { tail_key: 'asc' } })).toEqual(invalid);
  expect(await db.insw_queue_attempt.count()).toBe(1); expect(await db.insw_tracking_log.count()).toBe(1);
});

test('frozen retries retain the original complete envelope after source quantities change', async () => {
  const row = await fixture(1370); const baseline = await convertSource(1370, [row.id]);
  await policy(1); const p = await pilot([row.id]); await p.capture(1370, row.id);
  await detailTable.updateMany({ data: { qty: 99.125 } });
  expect(await convertSource(1370, [row.id])).not.toEqual(baseline);
  handler = res => { res.statusCode = arrivals.length === 1 ? 503 : 200; res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: arrivals.length !== 1 })); };
  await p.run({ maxJobs: 2, signal: new AbortController().signal });
  expect(arrivals.map(a => a.body)).toEqual([baseline, baseline]);
  expect((await db.insw_tracking_log.findMany({ orderBy: { id: 'asc' } })).map(log => log.insw_request_payload)).toEqual([baseline, baseline]);
});

});

async function incomingFixture(company: number, ref: string) {
  const row = await db.incoming_goods.create({ data: { company_code: company, owner: company, wms_id: ref,
    incoming_date: new Date('2026-10-24'), ppkek_number: 'N', customs_document_type: null,
    is_non_facility: true, incoming_evidence_number: 'N', shipper_name: 'Synthetic Supplier', timestamp: new Date() } });
  await db.incoming_good_items.create({ data: { incoming_good_id: row.id, incoming_good_company: company,
    incoming_good_date: row.incoming_date, item_type: 'ROH', item_code: 'IN', item_name: 'Incoming item',
    uom: 'PCS', qty: 2, currency: 'USD', amount: 3 } });
  return row;
}

test('Incoming → MU → Outgoing → PO across both companies and contending processes: one 3600ms stream', async () => {
  const a = await incomingFixture(1370, 'MIX-IN'); const b = await productionFixture('MATERIAL_USAGE', 1380, true, 'MIX-MU');
  const c = await db.outgoing_goods.create({ data: { company_code: 1380, owner: 1380, wms_id: 'MIX-OUT',
    outgoing_date: new Date('2026-10-24'), ppkek_number: 'N', customs_document_type: null, is_non_facility: true,
    outgoing_evidence_number: 'N', recipient_name: 'Fixture Recipient', invoice_number: 'FIXTURE-INV',
    invoice_date: new Date('2026-10-23'), timestamp: new Date() } });
  await db.outgoing_good_items.create({ data: { outgoing_good_id: c.id, outgoing_good_company: 1380,
    outgoing_good_date: c.outgoing_date, item_type: 'ROH', item_code: 'OUT', item_name: 'Outgoing item', uom: 'PCS',
    qty: 1.125, amount: 12.3456, currency: 'USD' } });
  const d = await productionFixture('PRODUCTION_OUTPUT', 1370, true, 'MIX-PO');
  const config = { authorization, materialUsageSourceIds: [b.id], productionOutputSourceIds: [d.id],
    incomingSourceIds: [a.id], outgoingSourceIds: [c.id], endpoint };
  await policy(0, 1); const p = await isolatedProductionPilot(db, config);
  await p.captureIncoming(1370, a.id); await p.captureMaterialUsage(1380, b.id);
  await p.captureOutgoing(1380, c.id); await p.captureProductionOutput(1370, d.id);
  const converter = new INSWIntegrationService('', '', true, db);
  const baselines = [await converter.convertPemasukanToINSW(1370, [a.id]), await converter.convertMaterialUsageToINSW(1380, [b.id]),
    await converter.convertPengeluaranToINSWByIds(1380, [c.id]), await converter.convertProductionOutputToINSW(1370, [d.id])];
  handler = res => setTimeout(() => res.end('{"status":true}'), arrivals.length === 2 ? 3900 : 20);
  function contender(maxJobs: number) {
    const proc = fork('scripts/test-fixtures/insw-production-pilot.ts', [], { execArgv: ['--import', 'tsx'],
      env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/unavailable',
        INSW_OUTCOME_TEST_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    messages.set(proc, []); proc.on('message', (m: { event: string }) => messages.get(proc)!.push(m.event));
    proc.stderr?.on('data', data => process.stderr.write(data)); children.push(proc); proc.send({ ...config, maxJobs }); return proc;
  }
  const owner = contender(4); await event(owner, 'owned'); const competitor = contender(1); await event(competitor, 'blocked');
  await event(owner, 'drained'); expect(arrivals.map(a => a.body)).toEqual(baselines); expect(maxActive).toBe(1);
  const gaps = arrivals.slice(1).map((a, i) => a.at - arrivals[i].at);
  console.log('PHASE2B mixed start gaps ms', gaps); for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(3600);
  expect(await db.insw_queue_attempt.count()).toBe(4);
  expect((await db.insw_tracking_log.findMany({ orderBy: { id: 'asc' } })).map(log => log.insw_request_payload)).toEqual(baselines);
});
