import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { enqueueExisting } from '../lib/insw-queue/queue.repository';
import { readPolicy, updatePolicy } from '../lib/insw-queue/policy.repository';
import { acquireOperationalOwnership, admitNext, recoverOperationalOwnership } from '../lib/insw-worker/operational.repository';

import { isolatedIncomingPilot } from '../lib/insw-worker/incoming-pilot';
import { countSourceId, readCountSource } from '../lib/insw-worker/adjustment-stock-opname-source';
import { prepareCountHandoff } from '../lib/insw-queue/incoming-handoff';
import { prepareIsolatedCountFinalizer } from '../lib/insw-worker/incoming-finalizer';
import { prisma } from '../lib/prisma';
const url = process.env.INSW_OUTCOME_TEST_DATABASE_URL;
test.skip(!url, 'NEW empty disposable loopback *_phase_c2b_test required');
let db: PrismaClient; let server: Server; let endpoint: string;
let arrivals: { at: number; body: any }[]; let handler: (res: ServerResponse) => void;
let active = 0; let maxActive = 0; let transactionOpen = 0; let transactionMs: number[] = []; let queries: string[] = []; let children: ChildProcess[] = [];
const authorization = 'DISPOSABLE_INCOMING_FIXTURES_ONLY' as const;
async function policy(retries: number, interval = 3600) {
  const p = await readPolicy(db); await updatePolicy(db, p.version,
    { min_processing_interval_ms: interval, max_auto_retry: retries }, 'fixture', 'Disposable Phase 2C only');
}
async function reap(p: ChildProcess) {
  if (p.exitCode !== null || p.signalCode !== null) return;
  await new Promise<void>(resolve => { p.once('close', () => resolve()); p.kill('SIGKILL'); });
}
const messages = new Map<ChildProcess, string[]>();
async function event(p: ChildProcess, name: string) {
  await expect.poll(() => messages.get(p)!.includes(name), { timeout: 35000 }).toBe(true);
}
async function recover() {
  const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  return recoverOperationalOwnership(db, { expectedToken: gate.owner_token!, operator: 'fixture',
    evidence: 'Fixture child killed and close/reap awaited; no supervisor', shutdownAcknowledged: true });
}
type Operation = 'ADJUSTMENT' | 'STOCK_OPNAME';
async function fixture(operation: Operation, company: number, ref = `${operation}-${company}`, id?: bigint) {
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
function pilotConfig(adjustmentIds: bigint[], stockIds: bigint[]): Parameters<typeof isolatedIncomingPilot>[1] {
  return { authorization, sourceIds: [], fullyPersistedAdjustmentSourceIds: adjustmentIds.map(Number),
    confirmedStockOpnameSourceIds: stockIds, endpoint };
}
async function pilot(operation: Operation, ids: bigint[]) {
  const p = await isolatedIncomingPilot(db, pilotConfig(operation === 'ADJUSTMENT' ? ids : [], operation === 'STOCK_OPNAME' ? ids : []));
  return { capture: (company: number, id: bigint) => operation === 'ADJUSTMENT'
    ? p.captureAdjustment(company, Number(id)) : p.captureStockOpname(company, id), run: p.run };
}
async function convert(operation: Operation, company: number, id: bigint) {
  const c = new INSWIntegrationService('', '', true, db);
  return operation === 'ADJUSTMENT' ? c.convertAdjustmentToINSW(company, Number(id)) : c.convertStockOpnameToINSW(company, Number(id));
}
function contender(config: ReturnType<typeof pilotConfig>, maxJobs = 1, stopBeforeSend = false) {
  const p = fork('scripts/test-fixtures/insw-count-pilot.ts', [], { execArgv: ['--import', 'tsx'],
    env: { PATH: process.env.PATH, NODE_ENV: 'test', DATABASE_URL: 'postgresql://synthetic@127.0.0.1:1/unavailable',
      INSW_OUTCOME_TEST_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  messages.set(p, []); p.on('message', (m: { event: string }) => messages.get(p)!.push(m.event));
  p.stderr?.on('data', data => process.stderr.write(data)); children.push(p);
  p.send({ ...config, confirmedStockOpnameSourceIds: (config.confirmedStockOpnameSourceIds ?? []).map(String), maxJobs, stopBeforeSend });
  return p;
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
  await db.adjustment_items.deleteMany(); await db.adjustments.deleteMany();
  await db.wms_stock_opname_items.deleteMany(); await db.wms_stock_opnames.deleteMany();
  await db.material_usage_items.deleteMany(); await db.material_usages.deleteMany();
  await db.production_output_items.deleteMany(); await db.production_outputs.deleteMany();
  await db.outgoing_good_items.deleteMany(); await db.outgoing_goods.deleteMany();
  await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany(); await db.companies.deleteMany({ where: { code: 1399 } }); await policy(0);
});
test.afterEach(async () => { for (const p of children) await reap(p); children = []; });
test.afterAll(async () => { server?.closeAllConnections(); if (server?.listening) await new Promise<void>(r => server.close(() => r())); await db?.$disconnect(); });


test('only two dependency routes differ from baseline; default DIRECT still owns original singleton', async () => {
  const original = execFileSync('git', ['show', 'HEAD:lib/services/insw-integration.service.ts'], { encoding: 'utf8' });
  const current = readFileSync('lib/services/insw-integration.service.ts', 'utf8');
  expect(current).toBe(original.replace('await prisma.wms_stock_opnames.findFirst({', 'await this.incomingDatabase.wms_stock_opnames.findFirst({')
    .replace('await prisma.adjustments.findFirst({', 'await this.incomingDatabase.adjustments.findFirst({'));
  const direct = new INSWIntegrationService('', '', true);
  expect((direct as any).incomingDatabase).toBe(prisma);
  await expect(direct.convertAdjustmentToINSW(1370, 1)).rejects.toThrow('127.0.0.1:1');
  await expect(direct.convertStockOpnameToINSW(1370, 1)).rejects.toThrow('127.0.0.1:1');
});

for (const operation of ['ADJUSTMENT', 'STOCK_OPNAME'] as const) test.describe(operation, () => {
  for (const company of [1370, 1380]) test(`${company} complete committed converter/frozen/HTTP/tracking parsed JSON and order parity`, async () => {
    const row = await fixture(operation, company); const p = await pilot(operation, [row.id]);
    const baseline = await convert(operation, company, row.id);
    const items = baseline.data[0].dokumenKegiatan[0].barangTransaksi;
    expect(items.map(i => i.jumlah)).toEqual(operation === 'ADJUSTMENT' ? [1.125, -2.125, -2.125] : [0, 4.125, 10.125, 0]);
    expect(items.map(i => i.nilai)).toEqual(operation === 'ADJUSTMENT' ? [0, 0, 0] : [12.3456, 12.3456, 0, 12.3456]);
    expect(items.every(i => i.kdSatuan === 'PCE' && i.dokumen.length === 0)).toBe(true);
    const before = operation === 'ADJUSTMENT' ? await db.adjustment_items.findMany() : await db.wms_stock_opname_items.findMany();
    queries = []; const captured = await p.capture(company, row.id); const captureQueries = queries.length;
    const frozen = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: captured.id } });
    expect(frozen.frozen_payload).toEqual(baseline); expect(JSON.parse(frozen.identity_key)[3]).toBe('SOURCE_HEADER');
    await p.run({ maxJobs: 1, signal: new AbortController().signal });
    expect(arrivals.map(a => a.body)).toEqual([baseline]);
    const log = await db.insw_tracking_log.findFirstOrThrow();
    expect(log).toMatchObject({ transaction_type: operation === 'ADJUSTMENT' ? 'adjustment' : 'stock_opname',
      transaction_id: Number(row.id), company_code: company, wms_id: row.wms_id,
      insw_activity_code: operation === 'ADJUSTMENT' ? '33' : '32', insw_status: 'SUCCESS', insw_request_payload: baseline });
    expect((await p.capture(company, row.id)).created).toBe(false);
    expect(await db.insw_queue_cycle.count()).toBe(1);
    expect(operation === 'ADJUSTMENT' ? await db.adjustment_items.findMany() : await db.wms_stock_opname_items.findMany()).toEqual(before);
    expect(captureQueries).toBeLessThan(30);
    console.log('PHASE2C parity/performance', JSON.stringify({ operation, company, captureQueries, transactionMs }));
  });

  test('concurrent capture dedupes; two same-company business documents stay separate', async () => {
    const a = await fixture(operation, 1370, 'FIRST'); const b = await fixture(operation, 1370, 'SECOND');
    const p = await pilot(operation, [a.id, b.id]);
    const results = await Promise.all([p.capture(1370, a.id), p.capture(1370, a.id)]);
    expect(results[0].id).toBe(results[1].id); expect(results.filter(r => r.created)).toHaveLength(1);
    await p.capture(1370, b.id); expect(arrivals).toHaveLength(0);
    await p.run({ maxJobs: 2, signal: new AbortController().signal });
    expect(arrivals.map(a => a.body)).toEqual([await convert(operation, 1370, a.id), await convert(operation, 1370, b.id)]);
    expect(await db.insw_queue_cycle.count()).toBe(2);
  });

  test('BZ, unapproved and actually-BZ approved code cannot capture', async () => {
    await db.companies.create({ data: { code: 1399, name: 'Unapproved SEZ', company_type: 'SEZ' } });
    try {
      const bz = await fixture(operation, 1310); const unapproved = await fixture(operation, 1399);
      const forged = await fixture(operation, 1380);
      const p = await pilot(operation, [bz.id, unapproved.id, forged.id]);
      await expect(p.capture(1310, bz.id)).rejects.toThrow('SEZ_COMPANY_REQUIRED');
      await expect(p.capture(1399, unapproved.id)).rejects.toThrow('SEZ_COMPANY_REQUIRED');
      await db.companies.update({ where: { code: 1380 }, data: { company_type: 'BZ' } });
      await expect(p.capture(1380, forged.id)).rejects.toThrow('SOURCE_REQUIRED');
      expect(await db.insw_queue_cycle.count()).toBe(0); expect(await db.insw_queue_attempt.count()).toBe(0);
      expect(await db.insw_tracking_log.count()).toBe(0); expect(arrivals).toHaveLength(0);
    } finally { await db.companies.update({ where: { code: 1380 }, data: { company_type: 'SEZ' } }); }
  });

  for (const tamper of ['company', 'bz-code', 'unapproved-code', 'date', 'identity', 'activity', 'batch', 'document-date', 'entity', 'source', 'status'] as const) {
    test(`forged ${tamper} READY stays unchanged before claim and independent finalizer; valid behind advances`, async () => {
      const bad = await fixture(operation, 1370, 'BAD'); const good = await fixture(operation, 1380, 'GOOD');
      const p = await pilot(operation, [bad.id, good.id]);
      const source = await readCountSource(db, operation, 1370, bad.id);
      const payload: any = await convert(operation, 1370, bad.id);
      if (tamper === 'activity') payload.data[0].kdKegiatan = '30';
      if (tamper === 'batch') payload.data[0].dokumenKegiatan.push(structuredClone(payload.data[0].dokumenKegiatan[0]));
      if (tamper === 'document-date') payload.data[0].dokumenKegiatan[0].tanggalKegiatan = '23-10-2026';
      if (tamper === 'entity') payload.data[0].dokumenKegiatan[0].namaEntitas = '1380';
      const capture = await enqueueExisting(db, { identity: { kind: 'SOURCE_HEADER', operation,
        companyCode: tamper === 'bz-code' ? 1310 : tamper === 'unapproved-code' ? 1399 : 1370,
        sourceId: tamper === 'identity' ? 2147483647 : source.id, revision: source.revision,
        businessDate: tamper === 'date' ? '2026-10-23' : source.businessDate },
        payload, wmsReference: source.reference, requestedBy: 'forged-fixture', intent: 'SOURCE_COMMIT' });
      if (tamper === 'company') await db.companies.update({ where: { code: 1370 }, data: { company_type: 'BZ' } });
      if (tamper === 'source') {
        if (operation === 'ADJUSTMENT') await db.adjustments.update({ where: { id: Number(bad.id) }, data: { company_code: 1380 } });
        else await db.wms_stock_opnames.update({ where: { id: bad.id }, data: { company_code: 1380 } });
      }
      if (tamper === 'status') {
        if (operation === 'ADJUSTMENT') await db.adjustments.update({ where: { id: Number(bad.id) }, data: { deleted_at: new Date() } });
        else await db.wms_stock_opnames.update({ where: { id: bad.id }, data: { status: 'Active' } });
      }
      const invalid = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: capture.id } });
      try {
        const token = await acquireOperationalOwnership(db); const gate = await db.insw_dispatch_gate.findFirstOrThrow();
        expect((await admitNext(db, token)).job).toBeNull();
        await expect(prepareIsolatedCountFinalizer(db, token, { ...invalid,
          attemptId: '00000000-0000-0000-0000-000000000000', admissionPolicyVersion: 1 }, { endpointUrl: endpoint })).rejects.toThrow();
        expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate);
        expect(await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: capture.id } })).toEqual(invalid);
        expect(await db.insw_queue_attempt.count()).toBe(0); expect(await db.insw_tracking_log.count()).toBe(0);
        expect(await db.insw_worker_recovery.count({ where: { old_owner_token: token } })).toBe(0); expect(arrivals).toHaveLength(0);
        // Rotate fixture ownership only: same live test process; no recovery of live owner.
        await db.$executeRaw`UPDATE insw_dispatch_gate SET owner_token = NULL, lease_until = NULL, process_identity = NULL WHERE id = 1`;
        await p.capture(1380, good.id); await p.run({ maxJobs: 1, signal: new AbortController().signal });
        expect(arrivals.map(a => a.body)).toEqual([await convert(operation, 1380, good.id)]);
        expect(await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: capture.id } })).toEqual(invalid);
      } finally { await db.companies.update({ where: { code: 1370 }, data: { company_type: 'SEZ' } }); }
    });
  }

  test('missing source, unmapped UOM and unauthorized source fail without queue writes', async () => {
    const row = await fixture(operation, 1370); const p = await pilot(operation, [row.id, BigInt(2147483647)]);
    await expect(p.capture(1370, BigInt(2147483647))).rejects.toThrow('SOURCE_REQUIRED');
    await expect(p.capture(1380, row.id)).rejects.toThrow('SOURCE_REQUIRED');
    const unapproved = await pilot(operation, []); await expect(unapproved.capture(1370, row.id)).rejects.toThrow('AUTHORIZATION_REQUIRED');
    if (operation === 'ADJUSTMENT') await db.adjustment_items.updateMany({ data: { uom: 'UNMAPPED' } });
    else await db.wms_stock_opname_items.updateMany({ data: { uom: 'UNMAPPED' } });
    await expect(p.capture(1370, row.id)).rejects.toThrow('UOM mapping');
    expect(await db.insw_queue_cycle.count()).toBe(0); expect(arrivals).toHaveLength(0);
  });

  test('retry goes to tail with immutable original payload after source mutation', async () => {
    const a = await fixture(operation, 1370); const b = await fixture(operation, 1380);
    await policy(1); const p = await pilot(operation, [a.id, b.id]);
    const baseline = await convert(operation, 1370, a.id); const other = await convert(operation, 1380, b.id);
    await p.capture(1370, a.id); await p.capture(1380, b.id);
    if (operation === 'ADJUSTMENT') await db.adjustment_items.updateMany({ data: { qty: 99 } });
    else await db.wms_stock_opname_items.updateMany({ data: { actual_qty_count: 99 } });
    handler = res => { res.statusCode = arrivals.length === 1 ? 503 : 200; res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ status: arrivals.length !== 1 })); };
    await p.run({ maxJobs: 3, signal: new AbortController().signal });
    expect(arrivals.map(a => a.body)).toEqual([baseline, other, baseline]);
    expect((await db.insw_tracking_log.findMany({ orderBy: { id: 'asc' } })).map(l => l.insw_request_payload)).toEqual([baseline, other, baseline]);
  });

  for (const kind of ['unknown', 'transient-zero', 'permanent'] as const) test(`${kind} stops without automatic resend`, async () => {
    const row = await fixture(operation, 1370); const p = await pilot(operation, [row.id]); await p.capture(1370, row.id);
    handler = res => { res.statusCode = kind === 'permanent' ? 401 : 503; res.setHeader('content-type', 'application/json');
      res.end(kind === 'unknown' ? '{"message":"ambiguous"}' : '{"status":false}'); };
    await p.run({ maxJobs: 1, signal: new AbortController().signal });
    expect(arrivals).toHaveLength(1); expect((await db.insw_queue_cycle.findFirst())?.status).toBe(kind === 'unknown' ? 'HELD' : 'FAILED');
    expect((await p.capture(1370, row.id)).created).toBe(false);
  });

  test('known success repairs local log failure once without resending', async () => {
    const row = await fixture(operation, 1370); const p = await pilot(operation, [row.id]); await p.capture(1370, row.id);
    await db.$executeRawUnsafe('CREATE SEQUENCE phase2c_failure_count');
    await db.$executeRawUnsafe(`CREATE FUNCTION phase2c_once() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF nextval('phase2c_failure_count') = 1 THEN RAISE EXCEPTION 'local once'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe('CREATE TRIGGER phase2c_once BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION phase2c_once()');
    try { await p.run({ maxJobs: 1, signal: new AbortController().signal });
      expect(arrivals).toHaveLength(1); expect(await db.insw_tracking_log.count()).toBe(1);
      expect((await db.insw_queue_cycle.findFirst())?.status).toBe('SUCCEEDED');
    } finally { await db.$executeRawUnsafe('DROP TRIGGER phase2c_once ON insw_tracking_log');
      await db.$executeRawUnsafe('DROP FUNCTION phase2c_once()'); await db.$executeRawUnsafe('DROP SEQUENCE phase2c_failure_count'); }
  });

  test('crash/reap/recover/restart after claim holds without HTTP', async () => {
    const row = await fixture(operation, 1370); const p = await pilot(operation, [row.id]); await p.capture(1370, row.id);
    const config = pilotConfig(operation === 'ADJUSTMENT' ? [row.id] : [], operation === 'STOCK_OPNAME' ? [row.id] : []);
    const child = contender(config, 1, true); await event(child, 'admitted'); await reap(child); await recover();
    expect(arrivals).toHaveLength(0); expect((await db.insw_queue_cycle.findFirst())?.status).toBe('HELD');
    const restarted = contender(config); await event(restarted, 'owned');
    await new Promise(r => setTimeout(r, 3800)); expect(arrivals).toHaveLength(0); await reap(restarted);
  });
});

test('Active, Cancelled, null confirmation and changed confirmation timestamp cannot enter STO stream', async () => {
  const row = await fixture('STOCK_OPNAME', 1370); const p = await pilot('STOCK_OPNAME', [row.id]);
  for (const status of ['Active', 'Cancelled'] as const) {
    await db.wms_stock_opnames.update({ where: { id: row.id }, data: { status } });
    await expect(p.capture(1370, row.id)).rejects.toThrow('CONFIRMED_SOURCE_REQUIRED');
  }
  await db.wms_stock_opnames.update({ where: { id: row.id }, data: { status: 'Confirmed', confirmed_at: null } });
  await expect(p.capture(1370, row.id)).rejects.toThrow('CONFIRMED_SOURCE_REQUIRED');
  expect(await db.insw_queue_cycle.count()).toBe(0);
  await db.wms_stock_opnames.update({ where: { id: row.id }, data: { confirmed_at: new Date('2026-10-24T12:34:56.789Z') } });
  const captured = await p.capture(1370, row.id);
  await db.wms_stock_opnames.update({ where: { id: row.id }, data: { confirmed_at: new Date('2026-10-24T13:00:00Z') } });
  const token = await acquireOperationalOwnership(db); const gate = await db.insw_dispatch_gate.findFirstOrThrow();
  expect((await admitNext(db, token)).job).toBeNull(); expect(await db.insw_dispatch_gate.findFirstOrThrow()).toEqual(gate);
  const invalid = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: captured.id } });
  await expect(prepareIsolatedCountFinalizer(db, token, { ...invalid, attemptId: '00000000-0000-0000-0000-000000000000',
    admissionPolicyVersion: 1 }, { endpointUrl: endpoint })).rejects.toThrow('COUNT_SOURCE_IDENTITY_UNCONFIRMED');
});

test('exact BigInt rejection at legacy Int and JS safe-integer boundaries preserves sources', async () => {
  for (const id of [BigInt(2147483648), BigInt(Number.MAX_SAFE_INTEGER), BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1), BigInt(Number.MAX_SAFE_INTEGER) + BigInt(2)]) {
    const row = await fixture('STOCK_OPNAME', 1370, `BIG-${id}`, id); const p = await pilot('STOCK_OPNAME', [id]);
    await expect(p.capture(1370, id)).rejects.toThrow('SOURCE_ID_EXCEEDS_LEGACY_TRACKING_INT');
    expect((await db.wms_stock_opnames.findUniqueOrThrow({ where: { id } })).id).toBe(id);
    expect(() => countSourceId(String(id))).toThrow('SOURCE_ID_EXCEEDS_LEGACY_TRACKING_INT');
    expect(row.id).toBe(id);
  }
  expect(() => countSourceId(Number.MAX_SAFE_INTEGER + 1)).toThrow('INVALID_EXACT_SOURCE_ID');
  expect(countSourceId(BigInt(2147483647))).toBe(2147483647);
  expect(await db.insw_queue_cycle.count()).toBe(0); expect(await db.insw_tracking_log.count()).toBe(0);
  const row = await fixture('STOCK_OPNAME', 1380, 'MAX-INT', BigInt(2147483647)); const p = await pilot('STOCK_OPNAME', [row.id]);
  await p.capture(1380, row.id); await p.run({ maxJobs: 1, signal: new AbortController().signal });
  expect((await db.insw_tracking_log.findFirst())?.transaction_id).toBe(2147483647);
});
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
async function incomingFixture(company: number, ref: string) {
  const row = await db.incoming_goods.create({ data: { company_code: company, owner: company, wms_id: ref,
    incoming_date: new Date('2026-10-24'), ppkek_number: 'N', customs_document_type: null,
    is_non_facility: true, incoming_evidence_number: 'N', shipper_name: 'Synthetic Supplier', timestamp: new Date() } });
  await db.incoming_good_items.create({ data: { incoming_good_id: row.id, incoming_good_company: company,
    incoming_good_date: row.incoming_date, item_type: 'ROH', item_code: 'IN', item_name: 'Incoming item',
    uom: 'PCS', qty: 2, currency: 'USD', amount: 3 } });
  return row;
}


test('six domains both companies competing processes share one HTTP stream with >=3600ms starts', async () => {
  const a = await incomingFixture(1370, 'SIX-IN'); const b = await productionFixture('MATERIAL_USAGE', 1380, true, 'SIX-MU');
  const c = await db.outgoing_goods.create({ data: { company_code: 1380, owner: 1380, wms_id: 'SIX-OUT',
    outgoing_date: new Date('2026-10-24'), ppkek_number: 'N', customs_document_type: null, is_non_facility: true,
    outgoing_evidence_number: 'N', recipient_name: 'Fixture Recipient', invoice_number: 'FIXTURE-INV',
    invoice_date: new Date('2026-10-23'), timestamp: new Date() } });
  await db.outgoing_good_items.create({ data: { outgoing_good_id: c.id, outgoing_good_company: 1380,
    outgoing_good_date: c.outgoing_date, item_type: 'ROH', item_code: 'OUT', item_name: 'Outgoing item', uom: 'PCS',
    qty: 1.125, amount: 12.3456, currency: 'USD' } });
  const d = await productionFixture('PRODUCTION_OUTPUT', 1370, true, 'SIX-PO');
  const e = await fixture('ADJUSTMENT', 1370, 'SIX-ADJ'); const f = await fixture('STOCK_OPNAME', 1380, 'SIX-STO');
  const config = { ...pilotConfig([e.id], [f.id]), sourceIds: [a.id], outgoingSourceIds: [c.id],
    materialUsageSourceIds: [b.id], productionOutputSourceIds: [d.id] };
  await policy(0, 1); const p = await isolatedIncomingPilot(db, config);
  await p.capture(1370, a.id); await p.captureMaterialUsage(1380, b.id); await p.captureOutgoing(1380, c.id);
  await p.captureProductionOutput(1370, d.id); await p.captureAdjustment(1370, Number(e.id)); await p.captureStockOpname(1380, f.id);
  const converter = new INSWIntegrationService('', '', true, db);
  const baselines = [await converter.convertPemasukanToINSW(1370, [a.id]), await converter.convertMaterialUsageToINSW(1380, [b.id]),
    await converter.convertPengeluaranToINSWByIds(1380, [c.id]), await converter.convertProductionOutputToINSW(1370, [d.id]),
    await convert('ADJUSTMENT', 1370, e.id), await convert('STOCK_OPNAME', 1380, f.id)];
  handler = res => setTimeout(() => res.end('{"status":true}'), arrivals.length === 2 ? 3900 : 20);
  const owner = contender(config, 6); await event(owner, 'owned'); const competitor = contender(config); await event(competitor, 'blocked');
  await event(owner, 'drained'); expect(arrivals.map(a => a.body)).toEqual(baselines); expect(maxActive).toBe(1);
  const gaps = arrivals.slice(1).map((a, i) => a.at - arrivals[i].at);
  console.log('PHASE2C six-domain start gaps ms', gaps, 'maximum concurrent', maxActive);
  for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(3600);
  expect(await db.insw_queue_attempt.count()).toBe(6);
  expect((await db.insw_tracking_log.findMany({ orderBy: { id: 'asc' } })).map(log => log.insw_request_payload)).toEqual(baselines);
});

for (const operation of ['ADJUSTMENT', 'STOCK_OPNAME'] as const) {
  test(`${operation} opaque preparation rejects combined envelopes; persisted READY survives process boundary`, async () => {
    const row = await fixture(operation, 1370); const source = await readCountSource(db, operation, 1370, row.id);
    const payload = await convert(operation, 1370, row.id);
    payload.data[0].dokumenKegiatan.push(structuredClone(payload.data[0].dokumenKegiatan[0]));
    expect(() => prepareCountHandoff({ companyCode: 1370, operation, sourceId: source.id,
      wmsReference: source.reference, businessDate: source.businessDate, revision: source.revision, payload,
      requestedBy: 'fixture', authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT' }))
      .toThrow('Expected one complete source header transmission');
    expect(await db.insw_queue_cycle.count()).toBe(0);
    const p = await pilot(operation, [row.id]); const capture = await p.capture(1370, row.id);
    const frozen = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: capture.id } });
    await expect(db.insw_queue_cycle.update({ where: { id: capture.id }, data: { business_date: '2026-10-23' } }))
      .rejects.toThrow('immutable');
    const config = pilotConfig(operation === 'ADJUSTMENT' ? [row.id] : [], operation === 'STOCK_OPNAME' ? [row.id] : []);
    const child = contender(config); await event(child, 'drained');
    expect(arrivals.map(a => a.body)).toEqual([frozen.frozen_payload]);
  });

  test(`${operation} in-flight process death becomes durable HOLD and restart does not resend`, async () => {
    const row = await fixture(operation, 1370); const p = await pilot(operation, [row.id]); await p.capture(1370, row.id);
    const config = pilotConfig(operation === 'ADJUSTMENT' ? [row.id] : [], operation === 'STOCK_OPNAME' ? [row.id] : []);
    let response: ServerResponse | undefined; handler = res => { response = res; };
    const child = contender(config); await expect.poll(() => arrivals.length).toBe(1);
    await reap(child); response?.destroy(); await recover();
    expect((await db.insw_queue_cycle.findFirst())).toMatchObject({ status: 'HELD', hold_reason: 'DELIVERY_UNKNOWN' });
    const restarted = contender(config); await event(restarted, 'owned');
    await new Promise(r => setTimeout(r, 3800)); expect(arrivals).toHaveLength(1); await reap(restarted);
  });
}
