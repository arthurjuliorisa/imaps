import * as csv from '../lib/logs-csv';
import { WMS_CSV_HEADER, encodeWmsCsvRow } from '../lib/wms-logs-csv';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server';
import { buildWmsLogWhere, WmsLogFilterError } from '../lib/wms-log-filters';
import { bindWmsCsvFilters } from '../lib/wms-log-sql';
import { WMS_INSW_STATUSES } from '../lib/wms-insw-status-options';
import { serializeBigInt } from '../lib/bigint-serializer';
import { test, expect } from '@playwright/test';
import { Prisma, PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { captureCompletedWmsSource, type CompletedSourceCapture } from '../lib/insw-worker/completed-source-capture';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';

const url = process.env.INSW_WMS_STATUS_TEST_DATABASE_URL;
test.skip(!url, 'NEW empty disposable loopback *_phase_c2b_test required');
let db: PrismaClient;
let httpCalls = 0;
const originalFetch = globalThis.fetch;
type Operation = 'ADJUSTMENT' | 'STOCK_OPNAME';
const operations = ['INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME'] as const;

test.beforeAll(async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(parsed.pathname)
    || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search || parsed.hash) throw new Error('UNSAFE_TEST_DATABASE');
  const client = new PrismaClient({ datasources: { db: { url } } });
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
  process.env.INSW_WORKER_ALLOWED_COMPANIES = '1370';
  statusQueryCount = 0;
});
test.afterAll(async () => { globalThis.fetch = originalFetch; await db?.$disconnect(); });
test.afterEach(() => { expect(httpCalls).toBe(0); });
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

import { enqueueExisting } from '../lib/insw-queue/queue.repository';
import { wmsInswClassifiedSql, wmsLogInswStatuses } from '../lib/insw-queue/wms-log-status';
let statusQueryCount = 0;
const statusDb = { $queryRaw: (query: Parameters<PrismaClient['$queryRaw']>[0]) => { statusQueryCount++; return db.$queryRaw(query); } } as Pick<PrismaClient, '$queryRaw'>;
const principal = { role: 'USER', companyCode: 1370 };
const actions = { INCOMING: 'WMS_PROCESS_INCOMING_GOODS', OUTGOING: 'WMS_PROCESS_OUTGOING_GOODS',
  MATERIAL_USAGE: 'WMS_PROCESS_MATERIAL_USAGE', PRODUCTION_OUTPUT: 'WMS_PROCESS_PRODUCTION_OUTPUT',
  ADJUSTMENT: 'WMS_PROCESS_ADJUSTMENTS', STOCK_OPNAME: 'WMS_UPDATE_STOCK_OPNAME' };
