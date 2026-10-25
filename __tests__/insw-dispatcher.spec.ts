import { test, expect } from '@playwright/test';
import { InswQueueOperation, PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { captureCompletedWmsSource, type CompletedSourceCapture } from '../lib/insw-worker/completed-source-capture';
import { acquireOperationalOwnership, admitNext } from '../lib/insw-worker/operational.repository';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';

const url = process.env.INSW_OUTCOME_TEST_DATABASE_URL;
test.skip(!url, 'NEW empty disposable loopback *_phase_c2b_test required');
let db: PrismaClient;
let queries: { query: string; params: string }[] = [];


type Operation = 'ADJUSTMENT' | 'STOCK_OPNAME';
const operations = ['INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME'] as const;

test.beforeAll(async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(parsed.pathname)
    || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search || parsed.hash) throw new Error('UNSAFE_TEST_DATABASE');
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', e => queries.push({ query: e.query, params: e.params }));
  db = client;
  const [state] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  if (state.count !== BigInt(0)) throw new Error('NEW_EMPTY_DATABASE_REQUIRED');
  for (const name of readdirSync('prisma/migrations').sort().filter(n => existsSync(`prisma/migrations/${n}/migration.sql`))) {
    execFileSync('psql', [url!, '-X', '-v', 'ON_ERROR_STOP=1', '-f', `prisma/migrations/${name}/migration.sql`], { stdio: 'pipe' });
  }
  const sql = readFileSync('scripts/sql/04_create_views.sql', 'utf8');
  for (const view of ['vw_laporan_pemasukan', 'vw_laporan_pengeluaran']) {
    const start = sql.indexOf(`CREATE OR REPLACE VIEW ${view} AS`);
    await db.$executeRawUnsafe(sql.slice(start, sql.indexOf(';', start) + 1));
  }
  await db.companies.createMany({ data: [1370, 1380, 1310, 1399].map(code => ({ code, name: `Fixture ${code}`,
    company_type: code === 1310 ? 'BZ' : 'SEZ' })) });
  await db.insw_uom_mapping.create({ data: { wms_uom: 'PCS', insw_uom: 'PCE' } });

});
test.beforeEach(async () => {
  await db.$executeRaw`UPDATE insw_dispatch_gate SET busy_attempt_id = NULL, owner_token = NULL, lease_until = NULL,
    last_started_at = NULL, recovery_barrier_at = NULL, prior_interval_ms = NULL, process_identity = NULL WHERE id = 1`;
  await db.insw_tracking_log.deleteMany(); await db.insw_queue_attempt.deleteMany(); await db.insw_queue_cycle.deleteMany();
  await db.insw_worker_recovery.deleteMany();
  await db.adjustment_items.deleteMany(); await db.adjustments.deleteMany();
  await db.wms_stock_opname_items.deleteMany(); await db.wms_stock_opnames.deleteMany();
  await db.material_usage_items.deleteMany(); await db.material_usages.deleteMany();
  await db.production_output_items.deleteMany(); await db.production_outputs.deleteMany();
  await db.wms_transmission_logs.deleteMany(); await db.activity_logs.deleteMany();
  await db.outgoing_good_items.deleteMany(); await db.outgoing_goods.deleteMany();
  await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany();
  await db.companies.updateMany({ where: { code: { in: [1370, 1380] } }, data: { company_type: 'SEZ' } });
  queries = [];
});
test.afterAll(async () => { await db?.$disconnect(); });
async function incomingFixture(company: number, nonFacility = false, ref = `SOURCE-${company}-${nonFacility}`) {
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
async function productionFixture(operation: 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT', company: number, reversed = false, ref = `${operation}-${company}-${reversed}`) {
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
async function countFixture(operation: Operation, company: number, ref = `${operation}-${company}`, id?: bigint) {
  if (operation === 'ADJUSTMENT') {
    const row = await db.adjustments.create({ data: { company_code: company, owner: company, wms_id: ref,
      internal_evidence_number: 'SAME-EVIDENCE', wms_doc_type: 'daily_adjustment',
      transaction_date: new Date('2026-10-24'), timestamp: new Date(),
      items: { create: [0, 1, 2].map(n => ({ adjustment_type: n === 1 ? 'LOSS' : 'GAIN', item_type: n === 1 ? 'HALB' : 'ROH', item_code: `ITEM-${n}`,
        item_name: `Fixture ${n}`, uom: 'PCS', qty: n === 2 ? -2.125 : n + 1.125, reason: `reason ${n}`,
        amount: 99.1234, system_qty: 100, adjusted_qty: 102 })) } } });
    return { ...row, id: BigInt(row.id) };
  }
  const row = await db.wms_stock_opnames.create({ data: { ...(id === undefined ? {} : { id }), company_code: company,
    owner: company, wms_id: ref, document_date: new Date('2026-10-24'), status: 'Confirmed',
    confirmed_at: new Date('2026-10-24T12:34:56.789Z'), items: { create: [0, 1, 2, 3].map(n => ({ company_code: company,
      item_code: `ITEM-${n}`, item_name: `Fixture ${n}`, item_type: 'ROH', uom: 'PCS', beginning_qty: 10,
      incoming_qty_on_date: 0, outgoing_qty_on_date: 0, system_qty: n === 3 ? 0 : 10.125,
      actual_qty_count: n === 0 ? 0 : null, wms_ending: n === 1 ? 4.125 : null, variance_qty: 0,
      amount: n === 2 ? null : 12.3456, original_system_qty: 10.125, original_beginning_qty: 10 })) } } });
  return row;
}

async function source(operation: CompletedSourceCapture['operation'], company = 1370, ref = `${operation}-${company}`, reversed = false) {
  if (operation === 'INCOMING') return incomingFixture(company, true, ref);
  if (operation === 'MATERIAL_USAGE' || operation === 'PRODUCTION_OUTPUT') return productionFixture(operation, company, reversed, ref);
  if (operation === 'ADJUSTMENT' || operation === 'STOCK_OPNAME') return countFixture(operation, company, ref);
  if (operation === 'OUTGOING') return outgoingFixture(company, reversed, ref);
  throw new Error('unsupported');
}
function input(operation: CompletedSourceCapture['operation'], id: number | bigint | string, company = 1370): CompletedSourceCapture {
  if (operation === 'OUTGOING') return { operation, wmsReference: String(id), companyCode: company, businessDate: '2026-10-24',
    revision: 'ACCEPTED_WMS_ID', requestedBy: 'trusted-fixture', completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED' };
  return { operation, sourceId: id, companyCode: company, businessDate: '2026-10-24',
    revision: operation === 'ADJUSTMENT' ? 'COMMITTED_SOURCE' : operation === 'STOCK_OPNAME'
      ? 'CONFIRMED:2026-10-24T12:34:56.789Z' : 'ACCEPTED_WMS_ID',
    requestedBy: 'completed-wms-source', completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED' } as CompletedSourceCapture;
}
async function counts() {
  return Promise.all([db.insw_queue_cycle.count(), db.insw_queue_attempt.count(), db.insw_tracking_log.count(), db.insw_worker_recovery.count()]);
}
async function convert(operation: CompletedSourceCapture['operation'], company: number, id: number | bigint) {
  const c = new INSWIntegrationService('', '', true, db);
  return operation === 'INCOMING' ? c.convertPemasukanToINSW(company, [Number(id)])
    : operation === 'OUTGOING' ? c.convertPengeluaranToINSWByIds(company, [Number(id)])
    : operation === 'MATERIAL_USAGE' ? c.convertMaterialUsageToINSW(company, [Number(id)])
      : operation === 'PRODUCTION_OUTPUT' ? c.convertProductionOutputToINSW(company, [Number(id)])
        : operation === 'ADJUSTMENT' ? c.convertAdjustmentToINSW(company, Number(id)) : c.convertStockOpnameToINSW(company, Number(id));
}


async function outgoingFixture(company: number, nonFacility = false, ref = `SOURCE-${company}-${nonFacility}`) {
  const row = await db.outgoing_goods.create({ data: { company_code: company, owner: company, wms_id: ref,
    outgoing_date: new Date('2026-10-24'), ppkek_number: nonFacility ? 'N' : 'PP123',
    customs_document_type: nonFacility ? null : 'BC30', is_non_facility: nonFacility,
    customs_registration_date: nonFacility ? null : new Date('2026-10-23'),
    outgoing_evidence_number: nonFacility ? 'N' : 'EVIDENCE', recipient_name: 'Synthetic Recipient', invoice_number: 'INV', invoice_date: new Date('2026-10-23'), timestamp: new Date() } });
  await db.outgoing_good_items.createMany({ data: [1, 2].map(n => ({ outgoing_good_id: row.id,
    outgoing_good_company: company, outgoing_good_date: row.outgoing_date, item_type: 'ROH', item_code: `ITEM-${n}`,
    item_name: `Synthetic ${n}`, uom: 'PCS', qty: n * 1.125, currency: 'USD', amount: n * 12.3456 })) });
  return row;
}


import { fork, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { recoverOperationalOwnership } from '../lib/insw-worker/operational.repository';
import { resendWmsLog } from '../lib/insw-queue/wms-coordination';
import { enqueueExisting } from '../lib/insw-queue/queue.repository';
let server: Server;
let endpoint: string;
let active = 0;
let maxActive = 0;
let arrivals: { at: number; body: unknown; key: string | undefined }[] = [];
let children: ChildProcess[] = [];
let reject = false;
const inbox = new Map<ChildProcess, { event: string; data?: any }[]>();
function launch(maxJobs: number) {
  const p = fork('scripts/test-fixtures/insw-production-dispatcher.ts', [], { execArgv: ['--import', 'tsx'],
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/unavailable',
      INSW_OUTCOME_TEST_DATABASE_URL: url, INSW_SYNTHETIC_ENDPOINT: endpoint }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  inbox.set(p, []); children.push(p);
  p.on('message', m => inbox.get(p)!.push(m as any));
  p.stderr?.on('data', data => process.stderr.write(data));
  p.send({ maxJobs });
  return p;
}
async function event(p: ChildProcess, name: string) {
  await expect.poll(() => inbox.get(p)?.some(m => m.event === name), { timeout: 55000 }).toBe(true);
}
async function reaped(p: ChildProcess) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  await new Promise<void>(resolve => p.once('close', () => resolve()));
}
async function recover() {
  const gate = await db.insw_dispatch_gate.findUniqueOrThrow({ where: { id: 1 } });
  await recoverOperationalOwnership(db, { expectedToken: gate.owner_token!, operator: 'disposable-fixture',
    evidence: 'Child close/reap observed; no supervisor or children', shutdownAcknowledged: true });
}
test.beforeAll(async () => {
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      active++; maxActive = Math.max(maxActive, active);
      arrivals.push({ at: Date.now(), body: JSON.parse(raw), key: req.headers['x-insw-key'] as string });
      setTimeout(() => { active--; res.setHeader('content-type', 'application/json');
        res.statusCode = reject ? 503 : 200;
        res.end(JSON.stringify({ status: !reject, message: reject ? 'temporary error' : 'success' })); }, 30);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as any).port}/fixture`;
});
test.beforeEach(() => { arrivals = []; maxActive = 0; reject = false; });
test.afterEach(async () => {
  for (const p of children) {
    if (p.exitCode === null && p.signalCode === null) { p.kill('SIGKILL'); await reaped(p); }
  }
  children = [];
  const { writeFileSync } = await import('node:fs');
  writeFileSync(test.info().outputPath('dispatcher-evidence.json'), JSON.stringify({ arrivals, maxActive }, null, 2));
});
test.afterAll(async () => { server?.closeAllConnections(); if (server?.listening) await new Promise<void>(resolve => server.close(() => resolve())); });

test('production adapter: both companies, six domains, competition, restart, frozen parity and finalization', async () => {
  for (const company of [1370, 1380]) for (const operation of operations) {
    const row = await source(operation, company);
    await captureCompletedWmsSource(db, input(operation, operation === 'OUTGOING' ? row.wms_id : row.id, company));
  }
  const originals = await db.insw_queue_cycle.findMany({ orderBy: { tail_key: 'asc' } });
  // Lower mutable policy to prove the hard floor belongs to admission.
  await db.insw_transmission_policy.update({ where: { id: 1 }, data: { min_processing_interval_ms: 1 } });
  const contenders = [launch(6), launch(6)];
  await expect.poll(() => contenders.filter(p => inbox.get(p)?.some(m => m.event === 'owned')).length).toBe(1);
  const owner = contenders.find(p => inbox.get(p)?.some(m => m.event === 'owned'))!;
  const loser = contenders.find(p => p !== owner)!;
  await event(loser, 'blocked');
  await event(owner, 'drained'); await reaped(owner); await reaped(loser);
  await recover();
  const replacement = launch(6); await event(replacement, 'drained'); await reaped(replacement);
  expect(arrivals).toHaveLength(12); expect(maxActive).toBe(1);
  for (let n = 0; n < arrivals.length; n++) {
    expect(arrivals[n].body).toEqual(originals[n].frozen_payload);
    expect(arrivals[n].key).toBe(`synthetic-${originals[n].company_code}`);
    if (n) expect(arrivals[n].at - arrivals[n - 1].at).toBeGreaterThanOrEqual(3600);
  }
  expect(await db.insw_queue_cycle.count({ where: { status: 'SUCCEEDED' } })).toBe(12);
  expect(await db.insw_tracking_log.count({ where: { insw_status: 'SUCCESS' } })).toBe(12);
});

test('production adapter: audited manual frozen successor; malformed head held before HTTP without starvation', async () => {
  const row = await source('OUTGOING', 1370);
  await captureCompletedWmsSource(db, input('OUTGOING', row.wms_id, 1370));
  reject = true;
  const first = launch(1); await event(first, 'drained'); await reaped(first); await recover();
  const log = await db.insw_tracking_log.findFirstOrThrow();
  const prior = await db.insw_queue_cycle.findFirstOrThrow();
  expect(prior.status).toBe('FAILED');
  await db.outgoing_good_items.updateMany({ data: { qty: 999 } });
  const successor = await resendWmsLog(db, 1370, log.id, 'fixture-operator', 'Definitive rejection verified');
  expect((await db.insw_tracking_log.findUniqueOrThrow({ where: { id: log.id } })).metadata).toMatchObject({
    manual_resend: { operator: 'fixture-operator', queue_id: successor.queue_id } });
  reject = false;
  const second = launch(1); await event(second, 'drained'); await reaped(second); await recover();
  expect(arrivals[1].body).toEqual(prior.frozen_payload);
  expect((await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: successor.queue_id } })).status).toBe('SUCCEEDED');
  const bad = await source('INCOMING', 1370);
  const good = await source('INCOMING', 1380);
  const badJob = await enqueueExisting(db, {
    identity: { kind: 'WMS_REFERENCE', companyCode: 1370, operation: 'INCOMING', reference: bad.wms_id,
      revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-24' },
    intent: 'SOURCE_COMMIT', requestedBy: 'malformed-fixture',
    payload: { data: [{ kdKegiatan: '31', dokumenKegiatan: [{ nomorDokKegiatan: bad.wms_id }] }] },
  });
  await captureCompletedWmsSource(db, input('INCOMING', good.id, 1380));
  const third = launch(2); await event(third, 'drained'); await reaped(third);
  expect(arrivals).toHaveLength(3);
  expect((await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: badJob.id } }))).toMatchObject({
    status: 'HELD', delivery_state: 'NOT_STARTED', error_code: 'PRE_SEND_VALIDATION_FAILED' });
});

test('actual production CLI opt-in starts idle, SIGTERM drains, restart fences until audited recovery', async () => {
  const { spawn } = await import('node:child_process');
  function cli() {
    const p = spawn(process.execPath, ['--import', 'tsx', 'scripts/insw-worker.ts'], {
      env: { PATH: process.env.PATH, NODE_ENV: 'production', INSW_WORKER_ENABLED: 'true', DATABASE_URL: url,
        INSW_1370_USE_TEST_MODE: 'true', INSW_1380_USE_TEST_MODE: 'true',
        INSW_1370_API_KEY: 'synthetic', INSW_1380_API_KEY: 'synthetic',
        INSW_1370_UNIQUE_KEY_TEST: 'synthetic', INSW_1380_UNIQUE_KEY_TEST: 'synthetic' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(p); inbox.set(p, []);
    let pending = '';
    p.stdout.on('data', chunk => {
      pending += chunk;
      const lines = pending.split('\n'); pending = lines.pop()!;
      for (const line of lines) { try { inbox.get(p)!.push(JSON.parse(line)); } catch { /* Non-event diagnostics. */ } }
    });
    return p;
  }
  const first = cli(); await event(first, 'owned');
  first.kill('SIGTERM'); await reaped(first); expect(first.exitCode).toBe(0);
  const blocked = cli(); await reaped(blocked); expect(blocked.exitCode).toBe(78);
  await recover();
  const replacement = cli(); await event(replacement, 'owned');
  replacement.kill('SIGTERM'); await reaped(replacement); expect(replacement.exitCode).toBe(0);
  expect(arrivals).toHaveLength(0);
  expect(await db.insw_queue_attempt.count()).toBe(0);
});
