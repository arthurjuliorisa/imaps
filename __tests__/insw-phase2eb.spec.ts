import { test, expect } from '@playwright/test';
import { InswQueueOperation, PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
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
  const start = sql.indexOf('CREATE OR REPLACE VIEW vw_laporan_pemasukan AS');
  await db.$executeRawUnsafe(sql.slice(start, sql.indexOf(';', start) + 1));
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
  throw new Error('OUTGOING_UNPROVEN_ORIGIN');
}
function input(operation: CompletedSourceCapture['operation'], id: number | bigint | string, company = 1370): CompletedSourceCapture {
  return { operation, sourceId: id, companyCode: company, businessDate: '2026-10-24',
    revision: operation === 'ADJUSTMENT' ? 'COMMITTED_SOURCE' : operation === 'STOCK_OPNAME'
      ? 'CONFIRMED:2026-10-24T12:34:56.789Z' : 'ACCEPTED_WMS_ID',
    requestedBy: 'completed-wms-source', completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED' };
}
async function counts() {
  return Promise.all([db.insw_queue_cycle.count(), db.insw_queue_attempt.count(), db.insw_tracking_log.count(), db.insw_worker_recovery.count()]);
}
async function convert(operation: CompletedSourceCapture['operation'], company: number, id: number | bigint) {
  const c = new INSWIntegrationService('', '', true, db);
  return operation === 'INCOMING' ? c.convertPemasukanToINSW(company, [Number(id)])
    : operation === 'MATERIAL_USAGE' ? c.convertMaterialUsageToINSW(company, [Number(id)])
      : operation === 'PRODUCTION_OUTPUT' ? c.convertProductionOutputToINSW(company, [Number(id)])
        : operation === 'ADJUSTMENT' ? c.convertAdjustmentToINSW(company, Number(id)) : c.convertStockOpnameToINSW(company, Number(id));
}

for (const operation of operations.filter(o => o !== 'OUTGOING')) for (const company of [1370, 1380]) {
  test(`${operation} ${company}: production seam complete JSON parity, concurrency and terminal any-cycle dedupe without HTTP`, async () => {
    const row = await source(operation, company);
    const baseline = await convert(operation, company, row.id);
    expect(baseline.data[0].dokumenKegiatan[0].barangTransaksi.length).toBeGreaterThan(1);
    queries = [];
    const results = await Promise.all([captureCompletedWmsSource(db, input(operation, row.id, company)),
      captureCompletedWmsSource(db, input(operation, String(row.id), company))]);
    expect(results[0].id).toBe(results[1].id); expect(results.filter(r => r.created)).toHaveLength(1);
    const frozen = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: results[0].id } });
    expect(frozen.frozen_payload).toEqual(baseline);
    expect(JSON.parse(frozen.identity_key)[3]).toBe(['ADJUSTMENT', 'STOCK_OPNAME'].includes(operation) ? 'SOURCE_HEADER' : 'WMS_REFERENCE');
    const captureQueryCount = queries.length;
    await db.insw_queue_cycle.update({ where: { id: frozen.id }, data: { status: 'SUCCEEDED', delivery_state: 'KNOWN_SUCCESS', completed_at: new Date() } });
    expect(await captureCompletedWmsSource(db, input(operation, BigInt(row.id), company))).toEqual({ outcome: 'ALREADY_CAPTURED', id: frozen.id, created: false });
    expect(await counts()).toEqual([1, 0, 0, 0]); expect(httpCalls).toBe(0);
    console.log('PHASE2EB capture queries (two concurrent calls)', operation, company, captureQueryCount);
  });
}
for (const operation of ['MATERIAL_USAGE', 'PRODUCTION_OUTPUT'] as const) test(`${operation} reversal complete JSON remains unchanged`, async () => {
  const row = await source(operation, 1370, 'REVERSED', true);
  const result = await captureCompletedWmsSource(db, input(operation, row.id));
  expect((await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: result.id } })).frozen_payload).toEqual(await convert(operation, 1370, row.id));
  expect(httpCalls).toBe(0);
});