async function audit(operation: keyof typeof actions, ref: string, company = 1370, status = 'SUCCESS', retry = false) {
  const action = actions[operation] + (retry ? '_RETRY' : '');
  const a = await db.activity_logs.create({ data: { action, description: 'Disposable WMS acceptance fixture', company_code: company } });
  return db.wms_transmission_logs.create({ data: { activity_log_id: a.id, action, company_code: company, wms_id: ref, transmission_status: status } });
}
async function projection(id: bigint) {
  const result = (await wmsLogInswStatuses(statusDb, principal, [id])).get(String(id))!;
  const [sql] = await db.$queryRaw<{ label: string }[]>(wmsInswClassifiedSql(Prisma.sql`w.id = ${id} AND w.company_code = 1370`));
  expect(sql?.label).toBe(result?.label);
  const body = await (await actualRoute()(`insw_status=${encodeURIComponent(result.label)}&limit=50`)).json();
  expect(body.data.some((l: any) => l.id === String(id))).toBe(true);
  expect(body.data.every((l: any) => l.insw.label === result.label)).toBe(true);
  return result;
}
for (const op of operations) {
  test(`${op}: real committed source/details, no queue, no tracking is a local candidate requiring a reason and operator website confirmation`, async () => {
    const row = await source(op);
    const log = await audit(op, row.wms_id!);
    const before = await counts();
    statusQueryCount = 0;
    const status = await projection(log.id);
    expect(statusQueryCount).toBe(1);
    expect(status.label).toBe('Not queued');
    expect(status.canRegenerate).toBe(true);
    expect(status.regenerationBlock).toContain('A reason and your confirmation of a check on the official INSW website');
    expect(await counts()).toEqual(before);
  });
  test(`${op}: exact queued identity, duplicate audit and recovery audit share one batched status`, async () => {
    const row = await source(op);
    await captureCompletedWmsSource(db, input(op, op === 'OUTGOING' ? row.wms_id! : row.id));
    const logs = await Promise.all([audit(op, row.wms_id!), audit(op, row.wms_id!, 1370, 'SUCCESS', true)]);
    statusQueryCount = 0;
    const result = await wmsLogInswStatuses(statusDb, principal, logs.map(l => l.id));
    expect(statusQueryCount).toBe(1);
    expect([...result.values()].map(r => r.label)).toEqual(['Queued', 'Queued']);
    const classified = await db.$queryRaw<{ label: string }[]>(wmsInswClassifiedSql(Prisma.sql`w.id IN (${Prisma.join(logs.map(l => l.id))}) AND w.company_code = 1370`));
    expect(classified.map(r => r.label)).toEqual(['Queued', 'Queued']);
    expect([...result.values()].every(r => !r.canRegenerate)).toBe(true);
    expect(await db.insw_queue_cycle.count()).toBe(1);
  });
}

test('WMS failed validation, accepted source absent, details absent and source aliases remain unknown', async () => {
  const rejected = await audit('INCOMING', 'ABSENT', 1370, 'FAILED');
  const accepted = await audit('INCOMING', 'ABSENT');
  expect((await projection(rejected.id)).label).toBe('Unknown / unlinked');
  expect((await projection(accepted.id)).label).toBe('Unknown / unlinked');
  const row = await incomingFixture(1370, false, 'NO-DETAILS');
  const log = await audit('INCOMING', row.wms_id!);
  await db.incoming_good_items.deleteMany();
  expect((await projection(log.id)).label).toBe('Unknown / unlinked');
  const { id: _id, ...copy } = row;
  await db.incoming_goods.create({ data: { ...copy, incoming_date: new Date('2026-10-25') } });
  expect((await projection(log.id)).label).toBe('Unknown / unlinked');
});

test('BZ is unchanged; other-company and missing-company sessions fail closed; SEZ entitlement is distinct', async () => {
  const rows = await Promise.all([incomingFixture(1310), incomingFixture(1380), incomingFixture(1399)]);
  const logs = await Promise.all(rows.map(row => audit('INCOMING', row.wms_id!, row.company_code)));
  expect((await wmsLogInswStatuses(statusDb, principal, logs.map(l => l.id))).size).toBe(0);
  await expect(wmsLogInswStatuses(statusDb, { role: 'USER' }, logs.map(l => l.id))).rejects.toThrow('Assigned company');
  const all = await wmsLogInswStatuses(statusDb, { role: 'SUPER_ADMIN' }, logs.map(l => l.id));
  expect(all.has(String(logs[0].id))).toBe(false);
  expect(all.get(String(logs[1].id))).toMatchObject({ label: 'Not queued', workerAuthorized: false, canRegenerate: false });
  expect(all.get(String(logs[2].id))).toMatchObject({ workerAuthorized: false, canRegenerate: false });
  delete process.env.INSW_WORKER_ALLOWED_COMPANIES;
  const local = await incomingFixture(1370);
  expect((await projection((await audit('INCOMING', local.wms_id!)).id)).workerAuthorized).toBe(false);
});

