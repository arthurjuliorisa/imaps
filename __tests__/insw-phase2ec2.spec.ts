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
let httpCalls = 0;
const originalFetch = globalThis.fetch;
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
  queries = [];
});
test.afterAll(async () => { globalThis.fetch = originalFetch; await db?.$disconnect(); });
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

import { resendWmsLog, wmsLogResendEligibility, submitOutgoingOriginals } from '../lib/insw-queue/wms-coordination';
import { readPolicy, updatePolicy } from '../lib/insw-queue/policy.repository';
import { prepareIsolatedOutgoingFinalizer, prepareIsolatedMaterialUsageFinalizer, prepareIsolatedProductionOutputFinalizer,
  prepareIsolatedCountFinalizer } from '../lib/insw-worker/incoming-finalizer';
import { executeFrozenRequest } from '../lib/insw-worker/transport';
import { continueWmsRetryToInsw } from '../lib/services/wms-reprocess.service';

const remaining = ['OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME'] as const;
async function budget(maximum: number) {
  const p = await readPolicy(db);
  await updatePolicy(db, p.version, { max_auto_retry: maximum, min_processing_interval_ms: 3600 }, 'fixture', 'Disposable C2 tests');
}
async function captureSource(op: typeof remaining[number], row: { id: number | bigint; company_code: number; wms_id: string }) {
  return captureCompletedWmsSource(db, input(op, op === 'OUTGOING' ? row.wms_id : row.id, row.company_code));
}
async function finish(job: NonNullable<Awaited<ReturnType<typeof admitNext>>['job']>, token: string, success: boolean) {
  const prepare = job.operation === 'OUTGOING' ? prepareIsolatedOutgoingFinalizer : job.operation === 'MATERIAL_USAGE'
    ? prepareIsolatedMaterialUsageFinalizer : job.operation === 'PRODUCTION_OUTPUT' ? prepareIsolatedProductionOutputFinalizer : prepareIsolatedCountFinalizer;
  const finalizer = await prepare(db, token, job, { endpointUrl: 'http://127.0.0.1:12345/fixture' });
  const result = await executeFrozenRequest({ payload: job.frozen_payload, sha256: job.payload_sha256, timeoutMs: 100, captureResponse: true,
    request: async () => new Response(JSON.stringify(success ? { status: true, message: 'Success', data: null }
      : { status: false, code: '500', message: 'temporary error', data: null }), { status: success ? 200 : 503, headers: { 'content-type': 'application/json' } }) });
  await finalizer(result, Date.now());
}
for (const op of remaining) for (const company of [1370, 1380]) {
  test(`${op} ${company}: canonical parity, exhausted resend, frozen successor claim/finalize and any-cycle dedupe`, async () => {
    await budget(company === 1370 ? 0 : 2);
    const row = await source(op, company);
    const expected = JSON.parse(JSON.stringify(await convert(op, company, row.id)));
    await Promise.all([captureSource(op, row), captureSource(op, row)]);
    expect(await db.insw_queue_cycle.count()).toBe(1);
    const original = await db.insw_queue_cycle.findFirstOrThrow(); expect(original.frozen_payload).toEqual(expected);
    const token = await acquireOperationalOwnership(db);
    for (let n = 0; n <= original.max_auto_retry_snapshot; n++) {
      await db.$executeRaw`UPDATE insw_dispatch_gate SET last_started_at = NULL, prior_interval_ms = NULL WHERE id = 1`;
      const { job } = await admitNext(db, token, 3600); expect(job?.id).toBe(original.id);
      await finish(job!, token, false);
      const log = await db.insw_tracking_log.findFirstOrThrow({ orderBy: { id: 'desc' } });
      if (n < original.max_auto_retry_snapshot) {
        expect((await wmsLogResendEligibility(db, company, [log.id])).size).toBe(0);
        await expect(resendWmsLog(db, company, log.id, 'op', 'too early')).rejects.toThrow('exhausted');
      }
    }
    const log = await db.insw_tracking_log.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect((await wmsLogResendEligibility(db, company, [log.id])).has(log.id.toString())).toBe(true);
    // Mutable detail changes cannot alter the explicit successor request.
    if (op === 'OUTGOING') await db.outgoing_good_items.updateMany({ data: { qty: 999 } });
    if (op === 'MATERIAL_USAGE') await db.material_usage_items.updateMany({ data: { qty: 999 } });
    if (op === 'PRODUCTION_OUTPUT') await db.production_output_items.updateMany({ data: { qty: 999 } });
    if (op === 'ADJUSTMENT') await db.adjustment_items.updateMany({ data: { qty: 999 } });
    if (op === 'STOCK_OPNAME') await db.wms_stock_opname_items.updateMany({ data: { actual_qty_count: 999 } });
    const other = new PrismaClient({ datasources: { db: { url } } });
    try {
      const results = await Promise.allSettled([resendWmsLog(db, company, log.id, 'operator-A', 'Investigated known failure'),
        resendWmsLog(other, company, log.id, 'operator-B', 'Concurrent click')]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    } finally { await other.$disconnect(); }
    const cycles = await db.insw_queue_cycle.findMany({ orderBy: { cycle: 'asc' } });
    expect(cycles).toHaveLength(2); expect(cycles[1].frozen_payload).toEqual(expected);
    expect(cycles[1].payload_sha256).toBe(original.payload_sha256);
    expect((await db.insw_tracking_log.findUniqueOrThrow({ where: { id: log.id } })).insw_status).toBe('FAILED');
    await captureSource(op, row); expect(await db.insw_queue_cycle.count()).toBe(2);
    await db.$executeRaw`UPDATE insw_dispatch_gate SET last_started_at = NULL, prior_interval_ms = NULL WHERE id = 1`;
    const { job } = await admitNext(db, token, 3600); expect(job?.id).toBe(cycles[1].id);
    await finish(job!, token, true);
    expect((await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: job!.id } })).status).toBe('SUCCEEDED');
    expect((await wmsLogResendEligibility(db, company, [log.id])).size).toBe(0);
    await expect(resendWmsLog(db, company, log.id, 'op', 'forbidden')).rejects.toThrow('exhausted');
    expect(httpCalls).toBe(0);
  });
}