for (const operation of operations.filter(o => o !== 'OUTGOING')) test(`${operation} invalid capture has zero lifecycle writes`, async () => {
  const row = await source(operation);
  const valid = input(operation, row.id);
  const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  for (const bad of [
    { ...valid, completion: undefined }, { ...valid, companyCode: 1310 }, { ...valid, companyCode: 1399 },
    { ...valid, companyCode: 1380 }, { ...valid, businessDate: '2026-10-23' }, { ...valid, revision: 'FORGED' },
    { ...valid, sourceId: [row.id] }, { ...valid, sourceId: '1,2' }, { ...valid, sourceId: BigInt(2147483648) },
    { ...valid, sourceId: 9007199254740992 }, { ...valid, sourceId: '2147483647' },
    { ...valid, operation: 'CAPITAL_OUTGOING' }, { ...valid, requestedBy: '' },
  ]) {
    await expect(captureCompletedWmsSource(db, bad as CompletedSourceCapture)).rejects.toThrow();
    expect(await counts()).toEqual([0, 0, 0, 0]);
  }
  await db.companies.update({ where: { code: 1370 }, data: { company_type: 'BZ' } });
  await expect(captureCompletedWmsSource(db, valid)).rejects.toThrow();
  expect(await counts()).toEqual([0, 0, 0, 0]);
  expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate); expect(httpCalls).toBe(0);
});

for (const operation of ['INCOMING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT'] as const) test(`${operation} ambiguous WMS reference across original dated sources refuses enrollment`, async () => {
  const row = await source(operation, 1370, 'SHARED');
  const second = await source(operation, 1370, 'OTHER');
  if (operation === 'INCOMING') await db.incoming_goods.update({ where: { id: Number(second.id) }, data: { wms_id: 'SHARED', incoming_date: new Date('2026-10-23') } });
  else if (operation === 'MATERIAL_USAGE') await db.material_usages.update({ where: { id: Number(second.id) }, data: { wms_id: 'SHARED', transaction_date: new Date('2026-10-23') } });
  else await db.production_outputs.update({ where: { id: Number(second.id) }, data: { wms_id: 'SHARED', transaction_date: new Date('2026-10-23') } });
  await expect(captureCompletedWmsSource(db, input(operation, row.id))).rejects.toThrow('AMBIGUOUS_ORIGINAL_SOURCE');
  expect(await counts()).toEqual([0, 0, 0, 0]); expect(httpCalls).toBe(0);
});

test('all Outgoing including Capital, paired Scrap and unproven WMS IDs fail closed before DB access', async () => {
  for (const id of [1, 2, 3]) {
    queries = [];
    await expect(captureCompletedWmsSource(db, input('OUTGOING', id))).rejects.toThrow('OUTGOING_WMS_ORIGIN_ADAPTER_REQUIRED');
    expect(queries).toEqual([]);
  }
  expect(await counts()).toEqual([0, 0, 0, 0]); expect(httpCalls).toBe(0);
});

test('Confirmed eligibility and persisted revision are mandatory', async () => {
  const row = await countFixture('STOCK_OPNAME', 1370);
  for (const status of ['Active', 'Cancelled', 'Confirmed'] as const) {
    await db.wms_stock_opnames.update({ where: { id: row.id }, data: { status, confirmed_at: null } });
    await expect(captureCompletedWmsSource(db, input('STOCK_OPNAME', row.id))).rejects.toThrow();
  }
  expect(await counts()).toEqual([0, 0, 0, 0]);
});

