import { test, expect } from '@playwright/test';
import { Prisma, PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { captureCompletedWmsSource, type CompletedSourceCapture } from '../lib/insw-worker/completed-source-capture';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';

const url = process.env.INSW_REGENERATE_TEST_DATABASE_URL;
test.skip(!url, 'NEW empty disposable loopback *_phase_c2b_test required');
let db: PrismaClient;
let httpCalls = 0;
let queryCount = 0;
const originalFetch = globalThis.fetch;
const servicePrototype = INSWIntegrationService.prototype as unknown as { fetchINSW: (...args: any[]) => Promise<Response> };
const originalTransport = servicePrototype.fetchINSW;
type Operation = 'ADJUSTMENT' | 'STOCK_OPNAME';
const operations = ['INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME'] as const;

test.beforeAll(async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(parsed.pathname)
    || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search || parsed.hash) throw new Error('UNSAFE_TEST_DATABASE');
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', () => queryCount++);
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
  globalThis.fetch = async () => { httpCalls++; throw new Error('CAPTURE_MUST_NOT_SEND'); };
  servicePrototype.fetchINSW = async () => { httpCalls++; throw new Error('REGENERATION_MUST_NOT_CONTACT_PROVIDER'); };
});
test.beforeEach(async () => {
  httpCalls = 0;
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
  await db.users.upsert({ where: { id: 'recovery-fixture' }, update: {}, create: { id: 'recovery-fixture', username: 'recovery-fixture', full_name: 'Recovery fixture', email: 'recovery@example.invalid', password: 'disabled', role: 'ADMIN' } });
  process.env.INSW_1370_USE_TEST_MODE = 'true';
  process.env.INSW_1370_API_KEY = 'synthetic';
  process.env.INSW_1370_UNIQUE_KEY_TEST = 'synthetic';
  process.env.INSW_WORKER_ALLOWED_COMPANIES = '1370';

});
test.afterAll(async () => { globalThis.fetch = originalFetch; servicePrototype.fetchINSW = originalTransport; await db?.$disconnect(); });
test.afterEach(() => { expect(httpCalls).toBe(0); });
async function incomingFixture(company: number, nonFacility = false, ref = `SOURCE-${company}-${nonFacility}`) {
  const row = await db.incoming_goods.create({ data: { company_code: company, owner: company, wms_id: ref,
    incoming_date: new Date('2020-01-01'), ppkek_number: nonFacility ? 'N' : 'PP123',
    customs_document_type: nonFacility ? null : 'BC23', is_non_facility: nonFacility,
    customs_registration_date: nonFacility ? null : new Date('2019-12-31'),
    incoming_evidence_number: nonFacility ? 'N' : 'EVIDENCE', shipper_name: 'Synthetic Supplier', timestamp: new Date() } });
  await db.incoming_good_items.createMany({ data: [1, 2].map(n => ({ incoming_good_id: row.id,
    incoming_good_company: company, incoming_good_date: row.incoming_date, item_type: 'ROH', item_code: `ITEM-${n}`,
    item_name: `Synthetic ${n}`, uom: 'PCS', qty: n * 1.125, currency: 'USD', amount: n * 12.3456 })) });
  return row;
}
async function productionFixture(operation: 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT', company: number, reversed = false, ref = `${operation}-${company}-${reversed}`) {
  const data = { company_code: company, owner: company, wms_id: ref, transaction_date: new Date('2020-01-01'),
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
      transaction_date: new Date('2020-01-01'), timestamp: new Date(),
      items: { create: [0, 1, 2].map(n => ({ adjustment_type: n === 1 ? 'LOSS' : 'GAIN', item_type: n === 1 ? 'HALB' : 'ROH', item_code: `ITEM-${n}`,
        item_name: `Fixture ${n}`, uom: 'PCS', qty: n === 2 ? -2.125 : n + 1.125, reason: `reason ${n}`,
        amount: 99.1234, system_qty: 100, adjusted_qty: 102 })) } } });
    return { ...row, id: BigInt(row.id) };
  }
  const row = await db.wms_stock_opnames.create({ data: { ...(id === undefined ? {} : { id }), company_code: company,
    owner: company, wms_id: ref, document_date: new Date('2020-01-01'), status: 'Confirmed',
    confirmed_at: new Date('2020-01-01T12:34:56.789Z'), items: { create: [0, 1, 2, 3].map(n => ({ company_code: company,
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
  if (operation === 'OUTGOING') return { operation, wmsReference: String(id), companyCode: company, businessDate: '2020-01-01',
    revision: 'ACCEPTED_WMS_ID', requestedBy: 'trusted-fixture', completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED' };
  return { operation, sourceId: id, companyCode: company, businessDate: '2020-01-01',
    revision: operation === 'ADJUSTMENT' ? 'COMMITTED_SOURCE' : operation === 'STOCK_OPNAME'
      ? 'CONFIRMED:2020-01-01T12:34:56.789Z' : 'ACCEPTED_WMS_ID',
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
    outgoing_date: new Date('2020-01-01'), ppkek_number: nonFacility ? 'N' : 'PP123',
    customs_document_type: nonFacility ? null : 'BC30', is_non_facility: nonFacility,
    customs_registration_date: nonFacility ? null : new Date('2019-12-31'),
    outgoing_evidence_number: nonFacility ? 'N' : 'EVIDENCE', recipient_name: 'Synthetic Recipient', invoice_number: 'INV', invoice_date: new Date('2019-12-31'), timestamp: new Date() } });
  await db.outgoing_good_items.createMany({ data: [1, 2].map(n => ({ outgoing_good_id: row.id,
    outgoing_good_company: company, outgoing_good_date: row.outgoing_date, item_type: 'ROH', item_code: `ITEM-${n}`,
    item_name: `Synthetic ${n}`, uom: 'PCS', qty: n * 1.125, currency: 'USD', amount: n * 12.3456 })) });
  return row;
}

const actions = { INCOMING: 'WMS_PROCESS_INCOMING_GOODS', OUTGOING: 'WMS_PROCESS_OUTGOING_GOODS',
  MATERIAL_USAGE: 'WMS_PROCESS_MATERIAL_USAGE', PRODUCTION_OUTPUT: 'WMS_PROCESS_PRODUCTION_OUTPUT',
  ADJUSTMENT: 'WMS_PROCESS_ADJUSTMENTS', STOCK_OPNAME: 'WMS_UPDATE_STOCK_OPNAME' };
async function audit(operation: keyof typeof actions, ref: string, company = 1370, status = 'SUCCESS', retry = false) {
  const action = actions[operation] + (retry ? '_RETRY' : '');
  const a = await db.activity_logs.create({ data: { action, description: 'Disposable WMS acceptance fixture', company_code: company } });
  return db.wms_transmission_logs.create({ data: { activity_log_id: a.id, action, company_code: company, wms_id: ref, transmission_status: status } });
}

import { regenerateWmsInsw, validateRegenerationRequest } from '../lib/insw-queue/manual-regeneration';
const principal = { id: 'recovery-fixture', role: 'USER', companyCode: 1370 };
const request = { reason: 'Recover missing INSW queue for this transaction' };
async function recover(logId: bigint) { return regenerateWmsInsw(db, principal, logId, request); }

// Interleave competing local writes after canonical conversion, before lock/recheck.
async function afterConversion(action: () => Promise<unknown>, run: () => Promise<unknown>) {
  const original = INSWIntegrationService.prototype.convertPemasukanToINSW;
  INSWIntegrationService.prototype.convertPemasukanToINSW = async function (...args) {
    const payload = await original.apply(this, args);
    INSWIntegrationService.prototype.convertPemasukanToINSW = original;
    await action();
    return payload;
  };
  try { return await run(); } finally { INSWIntegrationService.prototype.convertPemasukanToINSW = original; }
}
for (const op of operations) {
  for (const reversed of (op === 'MATERIAL_USAGE' || op === 'PRODUCTION_OUTPUT' ? [false, true] : [false])) {
    test(`${op} reversal=${reversed}: legacy and current missing queue freezes canonical payload and atomic audit`, async () => {
      const row = await source(op, 1370, `${op}-${reversed}`, reversed);
      const log = await audit(op, row.wms_id!);
      await db.wms_transmission_logs.update({ where: { id: log.id }, data: { created_at: new Date('2020-01-01') } });
      queryCount = 0;
      const result = await recover(log.id);
      console.log(`REGENERATE_QUERY_COUNT ${op} ${queryCount}`);
      expect(httpCalls).toBe(0);
      const queue = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: result.queue_id } });
      expect(queue.cycle).toBe(1); expect(queue.status).toBe('READY'); expect(queue.intent).toBe('SOURCE_COMMIT');
      expect(await counts()).toEqual([1, 0, 0, 0]);
      expect(queue.frozen_payload).toEqual(await convert(op, 1370, row.id));
      const audits = await db.activity_logs.findMany({ where: { action: 'WMS_REGENERATE_INSW_TRANSMISSION' } });
      expect(audits).toHaveLength(1);
      expect(audits[0].user_id).toBe(principal.id);
      expect(audits[0].metadata).toMatchObject({ reason: request.reason, queue_id: result.queue_id, destination: 'TEST', remote_check: 'OPERATOR_WEBSITE_CONFIRMATION_NOT_SYSTEM_VERIFIED',
        activity: queue.frozen_payload && (queue.frozen_payload as any).data[0].kdKegiatan });
      expect(JSON.stringify(audits[0].metadata)).not.toMatch(/attest|review_reference/);
      await expect(recover(log.id)).rejects.toThrow();
      expect(await db.insw_queue_cycle.count()).toBe(1);
    });
  }
}
test('queue-era source succeeds without rollout membership', async () => {
  const row = await source('INCOMING');
  await db.incoming_goods.updateMany({ where: { id: Number(row.id) }, data: { incoming_date: new Date('2026-11-01') } });
  await db.incoming_good_items.updateMany({ where: { incoming_good_id: Number(row.id) }, data: { incoming_good_date: new Date('2026-11-01') } });
  const log = await audit('INCOMING', row.wms_id!);
  expect((await recover(log.id)).success).toBe(true);
});
for (const state of ['READY', 'CLAIMED', 'FAILED', 'HELD', 'SUCCEEDED', 'REMOTE_SUCCEEDED'] as const) {
  test(`existing cycle ${state} blocks regeneration`, async () => {
    const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
    await captureCompletedWmsSource(db, input('INCOMING', row.id));
    await db.insw_queue_cycle.updateMany({ data: { status: state,
      owner_token: ['CLAIMED', 'REMOTE_SUCCEEDED'].includes(state) ? '11111111-1111-4111-8111-111111111111' : null,
      lease_until: ['CLAIMED', 'REMOTE_SUCCEEDED'].includes(state) ? new Date('2030-01-01') : null,
      hold_reason: state === 'HELD' ? 'DELIVERY_UNKNOWN' : null,
      completed_at: ['FAILED', 'SUCCEEDED'].includes(state) ? new Date() : null,
      delivery_state: ['SUCCEEDED', 'REMOTE_SUCCEEDED'].includes(state) ? 'KNOWN_SUCCESS' : state === 'FAILED' ? 'KNOWN_FAILURE' : 'NOT_STARTED',
    } });
    expect((await db.insw_queue_cycle.findFirstOrThrow()).status).toBe(state);
    await expect(recover(log.id)).rejects.toThrow();
  });
}
for (const status of ['SUCCESS', 'FAILED', 'PENDING', 'SENT', 'DELIVERY_UNKNOWN']) {
  test(`legacy alias tracking ${status} blocks`, async () => {
    const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
    await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: 'incoming', transaction_id: Number(row.id),
      wms_id: 'OLD-ALIAS', insw_status: status } });
    await expect(recover(log.id)).rejects.toThrow(); expect(await db.insw_queue_cycle.count()).toBe(0);
  });
}
test('orphan ambiguity blocks', async () => {
  const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
  await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: 'incoming', insw_status: 'PENDING' } });
  await expect(recover(log.id)).rejects.toThrow('Unlinked');
});
test('parallel manual clicks create exactly one queue', async () => {
  const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
  const results = await Promise.allSettled([recover(log.id), recover(log.id)]);
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1); expect(await db.insw_queue_cycle.count()).toBe(1);
});
test('normal capture between conversion and lock blocks recovery', async () => {
  const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
  await expect(afterConversion(() => captureCompletedWmsSource(db, input('INCOMING', row.id)), () => recover(log.id))).rejects.toThrow();
  expect(await db.insw_queue_cycle.count()).toBe(1);
  expect(await db.activity_logs.count({ where: { action: 'WMS_REGENERATE_INSW_TRANSMISSION' } })).toBe(0);
});
test('detail changes after conversion block frozen stale payload', async () => {
  const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
  await expect(afterConversion(() => db.incoming_good_items.updateMany({ where: { incoming_good_id: Number(row.id) }, data: { qty: 999 } }), () => recover(log.id))).rejects.toThrow('Source changed');
  expect(await db.insw_queue_cycle.count()).toBe(0);
});
test('Stock Opname revision changes after conversion fail safely', async () => {
  const row = await source('STOCK_OPNAME'); const log = await audit('STOCK_OPNAME', row.wms_id!);
  const original = INSWIntegrationService.prototype.convertStockOpnameToINSW;
  INSWIntegrationService.prototype.convertStockOpnameToINSW = async function (...args) {
    const payload = await original.apply(this, args);
    await db.wms_stock_opnames.update({ where: { id: BigInt(row.id) }, data: { confirmed_at: new Date('2020-01-02') } });
    return payload;
  };
  try { await expect(recover(log.id)).rejects.toThrow('Source changed'); }
  finally { INSWIntegrationService.prototype.convertStockOpnameToINSW = original; }
  expect(await db.insw_queue_cycle.count()).toBe(0);
  expect(await db.activity_logs.count({ where: { action: 'WMS_REGENERATE_INSW_TRANSMISSION' } })).toBe(0);
});
test('audit failure rolls back queue', async () => {
  const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
  await expect(regenerateWmsInsw(db, { ...principal, id: 'missing-user' }, log.id, request)).rejects.toThrow();
  expect(await db.insw_queue_cycle.count()).toBe(0);
});
test('wrong company, invalid reason and invalid source are refused', async () => {
  const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
  await expect(regenerateWmsInsw(db, { ...principal, companyCode: 1380 }, log.id, request)).rejects.toThrow();
  expect(() => validateRegenerationRequest({ reason: '   ' })).toThrow();
  await db.incoming_good_items.deleteMany(); await expect(recover(log.id)).rejects.toThrow();
  expect(await db.insw_queue_cycle.count()).toBe(0);
});