for (const op of remaining) {
  test(`${op}: legacy uncertain or success cannot seed fresh delivery; cross-company resend rejected`, async () => {
    const row = await source(op);
    for (const status of ['PENDING', 'SUCCESS', 'FAILED']) {
      await db.insw_tracking_log.deleteMany();
      const log = await db.insw_tracking_log.create({ data: { transaction_type: op.toLowerCase(), transaction_id: Number(row.id),
        company_code: 1370, wms_id: row.wms_id, insw_status: status } });
      await expect(captureSource(op, row)).rejects.toThrow('LEGACY_DELIVERY');
      await expect(resendWmsLog(db, 1370, log.id, 'op', 'unknown delivery')).rejects.toThrow('Definitively');
      await expect(resendWmsLog(db, 1380, log.id, 'op', 'wrong company')).rejects.toThrow();
    }
    expect(await db.insw_queue_cycle.count()).toBe(0); expect(httpCalls).toBe(0);
  });
}

test('Outgoing manual selection: separate originals, batched admission, N/N/N, pending and terminal projection', async () => {
  const a = await outgoingFixture(1370, true, 'MANUAL-A'); const b = await outgoingFixture(1370, false, 'MANUAL-B');
  for (const row of [a,b]) {
    const activity = await db.activity_logs.create({ data: { action: 'WMS_PROCESS_OUTGOING_GOODS', description: 'Synthetic acceptance' } });
    await db.wms_transmission_logs.create({ data: { activity_log_id: activity.id, action: activity.action, company_code: 1370,
      wms_id: row.wms_id, transmission_status: 'SUCCESS' } });
  }
  expect(await submitOutgoingOriginals(db, 1370, [a.id, b.id], false, 'operator')).toMatchObject({ status: 'accepted', accepted_count: 2 });
  const jobs = await db.insw_queue_cycle.findMany(); expect(jobs).toHaveLength(2);
  for (const row of [a,b]) expect(jobs.find(j => j.wms_reference === row.wms_id)?.frozen_payload)
    .toEqual(JSON.parse(JSON.stringify(await convert('OUTGOING', 1370, row.id))));
  expect(await submitOutgoingOriginals(db, 1370, [a.wms_id,b.wms_id], true, 'operator')).toMatchObject({ status: 'already_pending', accepted_count: 0 });
  await db.insw_queue_cycle.updateMany({ data: { status: 'HELD', delivery_state: 'POSSIBLY_STARTED', hold_reason: 'DELIVERY_UNKNOWN' } });
  expect(await submitOutgoingOriginals(db, 1370, [a.id,b.id], false, 'operator')).toMatchObject({ status: 'not_eligible', accepted_count: 0 });
  const manual = await outgoingFixture(1370, false, 'MANUAL-CAPITAL');
  await expect(submitOutgoingOriginals(db, 1370, [manual.id], false, 'operator')).rejects.toThrow('Eligible persisted WMS');
  await expect(submitOutgoingOriginals(db, 1380, [a.id], false, 'operator')).rejects.toThrow();
  await expect(submitOutgoingOriginals(db, 1370, [a.id,999999], false, 'operator')).rejects.toThrow();
  expect(httpCalls).toBe(0);
});