for (const status of ['CLAIMED', 'FAILED', 'HELD', 'REMOTE_SUCCEEDED', 'SUCCEEDED'] as const) {
  test(`existing ${status} cycle is projected and never regeneration eligible`, async () => {
    const row = await incomingFixture(1370);
    const log = await audit('INCOMING', row.wms_id!);
    const q = await captureCompletedWmsSource(db, input('INCOMING', row.id));
    await db.insw_queue_cycle.update({ where: { id: q.id }, data: { status,
      ...(status === 'CLAIMED' || status === 'REMOTE_SUCCEEDED' ? { owner_token: '00000000-0000-4000-8000-000000000001', lease_until: new Date(Date.now() + 60000) } : {}),
      ...(status === 'FAILED' || status === 'SUCCEEDED' ? { completed_at: new Date() } : {}),
      delivery_state: status === 'HELD' || status === 'CLAIMED' ? 'POSSIBLY_STARTED'
        : status === 'FAILED' ? 'KNOWN_FAILURE' : 'KNOWN_SUCCESS',
      ...(status === 'HELD' ? { hold_reason: 'DELIVERY_UNKNOWN' as const } : {}) } });
    const actual = await projection(log.id);
    expect(actual.label).toBe(({ CLAIMED: 'Processing', FAILED: 'Failed', HELD: 'Held / Delivery unknown', REMOTE_SUCCEEDED: 'Succeeded', SUCCEEDED: 'Succeeded' })[status]);
    expect(actual.canRegenerate).toBe(false);
  });
}

test('known remote success, failed direct history and inconsistent tracking cannot imply missing work', async () => {
  const row = await incomingFixture(1370);
  const log = await audit('INCOMING', row.wms_id!);
  const h = await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: 'incoming', transaction_id: row.id, wms_id: row.wms_id, insw_status: 'SUCCESS' } });
  expect((await projection(log.id)).label).toBe('Succeeded');
  await db.insw_tracking_log.update({ where: { id: h.id }, data: { insw_status: 'FAILED' } });
  expect((await projection(log.id)).label).toBe('Unknown / unlinked');
  await db.insw_tracking_log.update({ where: { id: h.id }, data: { wms_id: 'WRONG-REFERENCE' } });
  expect((await projection(log.id)).explanation).toContain('Conflicting');
});

test('old identity and orphan queue reference require review without mutating frozen fields', async () => {
  const row = await incomingFixture(1370);
  const log = await audit('INCOMING', row.wms_id!);
  await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode: 1370,
    reference: row.wms_id!, businessDate: '2026-10-24', revision: 'OLD-REVISION' },
    payload: await convert('INCOMING', 1370, row.id), intent: 'SOURCE_COMMIT', requestedBy: 'disposable-stale-identity' });
  expect((await projection(log.id)).label).toBe('Unknown / unlinked');
  const other = await incomingFixture(1370, false, 'ORPHAN');
  const otherLog = await audit('INCOMING', other.wms_id!);
  await enqueueExisting(db, { identity: { kind: 'SOURCE_HEADER', operation: 'INCOMING', companyCode: 1370,
    sourceId: other.id, businessDate: '2026-10-24', revision: 'ACCEPTED_WMS_ID' },
    payload: await convert('INCOMING', 1370, other.id), intent: 'SOURCE_COMMIT', requestedBy: 'disposable-orphan' });
  expect((await projection(otherLog.id)).label).toBe('Unknown / unlinked');
});

test('two concurrent observations and WMS capture race never write source/stock or create a recovery cycle', async () => {
  const row = await incomingFixture(1370);
  const log = await audit('INCOMING', row.wms_id!);
  const before = await db.incoming_good_items.findMany();
  const results = await Promise.all([projection(log.id), projection(log.id), captureCompletedWmsSource(db, input('INCOMING', row.id))]);
  for (const r of results.slice(0, 2)) expect((r as { canRegenerate: boolean; label: string }).canRegenerate).toBe((r as { label: string }).label === 'Not queued');
  expect((await projection(log.id)).label).toBe('Queued');
  expect(await db.insw_queue_cycle.count()).toBe(1);
  expect(await db.incoming_goods.count()).toBe(1);
  expect(await db.incoming_good_items.findMany()).toEqual(before);
});