test('BZ, unconfirmed Stock Opname, outgoing scrap and failed async history remain blocked without provider calls', async () => {
  const bz = await source('INCOMING', 1310); const bzLog = await audit('INCOMING', bz.wms_id!, 1310);
  await expect(regenerateWmsInsw(db, { ...principal, companyCode: 1310 }, bzLog.id, request)).rejects.toThrow();
  const stock = await source('STOCK_OPNAME'); const stockLog = await audit('STOCK_OPNAME', stock.wms_id!);
  await db.wms_stock_opnames.updateMany({ data: { status: 'Active', confirmed_at: null } });
  await expect(recover(stockLog.id)).rejects.toThrow();
  const outgoing = await source('OUTGOING'); const outLog = await audit('OUTGOING', outgoing.wms_id!);
  const scrap = await db.scrap_transactions.create({ data: { company_code: 1370, transaction_date: new Date('2020-01-01'), transaction_type: 'OUT', document_number: 'FIXTURE-SCRAP' } });
  await db.outgoing_goods.updateMany({ data: { scrap_transaction_id: scrap.id } });
  await expect(recover(outLog.id)).rejects.toThrow();
  const incoming = await source('INCOMING'); const log = await audit('INCOMING', incoming.wms_id!);
  await audit('INCOMING', incoming.wms_id!, 1370, 'ERROR');
  await expect(recover(log.id)).rejects.toThrow('Failure/retry');
  expect(httpCalls).toBe(0);
});

test('destination is server-derived', async () => {
  const row = await source('INCOMING'); const log = await audit('INCOMING', row.wms_id!);
  await expect(regenerateWmsInsw(db, principal, log.id, { ...request, destination: 'REAL' })).rejects.toThrow('Only a Reason');
  expect((await recover(log.id)).destination).toBe('TEST');
});

test('manual authorization requires local recheck and audit callbacks and does not assert business completion', async () => {
  const row = await source('INCOMING');
  await expect(captureCompletedWmsSource(db, { ...input('INCOMING', row.id),
    completion: 'MANUAL_REGENERATION_SERVER_CHECKS' })).rejects.toThrow('BUSINESS_COMPLETION_AUTHORIZATION_REQUIRED');
  expect(await db.insw_queue_cycle.count()).toBe(0);
});