import { MaterialUsageService } from '../lib/services/material-usage.service';
import { ProductionOutputService } from '../lib/services/production-output.service';
import { AdjustmentsService } from '../lib/services/adjustments.service';
import { OutgoingGoodsService } from '../lib/services/outgoing-goods.service';
import { logger } from '../lib/utils/logger';
import { OutgoingGoodsRepository } from '../lib/repositories/outgoing-goods.repository';

function bindFixtureSingletons() {
  const clients = new Set<PrismaClient>([require('../lib/db/prisma').prisma, require('../lib/prisma').prisma]);
  const restore: (() => void)[] = [];
  const keys = [...Object.keys(db).filter(key => !key.startsWith('_') && !key.startsWith('$')),
    '$transaction', '$queryRaw', '$queryRawUnsafe', '$executeRaw'];
  for (const client of clients) for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(client, key); const value = Reflect.get(db, key);
    Object.defineProperty(client, key, { configurable: true, writable: true, value: typeof value === 'function' ? value.bind(db) : value });
    restore.push(() => { if (descriptor) Object.defineProperty(client, key, descriptor); else Reflect.deleteProperty(client, key); });
  }
  return () => restore.reverse().forEach(fn => fn());
}
async function withApiSession(run: () => Promise<void>) {
  const restore = bindFixtureSingletons(); const auth = require('next-auth/next'); const original = auth.getServerSession;
  auth.getServerSession = async () => ({ user: { id: 'fixture-operator', companyCode: '1370', role: 'SUPER_ADMIN' } });
  try { await run(); } finally { auth.getServerSession = original; restore(); }
}