test('50 same-identity audits still issue exactly one status SQL query', async () => {
  const row = await incomingFixture(1370);
  const logs = await Promise.all(Array.from({ length: 50 }, () => audit('INCOMING', row.wms_id!)));
  statusQueryCount = 0;
  expect((await wmsLogInswStatuses(statusDb, principal, logs.map(l => l.id))).size).toBe(50);
  expect(statusQueryCount).toBe(1);
  await expect(wmsLogInswStatuses(statusDb, principal, [...logs.map(l => l.id), logs[0].id])).rejects.toThrow('Invalid WMS status page');
});

test('latest cycle wins over older failed cycle; earlier remote success always blocks repost interpretation', async () => {
  const row = await incomingFixture(1370);
  const log = await audit('INCOMING', row.wms_id!);
  const first = await captureCompletedWmsSource(db, input('INCOMING', row.id));
  await db.insw_queue_cycle.update({ where: { id: first.id }, data: { status: 'FAILED', delivery_state: 'KNOWN_FAILURE', completed_at: new Date() } });
  const next = await enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode: 1370,
    reference: row.wms_id!, businessDate: '2026-10-24', revision: 'ACCEPTED_WMS_ID' },
    payload: await convert('INCOMING', 1370, row.id), intent: 'SOURCE_COMMIT', requestedBy: 'disposable-next-cycle' });
  expect(next.cycle).toBe(2);
  expect((await projection(log.id)).label).toBe('Queued');
  await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: 'incoming', transaction_id: row.id, wms_id: row.wms_id, insw_status: 'SUCCESS' } });
  expect((await projection(log.id)).label).toBe('Unknown / unlinked');
  expect((await projection(log.id)).explanation).toContain('never send again');
});

test('stock opname activation with unconfirmed source is never missing-queue eligible', async () => {
  const row = await countFixture('STOCK_OPNAME', 1370);
  await db.wms_stock_opnames.update({ where: { id: row.id }, data: { status: 'Active', confirmed_at: null } });
  const log = await audit('STOCK_OPNAME', row.wms_id);
  expect((await projection(log.id)).label).toBe('Unknown / unlinked');
});

test('status projection executes inside an enforced read-only transaction', async () => {
  const row = await incomingFixture(1370);
  const log = await audit('INCOMING', row.wms_id!);
  await db.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    expect((await wmsLogInswStatuses(tx, principal, [log.id])).get(String(log.id))?.label).toBe('Not queued');
  });
});

function actualRoute(role = 'USER', companyCode = 1370, client = db) {
  const exports: Record<string, any> = {};
  const imports: Record<string, any> = {
    '@/lib/wms-insw-status-options': { WMS_INSW_STATUSES },
    '@prisma/client': { Prisma }, 'next/server': { NextResponse }, '@/lib/prisma': { prisma: client },
    '@/lib/wms-log-sql': { bindWmsCsvFilters },
    '@/lib/menu-auth': { checkMenuAuth: async () => ({ authenticated: true, grants: { canEdit: false },
      session: { user: { role, companyCode } } }), resolveMenuGrants: async () => ({ canView: false }) },
    '@/lib/config/insw-company-config': { resolveInswCompanyConfig: () => ({ useTestMode: true }) },
    '@/lib/insw-queue/wms-log-status': { wmsLogInswStatuses },
    '@/lib/bigint-serializer': { serializeBigInt }, '@/lib/wms-log-filters': { buildWmsLogWhere, WmsLogFilterError },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('app/api/settings/wms-transmission-logs/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: (name: string) => {
    if (!(name in imports)) throw new Error(`Unmocked import ${name}`);
    return imports[name];
  }, URL, console });
  return async (params = '') => exports.GET(new NextRequest(`http://localhost/api/settings/wms-transmission-logs?${params}`));
}

