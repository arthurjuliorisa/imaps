import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { OutgoingGoodsService } from '../lib/services/outgoing-goods.service';
import { captureCompletedWmsSource, type CompletedSourceCapture } from '../lib/insw-worker/completed-source-capture';
import type { INSWIntegrationRepository } from '../lib/repositories/insw-integration.repository';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
const url = process.env.INSW_OUTCOME_TEST_DATABASE_URL;
test.skip(!url, 'NEW empty disposable loopback *_phase_c2b_test required');
let db: PrismaClient;
let queries: { query: string; params: string }[] = [];
let httpCalls = 0;
const originalFetch = globalThis.fetch;
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
  await db.outgoing_good_items.deleteMany(); await db.outgoing_goods.deleteMany();
  await db.scrap_transactions.deleteMany();
  await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany();
  await db.companies.updateMany({ where: { code: { in: [1370, 1380] } }, data: { company_type: 'SEZ' } });
  queries = [];
});
test.afterAll(async () => { globalThis.fetch = originalFetch; await db?.$disconnect(); });
async function fixture(company: number, nonFacility = false, ref = `SOURCE-${company}-${nonFacility}`) {
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
type Scope = { companyCode: number; wmsReference: string; businessDate: string; requestedBy: string };
// Deliberate test-only access to the private producer integration seam. This
// simulates the trusted caller's completed promise, NOT DB-derived provenance.
// Production callers cannot access this method through its TypeScript API.
const seam = new OutgoingGoodsService() as unknown as {
  captureCompletedOutgoing(db: PrismaClient, completion: Promise<void>, scope: Scope): ReturnType<typeof captureCompletedWmsSource>;
};
if (false) {
  // @ts-expect-error Outgoing completion capture is private to the WMS service.
  new OutgoingGoodsService().captureCompletedOutgoing(db, Promise.resolve(), {});
}
function scope(row: { company_code: number; wms_id: string; outgoing_date: Date }): Scope {
  return { companyCode: row.company_code, wmsReference: row.wms_id,
    businessDate: row.outgoing_date.toISOString().slice(0, 10), requestedBy: 'trusted-wms-completion' };
}
function handoff(row: Parameters<typeof scope>[0], completion = Promise.resolve(), database = db) {
  return seam.captureCompletedOutgoing(database, completion, scope(row));
}
function generic(row: Parameters<typeof scope>[0] & { id: number }): CompletedSourceCapture {
  return { operation: 'OUTGOING', companyCode: row.company_code, sourceId: row.id,
    businessDate: scope(row).businessDate, requestedBy: 'arbitrary-caller', revision: 'ACCEPTED_WMS_ID',
    completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED' } as unknown as CompletedSourceCapture;
}
async function counts() {
  return Promise.all([db.insw_queue_cycle.count(), db.insw_queue_attempt.count(), db.insw_tracking_log.count(), db.insw_worker_recovery.count()]);
}
async function baseline(row: { company_code: number; id: number; wms_id: string }) {
  const converter = new INSWIntegrationService('', '', true, db);
  // Legacy ByWmsIds still uses the application singleton. Bind only this
  // converter instance's repository read to the injected fixture client using
  // its exact unchanged SQL; never redirect the application singleton.
  const repository = (converter as unknown as { repository: INSWIntegrationRepository }).repository;
  const repositorySource = readFileSync('lib/repositories/insw-integration.repository.ts', 'utf8');
  const method = repositorySource.slice(repositorySource.indexOf('  async getLaporanPengeluaranByWmsIds('));
  const query = method.match(/const query = `([\s\S]*?)`;/)![1];
  repository.getLaporanPengeluaranByWmsIds = (company, refs) => db.$queryRawUnsafe(query, company, refs);
  const byId = await converter.convertPengeluaranToINSWByIds(row.company_code, [row.id]);
  expect(await converter.convertPengeluaranToINSWByWmsIds(row.company_code, [row.wms_id])).toEqual(byId);
  return byId;
}
for (const company of [1370, 1380]) for (const nf of [false, true]) {
  test(`${company} ${nf ? 'N/N/N' : 'standard'} trusted completion: full converter parity, concurrent and terminal dedupe, zero HTTP`, async () => {
    const row = await fixture(company, nf);
    const expected = await baseline(row);
    const items = expected.data[0].dokumenKegiatan[0].barangTransaksi;
    expect(items).toHaveLength(2);
    if (nf) expect(items.map(i => i.dokumen)).toEqual([[], []]);
    const original = INSWIntegrationService.prototype.convertPengeluaranToINSWByIds;
    const args: number[][] = [];
    INSWIntegrationService.prototype.convertPengeluaranToINSWByIds = function(c, ids) {
      args.push(ids); return original.call(this, c, ids);
    };
    queries = [];
    try {
      const results = await Promise.all([handoff(row), handoff(row)]);
      expect(results[0].id).toBe(results[1].id);
      expect(results.filter(r => r.created)).toHaveLength(1);
      expect(args).toEqual([[row.id], [row.id]]);
      const capturedQueries = queries.length;
      const frozen = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: results[0].id } });
      expect(frozen.frozen_payload).toEqual(expected);
      await db.insw_queue_cycle.update({ where: { id: frozen.id }, data: {
        status: 'SUCCEEDED', delivery_state: 'KNOWN_SUCCESS', completed_at: new Date() } });
      expect(await handoff(row)).toEqual({ outcome: 'ALREADY_CAPTURED', id: frozen.id, created: false });
      expect(args).toHaveLength(2); // terminal capture never reconverts
      // Prior capture does not enable arbitrary-ID enrollment.
      await expect(captureCompletedWmsSource(db, generic(row))).rejects.toThrow('OUTGOING_REFERENCE_SCOPE_REQUIRED');
      expect(await counts()).toEqual([1, 0, 0, 0]); expect(httpCalls).toBe(0);
      console.log('S1 concurrent capture SQL count including transaction commands', capturedQueries);
    } finally { INSWIntegrationService.prototype.convertPengeluaranToINSWByIds = original; }
  });
}
test('existing visible source cannot enroll until the trusted business promise resolves; detached scope is retained', async () => {
  const row = await fixture(1370);
  let resolve!: () => void;
  const completion = new Promise<void>(r => { resolve = r; });
  const expected = scope(row);
  queries = [];
  const capture = seam.captureCompletedOutgoing(db, completion, expected);
  expected.companyCode = 1380; expected.wmsReference = 'MUTATED';
  await Promise.resolve();
  expect(queries).toEqual([]); expect(await counts()).toEqual([0, 0, 0, 0]);
  resolve();
  expect((await capture).created).toBe(true); expect(httpCalls).toBe(0);
});
test('rejected business promise never reads or captures even when the header exists', async () => {
  const row = await fixture(1370); queries = [];
  await expect(handoff(row, Promise.reject(new Error('BUSINESS_FAILURE')))).rejects.toThrow('BUSINESS_FAILURE');
  expect(queries).toEqual([]); expect(await counts()).toEqual([0, 0, 0, 0]);
});
test('arbitrary Outgoing IDs fail closed; fixture labels do not establish origin; paired Scrap is excluded', async () => {
  const row = await fixture(1370, false, 'CAPITAL-LIKE');
  await db.outgoing_good_items.updateMany({ data: { item_type: 'HIBE-M' } });
  const scrap = await db.scrap_transactions.create({ data: { company_code: 1370, transaction_date: row.outgoing_date,
    transaction_type: 'OUT', document_number: 'SCRAP' } });
  const paired = await fixture(1370, false, 'PAIRED-SCRAP');
  await db.outgoing_goods.update({ where: { id: paired.id }, data: { scrap_transaction_id: scrap.id } });
  for (const r of [row, paired]) {
    queries = [];
    await expect(captureCompletedWmsSource(db, generic(r))).rejects.toThrow('OUTGOING_REFERENCE_SCOPE_REQUIRED');
    expect(queries).toEqual([]);
  }
  await expect(handoff(paired)).resolves.toBeUndefined();
  expect(await counts()).toEqual([0, 0, 0, 0]); expect(httpCalls).toBe(0);
  // Neither the reference label nor item type proves manual/WMS origin. This
  // test-only private seam simulates a trusted WMS caller even for this label.
  // Manual selection still needs independent WMS acceptance/capture evidence.
  expect((await handoff(row)).created).toBe(true);
});
test('missing completion context and malformed reference/date fail with no lifecycle writes', async () => {
  const row = await fixture(1370);
  queries = [];
  await expect(seam.captureCompletedOutgoing(db, undefined as unknown as Promise<void>, scope(row)))
    .rejects.toThrow('BUSINESS_COMPLETION_CONTEXT_REQUIRED');
  expect(queries).toEqual([]);
  for (const bad of [{ completion: undefined }, { wmsReference: '' }, { wmsReference: null },
    { businessDate: 'invalid' }, { businessDate: '2026-02-30' }, { revision: 'FORGED' }]) {
    await expect(captureCompletedWmsSource(db, { ...scope(row), operation: 'OUTGOING',
      revision: 'ACCEPTED_WMS_ID', completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED', ...bad } as unknown as CompletedSourceCapture)).rejects.toThrow();
    expect(await counts()).toEqual([0, 0, 0, 0]);
  }
  expect(httpCalls).toBe(0);
});
test('distinct original IDs sharing evidence/date stay separate', async () => {
  const a = await fixture(1370, false, 'DISTINCT-A');
  const b = await fixture(1370, false, 'DISTINCT-B');
  const results = await Promise.all([handoff(a), handoff(b)]);
  expect(results[0].id).not.toBe(results[1].id);
  for (let n = 0; n < 2; n++) {
    const row = [a, b][n];
    expect((await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: results[n].id } })).frozen_payload).toEqual(await baseline(row));
  }
  expect(await counts()).toEqual([2, 0, 0, 0]); expect(httpCalls).toBe(0);
});
test('ambiguous reference across dates is rejected rather than choosing latest', async () => {
  const row = await fixture(1370, false, 'AMBIGUOUS');
  const other = await fixture(1370, false, 'OTHER');
  await db.outgoing_good_items.deleteMany({ where: { outgoing_good_id: other.id } });
  await db.outgoing_goods.update({ where: { id: other.id }, data: { wms_id: row.wms_id, outgoing_date: new Date('2026-10-23') } });
  await expect(handoff(row)).resolves.toBeUndefined();
  expect(await counts()).toEqual([0, 0, 0, 0]);
});
test('wrong company/date/reference, stale/deleted header, BZ and approved-code actual BZ have zero lifecycle writes', async () => {
  const row = await fixture(1370);
  const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  for (const bad of [{ companyCode: 1380 }, { companyCode: 1310 }, { companyCode: 1399 },
    { businessDate: '2026-10-23' }, { wmsReference: 'ABSENT' }, { requestedBy: '' }]) {
    await expect(seam.captureCompletedOutgoing(db, Promise.resolve(), { ...scope(row), ...bad })).resolves.toBeUndefined();
    expect(await counts()).toEqual([0, 0, 0, 0]);
  }
  await db.outgoing_goods.update({ where: { id: row.id }, data: { deleted_at: new Date() } });
  await expect(handoff(row)).resolves.toBeUndefined();
  await db.outgoing_goods.delete({ where: { id: row.id } });
  await expect(handoff(row)).resolves.toBeUndefined();
  const bz = await fixture(1310); await expect(handoff(bz)).resolves.toBeUndefined();
  const disguised = await fixture(1370, false, 'ACTUAL-BZ');
  await db.companies.update({ where: { code: 1370 }, data: { company_type: 'BZ' } });
  await expect(handoff(disguised)).resolves.toBeUndefined();
  expect(await counts()).toEqual([0, 0, 0, 0]);
  expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate); expect(httpCalls).toBe(0);
});
test('missing UOM fails before queue writes', async () => {
  const row = await fixture(1370);
  await db.outgoing_good_items.updateMany({ data: { uom: 'UNMAPPED' } });
  await expect(handoff(row)).resolves.toBeUndefined();
  expect(await counts()).toEqual([0, 0, 0, 0]); expect(httpCalls).toBe(0);
});
for (const corruption of ['activity', 'document', 'company-race', 'reference-race', 'deleted-race', 'scrap-race', 'date-race', 'association-race', 'source-id'] as const) {
  test(`${corruption}: malformed projection or changed original association rejects without writes`, async () => {
    const row = await fixture(1370);
    const other = await fixture(1370, false, 'OTHER-SOURCE');
    const original = INSWIntegrationService.prototype.convertPengeluaranToINSWByIds;
    INSWIntegrationService.prototype.convertPengeluaranToINSWByIds = async function(c, ids) {
      const payload = await original.call(this, c, ids);
      if (corruption === 'activity') payload.data[0].kdKegiatan = '30';
      if (corruption === 'document') payload.data[0].dokumenKegiatan[0].nomorDokKegiatan = 'WRONG';
      if (corruption === 'company-race') await db.companies.update({ where: { code: 1370 }, data: { company_type: 'BZ' } });
      if (corruption === 'date-race') await db.outgoing_goods.update({ where: { id: row.id }, data: { outgoing_date: new Date('2026-10-22') } });
      if (corruption === 'association-race') {
        await db.outgoing_good_items.deleteMany({ where: { outgoing_good_id: other.id } });
        await db.outgoing_goods.update({ where: { id: other.id }, data: { wms_id: row.wms_id, outgoing_date: new Date('2026-10-23') } });
      }
      if (corruption === 'reference-race') await db.outgoing_goods.update({ where: { id: row.id }, data: { wms_id: 'CHANGED' } });
      if (corruption === 'scrap-race') {
        const scrap = await db.scrap_transactions.create({ data: { company_code: 1370, transaction_date: row.outgoing_date,
          transaction_type: 'OUT', document_number: 'RACE-SCRAP' } });
        await db.outgoing_goods.update({ where: { id: row.id }, data: { scrap_transaction_id: scrap.id } });
      }
      if (corruption === 'deleted-race') await db.outgoing_goods.update({ where: { id: row.id }, data: { deleted_at: new Date() } });
      return payload;
    };
    try {
      if (corruption === 'source-id') {
        // Spoof only the initial bounded lookup; exact-source capture must
        // independently reject the ID whose persisted reference differs.
        let first = true;
        const database = new Proxy(db, { get(target, key) {
          if (key === 'outgoing_goods') return new Proxy(target.outgoing_goods, { get(model, method) {
            if (method === 'findMany') return async (...args: unknown[]) => {
              if (first) { first = false; return [{ id: other.id, outgoing_date: row.outgoing_date, scrap_transaction_id: null }]; }
              return (model.findMany as Function).apply(model, args);
            };
            return Reflect.get(model, method);
          } });
          const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
        } });
        await expect(handoff(row, Promise.resolve(), database)).resolves.toBeUndefined();
      } else await expect(handoff(row)).resolves.toBeUndefined();
      expect(await counts()).toEqual([0, 0, 0, 0]); expect(httpCalls).toBe(0);
    } finally { INSWIntegrationService.prototype.convertPengeluaranToINSWByIds = original; }
  });
}