for (const op of ['OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT'] as const) for (const failCapture of [false, true]) {
  test(`${op}: live service completion waits for repository promise; capture failure=${failCapture} preserves local acceptance`, async () => {
    const restore = bindFixtureSingletons();
    const originalChild = logger.child.bind(logger); const originalError = logger.error.bind(logger); let captureFailed = false;
    logger.error = (...params: Parameters<typeof logger.error>) => {
      if (String(params[0]).includes('no DIRECT fallback')) captureFailed = true;
      return originalError(...params);
    };
    logger.child = (...args: Parameters<typeof logger.child>) => {
      const child = originalChild(...args); const error = child.error.bind(child);
      child.error = (...params: Parameters<typeof child.error>) => {
        if (String(params[0]).includes('no DIRECT fallback')) captureFailed = true;
        return error(...params);
      };
      return child;
    };
    for (const type of ['ROH', 'HALB', 'FERT']) await db.item_types.upsert({ where: { item_type_code: type }, update: {},
      create: { item_type_code: type, name_en: `Synthetic ${type}`, category: 'fixture' } });
    let resume!: () => void; let reached!: () => void;
    const arrived = new Promise<void>(r => { reached = r; }); const barrier = new Promise<void>(r => { resume = r; });
    let row: Awaited<ReturnType<typeof source>>;
    const persist = async () => { row = await source(op, 1370, 'LIVE-COMPLETION'); reached(); await barrier; return { header: { ...row, id: Number(row.id) } }; };
    const svc = op === 'MATERIAL_USAGE' ? new MaterialUsageService() : op === 'PRODUCTION_OUTPUT' ? new ProductionOutputService()
      : op === 'ADJUSTMENT' ? new AdjustmentsService() : new OutgoingGoodsService();
    const originalInsert = OutgoingGoodsRepository.prototype.insertOutgoingGoodsAsync;
    if (op === 'OUTGOING') OutgoingGoodsRepository.prototype.insertOutgoingGoodsAsync = async () => { await persist(); };
    else Object.assign((svc as unknown as { repository: object }).repository, { create: persist, batchUpsert: persist,
      findByWmsId: async () => row });
    const base = { wms_id: 'LIVE-COMPLETION', company_code: 1370, owner: 1370, transaction_date: '2026-10-24',
      timestamp: '2026-10-24T01:02:03.123Z', internal_evidence_number: 'EVIDENCE', section: null, reversal: null };
    const item = { item_type: 'ROH', item_code: 'LIVE-ITEM', item_name: 'Synthetic item', uom: 'PCS', qty: 1, amount: 10, currency: 'USD' };
    let response: unknown;
    try {
      if (op === 'MATERIAL_USAGE') response = await (svc as MaterialUsageService).processMaterialUsage({ ...base, work_order_number: 'WO', cost_center_number: null,
        items: [{ ...item, component_demand_qty: 10, traceability_data: [{ ppkek_number: 'N', qty: 1 }] }] });
      if (op === 'PRODUCTION_OUTPUT') response = await (svc as ProductionOutputService).processProductionOutput({ ...base,
        items: [{ ...item, item_type: 'FERT', work_order_number: 'WO', planned_production_qty: 10, identify_product: 'Y' }] });
      if (op === 'ADJUSTMENT') response = await (svc as AdjustmentsService).processAdjustment({ ...base, wms_doc_type: 'daily_adjustment',
        items: [{ ...item, adjustment_type: 'GAIN', reason: 'Synthetic', stockcount_order_number: null }] });
      if (op === 'OUTGOING') response = await (svc as OutgoingGoodsService).processOutgoingGoods({ ...base, customs_document_type: 'N',
        ppkek_number: 'N', customs_registration_date: 'N', outgoing_date: '2026-10-24', outgoing_evidence_number: 'EVIDENCE',
        invoice_number: 'INV', invoice_date: '2026-10-23', recipient_name: 'Synthetic', items: [{ ...item, work_order_allocations: [{ ppkek_number: 'N', qty: 1 }] }] });
      expect(response, JSON.stringify(response)).toMatchObject(op === 'MATERIAL_USAGE' ? { status: 'success' } : { success: true });
      await arrived; expect(await db.insw_queue_cycle.count()).toBe(0);
      if (failCapture) await db.insw_uom_mapping.deleteMany();
      resume();
      if (!failCapture) await expect.poll(() => db.insw_queue_cycle.count()).toBe(1);
      // Wait for continuation failure log or capture completion before restoring bound singleton.
      else await expect.poll(() => captureFailed).toBe(true);
      expect(await db.insw_queue_cycle.count()).toBe(failCapture ? 0 : 1);
      expect(httpCalls).toBe(0);
      const retryType = { OUTGOING: 'outgoing_goods', MATERIAL_USAGE: 'material_usage', PRODUCTION_OUTPUT: 'production_output', ADJUSTMENT: 'adjustments' } as const;
      const before = JSON.parse(JSON.stringify(await convert(op, 1370, row!.id).catch(() => null)));
      if (failCapture) await expect(continueWmsRetryToInsw(retryType[op], { id: Number(row!.id), companyCode: 1370, wmsId: row!.wms_id })).rejects.toThrow();
      else expect(await continueWmsRetryToInsw(retryType[op], { id: Number(row!.id), companyCode: 1370, wmsId: row!.wms_id })).toMatchObject({ status: 'skipped' });
      expect(JSON.parse(JSON.stringify(await convert(op, 1370, row!.id).catch(() => null)))).toEqual(before);
    } finally {
      resume?.(); logger.child = originalChild; logger.error = originalError; OutgoingGoodsRepository.prototype.insertOutgoingGoodsAsync = originalInsert; restore();
      if (failCapture) await db.insw_uom_mapping.upsert({ where: { wms_uom: 'PCS' }, update: {}, create: { wms_uom: 'PCS', insw_uom: 'PCE' } });
    }
  });
}