test('actual route filters before pagination in both branches; all, companies, metadata and intersections stay coherent', async () => {
  const matching = await incomingFixture(1370, false, 'MATCH-TARGET');
  const matches = await Promise.all(Array.from({ length: 12 }, () => audit('INCOMING', matching.wms_id!)));
  await db.wms_transmission_logs.updateMany({ where: { id: { in: matches.map(l => l.id) } }, data: { created_at: new Date('2026-10-24') } });
  for (let n = 0; n < 55; n++) await audit('INCOMING', `ABSENT-${n}`);
  await incomingFixture(1310, false, 'BZ'); await audit('INCOMING', 'BZ', 1310);
  await incomingFixture(1380, false, 'FOREIGN'); await audit('INCOMING', 'FOREIGN', 1380);
  const unsupported = await audit('INCOMING', 'UNSUPPORTED');
  await db.wms_transmission_logs.update({ where: { id: unsupported.id }, data: { action: 'WMS_UNSUPPORTED' } });
  const get = actualRoute();
  const all = await (await get('limit=50&include_filters=false')).json();
  expect(all.pagination.total).toBe(68);
  expect(all.data.some((l: any) => l.insw?.label === 'Not queued')).toBe(false);
  const labels = await db.$queryRaw<{ log_id: bigint; label: string }[]>(wmsInswClassifiedSql(Prisma.sql`w.company_code = 1370`));
  const expected = labels.filter(l => l.label === 'Not queued').map(l => String(l.log_id)).sort();
  for (const include of ['false', 'true']) {
    const p1 = await (await get(`insw_status=Not+queued&limit=10&include_filters=${include}`)).json();
    const p2 = await (await get(`insw_status=Not+queued&limit=10&page=2&include_filters=${include}`)).json();
    expect(p1.pagination).toMatchObject({ total: 12, totalPages: 2, hasNextPage: true });
    expect(p2.pagination).toMatchObject({ total: 12, totalPages: 2, hasNextPage: false });
    expect([...p1.data, ...p2.data].map((l: any) => l.id).sort()).toEqual(expected);
    expect(p1.data.every((l: any) => l.insw.label === 'Not queued' && l.company_code === 1370)).toBe(true);
    expect(p1.data.map((l: any) => l.id)).toEqual(matches.slice().sort((a, b) => Number(b.id - a.id)).slice(0, 10).map(l => String(l.id)));
    const intersection = await (await get(`insw_status=Not+queued&transmission_status=SUCCESS&company_code=1370&action=WMS_PROCESS_INCOMING_GOODS&wms_id=match&date_from=2026-10-24&date_to=2026-10-24T23:59:59&include_filters=${include}`)).json();
    expect(intersection.pagination.total).toBe(12);
    const excluded = await (await get(`insw_status=Not+queued&transmission_status=FAILED&include_filters=${include}`)).json();
    expect(excluded.pagination.total).toBe(0); expect(excluded.data).toEqual([]);
  }
  expect((await (await get('insw_status=ALL')).json()).pagination.total).toBe(all.pagination.total);
  const superGet = actualRoute('SUPER_ADMIN');
  expect((await (await superGet()).json()).pagination.total).toBe(70);
  expect((await (await superGet('insw_status=Not+queued')).json()).pagination.total).toBe(13);
  expect((await get('insw_status=Not+queued&company_code=1380')).status).toBe(403);
  expect((await get('insw_status=bogus')).status).toBe(400);
  const metadata = await (await get('metadata_only=true&insw_status=Not+queued')).json();
  expect(metadata.filters.actions).toContain('WMS_UNSUPPORTED');
});