for (const operation of Object.values(InswQueueOperation).filter(o => !operations.includes(o as typeof operations[number]))) {
  for (const company of [1370, 1380, 1310]) for (const actualBz of [false, true]) {
    test(`unsupported ${operation}, code ${company}, forged BZ ${actualBz}: unchanged invalid READY, zero candidate writes, valid behind claims`, async () => {
      // Forge malformed unsupported rows directly; no source or identity proof.
      const forged = await db.insw_queue_cycle.create({ data: { company_code: company, operation,
        identity_key: `malformed-${operation}-${company}`, source_revision: 'MISSING_SOURCE', business_date: '2026-10-24',
        cycle: 1, intent: 'SOURCE_COMMIT', requested_by: 'forged', frozen_payload: { data: 'malformed' },
        payload_sha256: '0'.repeat(64), max_auto_retry_snapshot: 0 } });
      if (actualBz) await db.companies.update({ where: { code: company }, data: { company_type: 'BZ' } });
      const invalid = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: forged.id } });
      const token = await acquireOperationalOwnership(db);
      const gate = await db.insw_dispatch_gate.findFirstOrThrow(); // independent acquisition may write ownership
      queries = [];
      expect((await admitNext(db, token)).job).toBeNull();
      const selector = queries.find(q => q.query.startsWith('SELECT q.id FROM insw_queue_cycle q'))!;
      expect(selector.query).toContain('FOR UPDATE OF q SKIP LOCKED LIMIT 1');
      const matched = selector.query.match(/q.operation IN \(([^)]+)\)/)![1].match(/'([A-Z_]+)'/g)!.map(s => s.slice(1, -1));
      expect(matched).toEqual(operations);
      expect(await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: invalid.id } })).toEqual(invalid);
      expect(await counts()).toEqual([1, 0, 0, 0]); expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate);
      // EXPLAIN the exact runtime selector on disposable fixtures, without executing locks/mutations.
      if (operation === 'CAPITAL_OUTGOING' && company === 1370 && !actualBz) {
        const plan = await db.$queryRawUnsafe(`EXPLAIN (FORMAT JSON) ${selector.query}`);
        writeFileSync('/tmp/imaps-phase2eb-selector-plan.json', JSON.stringify(plan, null, 2));
      }
      await db.companies.update({ where: { code: 1370 }, data: { company_type: 'SEZ' } });
      const valid = await incomingFixture(1370, true, 'VALID-BEHIND');
      const captured = await captureCompletedWmsSource(db, input('INCOMING', valid.id));
      expect((await admitNext(db, token)).job?.id).toBe(captured.id);
      expect(await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: invalid.id } })).toEqual(invalid);
      expect(await db.insw_queue_attempt.count({ where: { queue_id: invalid.id } })).toBe(0);
      expect(await db.insw_tracking_log.count()).toBe(0); expect(await db.insw_worker_recovery.count()).toBe(0); expect(httpCalls).toBe(0);
    });
  }
}

for (const operation of operations.filter(o => o !== 'OUTGOING')) test(`${operation} eligibility changed after conversion rejects before handoff writes`, async () => {
  const row = await source(operation);
  const database = new Proxy(db, { get(target, key) {
    if (key === '$transaction') return async (...args: unknown[]) => {
      await target.companies.update({ where: { code: 1370 }, data: { company_type: 'BZ' } });
      return (target.$transaction as Function).apply(target, args);
    };
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
  await expect(captureCompletedWmsSource(database, input(operation, row.id))).rejects.toThrow();
  expect(await counts()).toEqual([0, 0, 0, 0]); expect(httpCalls).toBe(0);
});

for (const operation of operations.filter(o => o !== 'OUTGOING')) test(`${operation} distinct originals sharing date/evidence remain separate complete envelopes`, async () => {
  const a = await source(operation, 1370, 'FIRST'); const b = await source(operation, 1370, 'SECOND');
  const first = await captureCompletedWmsSource(db, input(operation, a.id));
  const second = await captureCompletedWmsSource(db, input(operation, b.id));
  expect(first.id).not.toBe(second.id);
  const rows = await db.insw_queue_cycle.findMany({ orderBy: { tail_key: 'asc' } });
  expect(rows.map(r => r.frozen_payload)).toEqual([await convert(operation, 1370, a.id), await convert(operation, 1370, b.id)]);
  expect(await counts()).toEqual([2, 0, 0, 0]); expect(httpCalls).toBe(0);
});