test('Outgoing submit and all five resend HTTP routes accept only queued known failures', async () => {
  await budget(0);
  await withApiSession(async () => {
    const submit = require('../app/api/insw/post/pengeluaran/route').POST;
    const resend = require('../app/api/insw/logs/[id]/resend/route').POST;
    const a = await outgoingFixture(1370, true, 'API-OUTGOING');
    await captureSource('OUTGOING', a);
    const response = await submit(new Request('http://localhost/api/insw/post/pengeluaran', { method: 'POST', body: JSON.stringify({ ids: [a.id] }) }));
    expect(response.status).toBe(202); expect(await response.json()).toMatchObject({ status: 'already_pending' });
    const token = await acquireOperationalOwnership(db);
    for (const op of remaining) {
      if (op !== 'OUTGOING') await captureSource(op, await source(op));
      await db.$executeRaw`UPDATE insw_dispatch_gate SET last_started_at = NULL, prior_interval_ms = NULL WHERE id = 1`;
      const { job } = await admitNext(db, token, 3600); expect(job?.operation).toBe(op); await finish(job!, token, false);
      const log = await db.insw_tracking_log.findFirstOrThrow({ orderBy: { id: 'desc' } });
      const detail = require('../app/api/insw/logs/[id]/route').GET;
      const eligibleDetail = await detail(new Request('http://localhost/log'), { params: Promise.resolve({ id: log.id.toString() }) });
      expect((await eligibleDetail.json()).data.can_resend).toBe(true);
      const call = () => resend(new Request('http://localhost/resend', { method: 'POST' }), { params: Promise.resolve({ id: log.id.toString() }) });
      const accepted = await call(); expect(accepted.status).toBe(202); expect(await accepted.json()).toMatchObject({ status: 'accepted' });
      expect((await call()).status).toBe(409);
      const ineligibleDetail = await detail(new Request('http://localhost/log'), { params: Promise.resolve({ id: log.id.toString() }) });
      expect((await ineligibleDetail.json()).data.can_resend).toBe(false);
      // Hold successor to let the next operation become the queue head.
      await db.insw_queue_cycle.updateMany({ where: { status: 'READY' }, data: { status: 'HELD', delivery_state: 'POSSIBLY_STARTED', hold_reason: 'DELIVERY_UNKNOWN' } });
      expect((await db.insw_tracking_log.findUniqueOrThrow({ where: { id: log.id } })).insw_status).toBe('FAILED');
    }
    const page = await require('../app/api/insw/logs/route').GET(new Request('http://localhost/api/insw/logs?limit=25'));
    expect(page.status).toBe(200);
    const logs = (await page.json()).data as { transaction_type: string; can_resend: boolean }[];
    expect(logs).toHaveLength(5); expect(logs.every(log => log.can_resend === false)).toBe(true);
  });
});