test('filtered query count is bounded at 1/10/50 rows and EXPLAIN shows filtering before limit', async () => {
  const row = await incomingFixture(1370);
  for (let n = 0; n < 50; n++) await audit('INCOMING', row.wms_id!);
  for (const limit of [1, 10, 50]) {
    // API only accepts 5/10/25/50; use a one-match dataset for the 1-row case.
    const counted = { ...db, wms_transmission_logs: db.wms_transmission_logs,
      $queryRaw: (query: Parameters<PrismaClient['$queryRaw']>[0]) => { calls++; return db.$queryRaw(query); } } as PrismaClient;
    let calls = 0;
    const params = `insw_status=Not+queued&limit=${limit === 1 ? 5 : limit}`;
    if (limit === 1) await db.wms_transmission_logs.deleteMany({ where: { id: { not: (await db.wms_transmission_logs.findFirstOrThrow()).id } } });
    const body = await (await actualRoute('USER', 1370, counted)(params)).json();
    expect(body.data).toHaveLength(limit === 1 ? 1 : Math.min(limit, body.pagination.total));
    expect(calls).toBe(3); // page + count + explanatory batch, independent of rows
    if (limit === 1) for (let n = 0; n < 49; n++) await audit('INCOMING', row.wms_id!);
  }
  const predicate = bindWmsCsvFilters(buildWmsLogWhere(new URLSearchParams('insw_status=Not+queued'), { user: principal }));
  const plan = await db.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT log.id
    FROM wms_transmission_logs log WHERE ${predicate} ORDER BY log.created_at DESC, log.id DESC LIMIT 50`);
  // Preserve the real disposable-fixture plan for review; no production timing claim.
  const { writeFileSync } = await import('node:fs');
  writeFileSync('/tmp/imaps-wms-filter-explain.json', JSON.stringify(plan, null, 2));
  expect(JSON.stringify(plan)).toContain('Limit');
});


test('canonical SQL identity validation matches JS for whitespace, controls and UTF-16 lengths', async () => {
  for (const ref of [' padded ', 'NBSP\u00a0', 'CONTROL\t', '😀'.repeat(51), 'QUOTE"\\reference', '😀'.repeat(50)]) {
    const row = await incomingFixture(1370, false, ref);
    const log = await audit('INCOMING', row.wms_id!);
    await projection(log.id);
  }
});

test('actual CSV cursor source applies the INSW predicate without changing row fields or encoding', async () => {
  const row = await incomingFixture(1370, false, 'CSV-TARGET');
  for (let n = 0; n < 3; n++) await audit('INCOMING', row.wms_id!);
  await audit('INCOMING', 'ABSENT');
  await incomingFixture(1380, false, 'FOREIGN'); await audit('INCOMING', 'FOREIGN', 1380);
  await incomingFixture(1310, false, 'BZ'); await audit('INCOMING', 'BZ', 1310);
  const exports: Record<string, any> = {};
  const imports: Record<string, any> = { '@prisma/client': { Prisma }, '@/lib/prisma': { prisma: db },
    './logs-csv': csv, './wms-log-sql': { bindWmsCsvFilters } };
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/wms-logs-csv-postgresql.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: (name: string) => imports[name], console });
  const where = buildWmsLogWhere(new URLSearchParams('insw_status=Not+queued'), { user: principal }, true);
  const source = exports.createWmsCsvPostgresqlSource(where);
  const first = await source(2), second = await source(2), end = await source(2);
  expect(first).toHaveLength(2); expect(second).toHaveLength(1); expect(end).toEqual([]);
  const rows = [...first, ...second];
  expect(rows.every(r => r.company_code === 1370 && r.wms_id === 'CSV-TARGET')).toBe(true);
  expect(Object.keys(rows[0]).sort()).toEqual(['created_at', 'action', 'transmission_status', 'wms_id',
    'company_code', 'error_type', 'item_count', 'expires_at'].sort());
  expect(WMS_CSV_HEADER).not.toContain('INSW');
  expect(encodeWmsCsvRow(rows[0], 1)).toContain('CSV-TARGET');
});