for (const op of remaining) test(`${op}: pending, owned, HOLD and known-success states independently refuse resend`, async () => {
  await budget(0); const row = await source(op); await captureSource(op, row);
  const token = await acquireOperationalOwnership(db); const { job } = await admitNext(db, token, 3600); await finish(job!, token, false);
  const log = await db.insw_tracking_log.findFirstOrThrow();
  for (const state of ['READY', 'CLAIMED', 'HELD', 'REMOTE_SUCCEEDED', 'SUCCEEDED'] as const) {
    await db.insw_queue_cycle.update({ where: { id: job!.id }, data: { status: state,
      completed_at: state === 'SUCCEEDED' ? new Date() : null,
      delivery_state: state === 'HELD' ? 'POSSIBLY_STARTED' : ['SUCCEEDED', 'REMOTE_SUCCEEDED'].includes(state) ? 'KNOWN_SUCCESS' : 'NOT_STARTED',
      hold_reason: state === 'HELD' ? 'DELIVERY_UNKNOWN' : null,
      owner_token: ['CLAIMED', 'REMOTE_SUCCEEDED'].includes(state) ? '00000000-0000-4000-8000-000000000001' : null,
      lease_until: ['CLAIMED', 'REMOTE_SUCCEEDED'].includes(state) ? new Date(Date.now() + 60000) : null } });
    await expect(resendWmsLog(db, 1370, log.id, 'op', 'forbidden')).rejects.toThrow('exhausted');
    expect((await wmsLogResendEligibility(db, 1370, [log.id])).size).toBe(0);
  }
  expect(await db.insw_queue_cycle.count()).toBe(1);
});

import { WmsStockOpnameService } from '../lib/services/wms-stock-opname.service';
import { NextRequest } from 'next/server';
for (const [status, exactId] of [['Confirmed', undefined], ['Cancelled', undefined], ['Confirmed', BigInt(2147483648)]] as const) test(`live Stock Opname PATCH ${status} id=${exactId ?? 'normal'} retains HTTP 200 and confirmation-only capture`, async () => {
  const restore = bindFixtureSingletons(); const auth = require('../lib/middleware/auth.middleware'); const originalAuth = auth.authenticate;
  auth.authenticate = async () => ({ authenticated: true });
  const original = WmsStockOpnameService.prototype.processUpdate;
  let resume!: () => void; let reached!: () => void;
  const arrived = new Promise<void>(r => { reached = r; }); const barrier = new Promise<void>(r => { resume = r; });
  WmsStockOpnameService.prototype.processUpdate = async () => {
    const row = await countFixture('STOCK_OPNAME', 1370, 'LIVE-STOCK', exactId); reached(); await barrier;
    return { id: row.id.toString(), company_code: 1370, wms_id: row.wms_id, document_date: '2026-10-24',
      confirmed_at: '2026-10-24T12:34:56.789Z', status };
  };
  try {
    const patch = require('../app/api/v1/stock-opname/route').PATCH;
    const responsePromise = patch(new NextRequest('http://localhost/api/v1/stock-opname', { method: 'PATCH', body: JSON.stringify({
      wms_id: 'LIVE-STOCK', status, timestamp: '2026-10-24T01:02:03.123Z',
      items: [{ item_type: 'ROH', item_code: 'ITEM-0', item_name: 'Fixture', uom: 'PCS', actual_qty_count: 12 }] }) }));
    await arrived; expect(await db.insw_queue_cycle.count()).toBe(0); resume();
    const response = await responsePromise; expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ success: true, data: { status } });
    if (status === 'Confirmed' && exactId === undefined) await expect.poll(() => db.insw_queue_cycle.count()).toBe(1);
    else expect(await db.insw_queue_cycle.count()).toBe(0);
    expect(httpCalls).toBe(0);
  } finally { resume?.(); WmsStockOpnameService.prototype.processUpdate = original; auth.authenticate = originalAuth; restore(); }
});

for (const op of ['OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT'] as const) for (const failCapture of [false, true]) {
  test(`${op}: WMS log retry skips persisted business replay and retains local SUCCESS when capture fails=${failCapture}`, async () => {
    const row = await source(op, 1370, 'RETRY-PERSISTED');
    const action = { OUTGOING: 'WMS_PROCESS_OUTGOING_GOODS', MATERIAL_USAGE: 'WMS_PROCESS_MATERIAL_USAGE', PRODUCTION_OUTPUT: 'WMS_PROCESS_PRODUCTION_OUTPUT', ADJUSTMENT: 'WMS_PROCESS_ADJUSTMENTS' }[op];
    const base = { wms_id: row.wms_id, company_code: 1370, owner: 1370, transaction_date: '2026-10-24',
      timestamp: '2026-10-24T01:02:03.123Z', internal_evidence_number: 'EVIDENCE', section: null, reversal: null };
    const item = { item_type: 'ROH', item_code: 'RETRY-ITEM', item_name: 'Synthetic', uom: 'PCS', qty: 1, amount: 10, currency: 'USD' };
    const payload = op === 'MATERIAL_USAGE' ? { ...base, work_order_number: 'WO', cost_center_number: null,
      items: [{ ...item, component_demand_qty: 10, traceability_data: [{ ppkek_number: 'N', qty: 1 }] }] }
      : op === 'PRODUCTION_OUTPUT' ? { ...base, items: [{ ...item, item_type: 'FERT', work_order_number: 'WO', planned_production_qty: 10, identify_product: 'Y' }] }
      : op === 'ADJUSTMENT' ? { ...base, wms_doc_type: 'daily_adjustment', items: [{ ...item, adjustment_type: 'GAIN', reason: 'Synthetic', stockcount_order_number: null }] }
      : { ...base, customs_document_type: 'N', ppkek_number: 'N', customs_registration_date: 'N', outgoing_date: '2026-10-24',
        outgoing_evidence_number: 'EVIDENCE', invoice_number: 'INV', invoice_date: '2026-10-23', recipient_name: 'Synthetic',
        items: [{ ...item, work_order_allocations: [{ ppkek_number: 'N', qty: 1 }] }] };
    for (const type of ['ROH', 'FERT']) await db.item_types.upsert({ where: { item_type_code: type }, update: {},
      create: { item_type_code: type, name_en: 'Synthetic', category: 'fixture' } });
    const activity = await db.activity_logs.create({ data: { action, description: 'Synthetic async failure' } });
    const log = await db.wms_transmission_logs.create({ data: { activity_log_id: activity.id, action,
      company_code: 1370, wms_id: row.wms_id, transmission_status: 'ERROR', error_type: 'ASYNC_PROCESSING_ERROR', wms_request_payload: payload } });
    const before = JSON.parse(JSON.stringify(await convert(op, 1370, row.id)));
    if (failCapture) await db.insw_uom_mapping.deleteMany();
    try {
      await withApiSession(async () => {
        queries = [];
        const response = await require('../app/api/settings/wms-transmission-logs/[id]/retry/route').POST(
          new Request('http://localhost/retry', { method: 'POST' }), { params: Promise.resolve({ id: log.id.toString() }) });
        expect(response.status).toBe(200);
        const body = await response.json(); expect(body.success, JSON.stringify(body)).toBe(true);
        expect(body.insw.status).toBe(failCapture ? 'failed' : 'accepted');
        const businessWrites = queries.filter(q => /(?:INSERT INTO|UPDATE|DELETE FROM)\s+"?(?:incoming_goods|outgoing_goods|material_usages|production_outputs|adjustments|stock_daily_snapshot)"?\s/i.test(q.query));
        expect(businessWrites).toEqual([]);
        expect(await db.insw_queue_cycle.count()).toBe(failCapture ? 0 : 1); expect(httpCalls).toBe(0);
      });
    } finally { if (failCapture) await db.insw_uom_mapping.create({ data: { wms_uom: 'PCS', insw_uom: 'PCE' } }); }
    expect(JSON.parse(JSON.stringify(await convert(op, 1370, row.id)))).toEqual(before);
  });
}
