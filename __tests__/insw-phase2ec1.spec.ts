import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { IncomingGoodsService } from '../lib/services/incoming-goods.service';
import type { IncomingGoodsCreateResult } from '../lib/repositories/incoming-goods.repository';
import { logger } from '../lib/utils/logger';
import { captureCompletedWmsSource } from '../lib/insw-worker/completed-source-capture';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';

const url = process.env.INSW_OUTCOME_TEST_DATABASE_URL;
test.skip(!url, 'NEW empty disposable loopback *_phase_c2b_test required');
let db: PrismaClient;
let httpCalls = 0;
let queries: string[] = [];
const originalFetch = globalThis.fetch;

test.beforeAll(async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== '127.0.0.1' || !/^\/[a-z0-9_]+_phase_c2b_test$/.test(parsed.pathname)
    || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.search || parsed.hash) throw new Error('UNSAFE_TEST_DATABASE');
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', event => queries.push(event.query));
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
  await db.wms_transmission_logs.deleteMany(); await db.activity_logs.deleteMany();
  await db.$executeRaw`UPDATE insw_dispatch_gate SET busy_attempt_id = NULL, owner_token = NULL, lease_until = NULL,
    last_started_at = NULL, recovery_barrier_at = NULL, prior_interval_ms = NULL, process_identity = NULL WHERE id = 1`;
  await db.insw_tracking_log.deleteMany(); await db.insw_queue_attempt.deleteMany(); await db.insw_queue_cycle.deleteMany();
  await db.insw_worker_recovery.deleteMany();
  await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany();
  await db.companies.updateMany({ where: { code: { in: [1370, 1380] } }, data: { company_type: 'SEZ' } });
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

// Explicit disposable-test access to the private completion method. Real handler
// and repository continuation coverage follows below.
const seam = new IncomingGoodsService() as unknown as {
  captureCompletedIncoming(db: PrismaClient, completion: Promise<IncomingGoodsCreateResult>, actor: string): Promise<IncomingGoodsCreateResult>;
};
if (false) {
  // @ts-expect-error There is no public routing selector or capture API on this service.
  new IncomingGoodsService().captureCompletedIncoming(db, Promise.resolve(), 'test');
}
function completed(row: Awaited<ReturnType<typeof incomingFixture>>): IncomingGoodsCreateResult {
  return { id: row.id, company_code: row.company_code, incoming_date: row.incoming_date, wms_id: row.wms_id, items_count: 2 };
}
function capture(row: Awaited<ReturnType<typeof incomingFixture>>, actor = 'disposable-completion') {
  return seam.captureCompletedIncoming(db, Promise.resolve(completed(row)), actor);
}
async function counts() {
  return Promise.all([db.insw_queue_cycle.count(), db.insw_queue_attempt.count(), db.insw_tracking_log.count(), db.insw_worker_recovery.count()]);
}
for (const company of [1370, 1380]) for (const nonFacility of [false, true]) {
  test(`Incoming complete canonical JSON parity ${company}, N/N/N=${nonFacility}`, async () => {
    const row = await incomingFixture(company, nonFacility);
    const baseline = JSON.parse(JSON.stringify(await new INSWIntegrationService('', '', true, db).convertPemasukanToINSW(company, [row.id])));
    expect(await capture(row)).toEqual(completed(row));
    const job = await db.insw_queue_cycle.findFirstOrThrow();
    expect(job.frozen_payload).toEqual(baseline); // Entire parsed JSON; arrays retain their order.
    const items = baseline.data[0].dokumenKegiatan[0].barangTransaksi;
    expect(items).toHaveLength(2);
    if (nonFacility) for (const item of items) expect(item.dokumen).toEqual([]);
    expect(await counts()).toEqual([1, 0, 0, 0]);
    expect(httpCalls).toBe(0);
  });
}

test('visible committed header and early acceptance do not capture before business completion', async () => {
  const row = await incomingFixture(1370);
  let resolve!: (value: IncomingGoodsCreateResult) => void;
  const completion = new Promise<IncomingGoodsCreateResult>(r => { resolve = r; });
  const pending = seam.captureCompletedIncoming(db, completion, 'disposable-completion');
  // A real DB roundtrip while the completion promise is deliberately unresolved.
  expect(await db.incoming_good_items.count({ where: { incoming_good_id: row.id } })).toBe(2);
  expect(await counts()).toEqual([0, 0, 0, 0]);
  resolve(completed(row));
  expect(await pending).toEqual(completed(row));
  expect(await counts()).toEqual([1, 0, 0, 0]);
});

test('missing/rejected completion creates no lifecycle writes', async () => {
  await expect(seam.captureCompletedIncoming(db, undefined as never, 'test')).rejects.toThrow('BUSINESS_COMPLETION_CONTEXT_REQUIRED');
  await expect(seam.captureCompletedIncoming(db, Promise.reject(new Error('business failed')), 'test')).rejects.toThrow('business failed');
  expect(await counts()).toEqual([0, 0, 0, 0]);
});

test('capture failure is logged and preserves resolved business result and committed details', async () => {
  const row = await incomingFixture(1370);
  await db.insw_uom_mapping.deleteMany(); // Real converter failure, not a capture mock.
  const errors: unknown[][] = [];
  const original = logger.error;
  logger.error = (...args: Parameters<typeof logger.error>) => { errors.push(args); };
  try {
    expect(await capture(row)).toEqual(completed(row));
    expect(errors.some(args => args[0] === 'Completed WMS Incoming capture failed; no DIRECT fallback')).toBe(true);
    expect(await db.incoming_good_items.count({ where: { incoming_good_id: row.id } })).toBe(2);
    expect(await counts()).toEqual([0, 0, 0, 0]);
    expect(httpCalls).toBe(0);
  } finally {
    logger.error = original;
    await db.insw_uom_mapping.create({ data: { wms_uom: 'PCS', insw_uom: 'PCE' } });
  }
});

for (const company of [1310, 1399, 1370]) {
  test(`excluded code or actual BZ company ${company} creates no lifecycle`, async () => {
    const row = await incomingFixture(company);
    if (company === 1370) await db.companies.update({ where: { code: company }, data: { company_type: 'BZ' } });
    expect(await capture(row)).toEqual(completed(row));
    expect(await counts()).toEqual([0, 0, 0, 0]);
    expect(httpCalls).toBe(0);
  });
}

test('two originals sharing evidence/date capture separately, including repeated/concurrent calls', async () => {
  const a = await incomingFixture(1370, false, 'ORIGINAL-A');
  const b = await incomingFixture(1370, false, 'ORIGINAL-B');
  await Promise.all([capture(a), capture(b), capture(a), capture(b)]);
  const jobs = await db.insw_queue_cycle.findMany({ orderBy: { wms_reference: 'asc' } });
  expect(jobs).toHaveLength(2);
  const converter = new INSWIntegrationService('', '', true, db);
  for (const [index, row] of [a, b].entries()) {
    expect(jobs[index].frozen_payload).toEqual(JSON.parse(JSON.stringify(await converter.convertPemasukanToINSW(1370, [row.id]))));
    expect(jobs[index].cycle).toBe(1);
  }
  expect(await counts()).toEqual([2, 0, 0, 0]);
  expect(httpCalls).toBe(0);
});

for (const status of ['HELD', 'REMOTE_SUCCEEDED', 'SUCCEEDED', 'FAILED'] as const) {
  test(`any-cycle dedupe preserves ${status}; never creates a successor or remote success`, async () => {
    const row = await incomingFixture(1370);
    await capture(row);
    const job = await db.insw_queue_cycle.findFirstOrThrow();
    await db.insw_queue_cycle.update({ where: { id: job.id }, data: { status,
      hold_reason: status === 'HELD' ? 'DELIVERY_UNKNOWN' : null,
      completed_at: status === 'SUCCEEDED' || status === 'FAILED' ? new Date() : null,
      owner_token: status === 'REMOTE_SUCCEEDED' ? '00000000-0000-4000-8000-000000000001' : null,
      lease_until: status === 'REMOTE_SUCCEEDED' ? new Date(Date.now() + 60000) : null,
      delivery_state: status === 'HELD' ? 'POSSIBLY_STARTED' : status === 'FAILED' ? 'KNOWN_FAILURE' : 'KNOWN_SUCCESS' } });
    const before = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: job.id } });
    await Promise.all([capture(row), captureCompletedWmsSource(db, {
      operation: 'INCOMING', sourceId: row.id, companyCode: row.company_code,
      businessDate: row.incoming_date.toISOString().slice(0, 10), requestedBy: 'disposable-repeat',
      revision: 'ACCEPTED_WMS_ID', completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED',
    })]);
    expect(await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: job.id } })).toEqual(before);
    expect(await counts()).toEqual([1, 0, 0, 0]);
    expect(httpCalls).toBe(0);
  });
}

// Completion continuation coverage: singleton bindings below are TEST-ONLY.
// Both clients point exclusively at the disposable database validated above.
import { submitIncomingOriginals, resendIncomingLog, incomingLogResendEligibility } from '../lib/insw-queue/incoming-coordination';
import { acquireOperationalOwnership, admitNext } from '../lib/insw-worker/operational.repository';
import { prepareIsolatedIncomingFinalizer } from '../lib/insw-worker/incoming-finalizer';
import { executeFrozenRequest } from '../lib/insw-worker/transport';
import { readPolicy, updatePolicy } from '../lib/insw-queue/policy.repository';
import { IncomingGoodsRepository } from '../lib/repositories/incoming-goods.repository';
import type { SnapshotItem } from '../lib/repositories/snapshot.repository';
import { continueWmsRetryToInsw } from '../lib/services/wms-reprocess.service';

async function acceptance(row: Awaited<ReturnType<typeof incomingFixture>>) {
  const a = await db.activity_logs.create({ data: { action: 'WMS_PROCESS_INCOMING_GOODS', description: 'Synthetic accepted fixture' } });
  await db.wms_transmission_logs.create({ data: { activity_log_id: a.id, action: a.action, company_code: row.company_code,
    wms_id: row.wms_id, transmission_status: 'SUCCESS' } });
}
async function budget(maximum: number) {
  const p = await readPolicy(db);
  await updatePolicy(db, p.version, { max_auto_retry: maximum, min_processing_interval_ms: 3600 }, 'fixture', 'Disposable coordination test');
}
async function finish(job: NonNullable<Awaited<ReturnType<typeof admitNext>>['job']>, token: string, success: boolean) {
  const finalizer = await prepareIsolatedIncomingFinalizer(db, token, job, { endpointUrl: 'http://127.0.0.1:12345/fixture' });
  const result = await executeFrozenRequest({ payload: job.frozen_payload, sha256: job.payload_sha256, timeoutMs: 100, captureResponse: true,
    request: async () => new Response(JSON.stringify(success ? { status: true, message: 'Success', data: null }
      : { status: false, code: '500', message: 'temporary error', data: null }), { status: success ? 200 : 503, headers: { 'content-type': 'application/json' } }) });
  await finalizer(result, Date.now());
}
async function failedLog(row: Awaited<ReturnType<typeof incomingFixture>>) {
  await capture(row);
  const token = await acquireOperationalOwnership(db);
  const { job } = await admitNext(db, token, 3600);
  expect(job).not.toBeNull();
  await finish(job!, token, false);
  return { log: await db.insw_tracking_log.findFirstOrThrow({ where: { transaction_id: row.id } }), token, job: job! };
}

for (const company of [1370, 1380]) for (const marker of [false, true]) {
  test(`manual bulk selections preserve separate complete original JSON ${company} N=${marker}`, async () => {
    await budget(0);
    const a = await incomingFixture(company, marker, 'BULK-A'); const b = await incomingFixture(company, marker, 'BULK-B');
    await acceptance(a); await acceptance(b);
    queries = []; const started = performance.now();
    const response = await submitIncomingOriginals(db, company, [a.id, b.id, a.id], 'operator');
    // Prisma query events can arrive just after the awaited result. Wait for
    // the final projection event before asserting the measured query counts.
    await expect.poll(() => queries.filter(query => query.includes('SELECT DISTINCT ON (identity_key)')).length).toBe(1);
    const bulkReads = queries.filter(query => query.includes('SELECT g.id, g.wms_id, g.incoming_date FROM incoming_goods g'));
    expect(bulkReads).toHaveLength(1);
    expect(queries.filter(query => query.includes('SELECT DISTINCT ON (identity_key)'))).toHaveLength(1);
    console.log('C1 manual performance', { company, marker, originals: 2, queries: queries.length, elapsedMs: performance.now() - started });
    expect(response).toMatchObject({ status: 'accepted', total: 2, accepted_count: 2 });
    const jobs = await db.insw_queue_cycle.findMany({ orderBy: { wms_reference: 'asc' } });
    expect(jobs).toHaveLength(2);
    for (const [i, row] of [a, b].entries()) expect(jobs[i].frozen_payload).toEqual(JSON.parse(JSON.stringify(
      await new INSWIntegrationService('', '', true, db).convertPemasukanToINSW(company, [row.id]))));
    expect(httpCalls).toBe(0);
  });
}

test('arbitrary selected header, invalid IDs, actual BZ and missing originals create no lifecycle', async () => {
  const row = await incomingFixture(1370); // No authoritative WMS association yet.
  await expect(submitIncomingOriginals(db, 1370, [row.id], 'op')).rejects.toThrow('persisted WMS');
  await acceptance(row);
  await db.companies.update({ where: { code: 1370 }, data: { company_type: 'BZ' } });
  for (const ids of [[row.id], [999999], [row.id, '1'], []]) await expect(submitIncomingOriginals(db, 1370, ids, 'op')).rejects.toThrow();
  expect(await counts()).toEqual([0, 0, 0, 0]);
});

test('automatic and concurrent manual aliases use database identity across distinct Prisma clients', async () => {
  const row = await incomingFixture(1370); await acceptance(row); await budget(0);
  const other = new PrismaClient({ datasources: { db: { url } } });
  try {
    await Promise.all([capture(row), submitIncomingOriginals(db, 1370, [row.id], 'op-a'), submitIncomingOriginals(other, 1370, [row.id], 'op-b')]);
    expect(await db.insw_queue_cycle.count()).toBe(1);
    const job = await db.insw_queue_cycle.findFirstOrThrow();
    const token = await acquireOperationalOwnership(db);
    await Promise.all([admitNext(db, token, 3600), resendIncomingLog(other, 1370, BigInt(999999), 'op', 'not authorized').catch(() => null)]);
    expect(await db.insw_queue_attempt.count({ where: { queue_id: job.id } })).toBe(1);
    expect(httpCalls).toBe(0);
  } finally { await other.$disconnect(); }
});

for (const maximum of [0, 2, 10]) {
  test(`definitive failure exhausted budget ${maximum} admits one frozen authorized successor only`, async () => {
    await budget(maximum);
    const row = await incomingFixture(1370);
    await capture(row);
    // Drive the real shared claim + finalizer for every configured attempt;
    // spacing itself is covered in Phase 1. Advance only the synthetic gate clock.
    const token = await acquireOperationalOwnership(db);
    let originalPayload: unknown;
    for (let attempt = 0; attempt <= maximum; attempt++) {
      await db.$executeRaw`UPDATE insw_dispatch_gate SET last_started_at = NULL, prior_interval_ms = NULL WHERE id = 1`;
      const { job } = await admitNext(db, token, 3600); expect(job).not.toBeNull();
      originalPayload ??= job!.frozen_payload;
      expect(job!.frozen_payload).toEqual(originalPayload);
      await finish(job!, token, false);
      if (attempt < maximum) {
        const log = await db.insw_tracking_log.findFirstOrThrow({ orderBy: { id: 'desc' } });
        expect((await incomingLogResendEligibility(db, 1370, [log.id])).size).toBe(0);
        await expect(resendIncomingLog(db, 1370, log.id, 'op', 'too early')).rejects.toThrow('exhausted');
      }
    }
    const log = await db.insw_tracking_log.findFirstOrThrow({ orderBy: { id: 'desc' } });
    expect((await incomingLogResendEligibility(db, 1370, [log.id])).has(log.id.toString())).toBe(true);
    // Mutate current source after failure: explicit resend must copy the old frozen JSON, not reconvert.
    await db.incoming_good_items.updateMany({ where: { incoming_good_id: row.id }, data: { qty: 999 } });
    const other = new PrismaClient({ datasources: { db: { url } } });
    const outcomes = await Promise.allSettled([resendIncomingLog(db, 1370, log.id, 'operator-A', 'Explicit investigated failure'),
      resendIncomingLog(other, 1370, log.id, 'operator-B', 'Concurrent explicit resend')]);
    await other.$disconnect();
    expect(outcomes.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const cycles = await db.insw_queue_cycle.findMany({ orderBy: { cycle: 'asc' } });
    expect(cycles).toHaveLength(2); expect(cycles[1].intent).toBe('MANUAL_RESUBMIT');
    expect(cycles[1].frozen_payload).toEqual(originalPayload); expect(cycles[1].payload_sha256).toBe(cycles[0].payload_sha256);
    expect(cycles[1].source_log_id).toBe(log.id);
    expect((await db.insw_tracking_log.findUniqueOrThrow({ where: { id: log.id } })).insw_status).toBe('FAILED');
    expect((await incomingLogResendEligibility(db, 1370, [log.id])).size).toBe(0);
    await capture(row); expect(await db.insw_queue_cycle.count()).toBe(2); // Automatic cannot create cycle 3.
    await db.$executeRaw`UPDATE insw_dispatch_gate SET last_started_at = NULL, prior_interval_ms = NULL WHERE id = 1`;
    const [{ job: firstClaim }, competingResend] = await Promise.all([admitNext(db, token, 3600),
      resendIncomingLog(db, 1370, log.id, 'operator-C', 'Race against claim').then(() => 'accepted', () => 'refused')]);
    expect(competingResend).toBe('refused');
    // SKIP LOCKED may legitimately miss a READY row while the rejected resend
    // briefly holds its row lock. The next normal dispatcher tick must claim it.
    const job = firstClaim ?? (await admitNext(db, token, 3600)).job;
    expect(job?.id).toBe(cycles[1].id); await finish(job!, token, true);
    expect((await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: cycles[1].id } })).status).toBe('SUCCEEDED');
    expect(await db.insw_queue_attempt.count()).toBe(maximum + 2);
    expect(httpCalls).toBe(0);
  });
}

for (const state of ['READY', 'CLAIMED', 'HELD', 'REMOTE_SUCCEEDED', 'SUCCEEDED'] as const) {
  test(`resend API independently refuses ${state} despite legacy FAILED label`, async () => {
    await budget(0); const row = await incomingFixture(1370);
    const { log, job } = await failedLog(row);
    await db.insw_queue_cycle.update({ where: { id: job.id }, data: { status: state,
      completed_at: state === 'SUCCEEDED' ? new Date() : null,
      delivery_state: state === 'HELD' ? 'POSSIBLY_STARTED' : ['SUCCEEDED', 'REMOTE_SUCCEEDED'].includes(state) ? 'KNOWN_SUCCESS' : 'NOT_STARTED',
      hold_reason: state === 'HELD' ? 'DELIVERY_UNKNOWN' : null,
      owner_token: ['CLAIMED', 'REMOTE_SUCCEEDED'].includes(state) ? '00000000-0000-4000-8000-000000000001' : null,
      lease_until: ['CLAIMED', 'REMOTE_SUCCEEDED'].includes(state) ? new Date(Date.now() + 60000) : null } });
    await expect(resendIncomingLog(db, 1370, log.id, 'op', 'forbidden')).rejects.toThrow('exhausted');
    expect((await incomingLogResendEligibility(db, 1370, [log.id])).size).toBe(0);
    expect(await db.insw_queue_cycle.count()).toBe(1);
  });
}

function bindFixtureSingletons() {
  const clients = new Set<PrismaClient>([require('../lib/db/prisma').prisma, require('../lib/prisma').prisma]);
  const restore: (() => void)[] = [];
  for (const client of clients) for (const key of ['$transaction', '$queryRaw', '$queryRawUnsafe', '$executeRaw',
    'incoming_goods', 'incoming_good_items', 'companies', 'item_types', 'stock_daily_snapshot', 'insw_queue_cycle',
    'insw_queue_attempt', 'insw_tracking_log', 'insw_uom_mapping', 'insw_transmission_policy', 'wms_transmission_logs', 'activity_logs']) {
    const descriptor = Object.getOwnPropertyDescriptor(client, key);
    const value = Reflect.get(db, key);
    Object.defineProperty(client, key, { configurable: true, writable: true, value: typeof value === 'function' ? value.bind(db) : value });
    restore.push(() => { if (descriptor) Object.defineProperty(client, key, descriptor); else Reflect.deleteProperty(client, key); });
  }
  return () => restore.reverse().forEach(fn => fn());
}

for (const failCapture of [false, true]) {
  test(`real service continuation waits for full repository completion, capture failure=${failCapture}`, async () => {
    await budget(0);
    await db.item_types.upsert({ where: { item_type_code: 'ROH' }, update: {}, create: { item_type_code: 'ROH', name_en: 'Synthetic raw', category: 'raw' } });
    const restore = bindFixtureSingletons();
    let resume!: () => void; let reached!: () => void; let settled!: () => void;
    const arrived = new Promise<void>(r => { reached = r; }); const barrier = new Promise<void>(r => { resume = r; });
    const completion = new Promise<void>(r => { settled = r; });
    const sideEffects: string[] = [];
    class Repo extends IncomingGoodsRepository {
      constructor() {
        super();
        // Exercise the actual repository's existing nonblocking error tolerance.
        this.snapshotRepo.upsertItemsSnapshot = async () => { throw new Error('Synthetic snapshot failure'); };
        this.snapshotRepo.recalculateItemSnapshotsFromDate = async () => { throw new Error('Synthetic cascade failure'); };
        this.snapshotRepo.syncItemDescriptionsFromPayload = async () => { throw new Error('Synthetic description failure'); };
      }
      protected async updateItemSnapshots(c: number, items: SnapshotItem[], date: Date, wms: string, type: string) {
        sideEffects.push('snapshot'); reached(); await barrier;
        await super.updateItemSnapshots(c, items, date, wms, type);
      }
      protected async cascadeRecalculateSnapshots(c: number, items: SnapshotItem[], date: Date) {
        sideEffects.push('cascade'); await super.cascadeRecalculateSnapshots(c, items, date);
      }
      protected async syncItemDescriptionsFromPayload(c: number, items: SnapshotItem[], wms: string, type: string) {
        sideEffects.push('description'); await super.syncItemDescriptionsFromPayload(c, items, wms, type);
      }
    }
    const svc = new IncomingGoodsService();
    (svc as unknown as { repository: IncomingGoodsRepository }).repository = new Repo();
    const hidden = svc as unknown as { captureCompletedIncoming: typeof seam.captureCompletedIncoming };
    const captureMethod = hidden.captureCompletedIncoming.bind(svc);
    hidden.captureCompletedIncoming = async (...args) => { try { return await captureMethod(...args); } finally { settled(); } };
    const payload = { wms_id: 'REAL-COMPLETION', company_code: 1370, owner: 1370, customs_document_type: 'BC23',
      ppkek_number: 'DOC', customs_registration_date: '2026-10-23', incoming_evidence_number: 'EVIDENCE',
      incoming_date: '2026-10-24', invoice_number: null, invoice_date: null, shipper_name: 'Synthetic',
      timestamp: '2026-10-24T01:02:03.123Z', items: [1, 2].map(n => ({ item_type: 'ROH', item_code: `REAL${n}`,
        item_name: `Item ${n}`, hs_code: null, uom: 'PCS', qty: n, currency: 'USD', amount: 10 })) };
    try {
      const response = await svc.processIncomingGoods(payload);
      expect(response.success, JSON.stringify(response)).toBe(true);
      await arrived;
      expect(await db.incoming_good_items.count()).toBe(2);
      expect(await db.insw_queue_cycle.count()).toBe(0); // Header/items visible, business promise still unfinished.
      if (failCapture) await db.insw_uom_mapping.deleteMany();
      resume(); await completion;
      expect(sideEffects).toEqual(['snapshot', 'cascade', 'description']);
      expect(await db.insw_queue_cycle.count()).toBe(failCapture ? 0 : 1);
      expect(httpCalls).toBe(0);
      const row = await db.incoming_goods.findFirstOrThrow();
      const retry = await continueWmsRetryToInsw('incoming_goods', { id: row.id, companyCode: 1370, wmsId: row.wms_id }).catch(() => null);
      if (!failCapture) { expect(retry?.status).toBe('skipped'); expect(await db.insw_queue_cycle.count()).toBe(1); }
      expect(await db.incoming_good_items.count()).toBe(2);
    } finally {
      resume(); await completion; restore();
      if (failCapture) await db.insw_uom_mapping.create({ data: { wms_uom: 'PCS', insw_uom: 'PCE' } });
    }
  });
}

test('legacy remote success requires repair and cannot create a fresh queue delivery', async () => {
  const row = await incomingFixture(1370); await acceptance(row);
  await db.insw_tracking_log.create({ data: { transaction_type: 'incoming', transaction_id: row.id,
    company_code: 1370, wms_id: row.wms_id, insw_status: 'SUCCESS' } });
  await capture(row);
  expect(await submitIncomingOriginals(db, 1370, [row.id], 'operator')).toMatchObject({ status: 'not_eligible', accepted_count: 0 });
  expect(await db.insw_queue_cycle.count()).toBe(0); expect(httpCalls).toBe(0);
});

async function withApiSession(run: () => Promise<void>) {
  const restore = bindFixtureSingletons();
  const auth = require('next-auth/next'); const original = auth.getServerSession;
  auth.getServerSession = async () => ({ user: { id: 'fixture-operator', companyCode: '1370', role: 'SUPER_ADMIN' } });
  try { await run(); } finally { auth.getServerSession = original; restore(); }
}

test('manual submit and log resend HTTP contracts report accepted, pending and ineligible without false resolution', async () => {
  await budget(0); const row = await incomingFixture(1370); await acceptance(row);
  await withApiSession(async () => {
    const submit = require('../app/api/insw/post/pemasukan/route').POST as (r: Request) => Promise<Response>;
    const resend = require('../app/api/insw/logs/[id]/resend/route').POST;
    const req = () => new Request('http://localhost/api/insw/post/pemasukan', { method: 'POST', body: JSON.stringify({ ids: [row.id] }) });
    const response = await submit(req()); expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ status: 'accepted', accepted_count: 1 });
    const pending = await submit(req()); expect(pending.status).toBe(202);
    expect(await pending.json()).toMatchObject({ status: 'already_pending', accepted_count: 0 });
    const token = await acquireOperationalOwnership(db); const { job } = await admitNext(db, token, 3600);
    await finish(job!, token, false);
    const log = await db.insw_tracking_log.findFirstOrThrow();
    const result = await resend(new Request('http://localhost/resend', { method: 'POST', body: JSON.stringify({ reason: 'Verified definitive failure' }) }),
      { params: Promise.resolve({ id: log.id.toString() }) });
    expect(result.status).toBe(202); expect(await result.json()).toMatchObject({ status: 'accepted' });
    expect((await db.insw_tracking_log.findUniqueOrThrow({ where: { id: log.id } })).insw_status).toBe('FAILED');
    const conflict = await resend(new Request('http://localhost/resend', { method: 'POST' }), { params: Promise.resolve({ id: log.id.toString() }) });
    expect(conflict.status).toBe(409);
    const detail = await require('../app/api/insw/logs/[id]/route').GET(new Request('http://localhost/log'), { params: Promise.resolve({ id: log.id.toString() }) });
    expect((await detail.json()).data.can_resend).toBe(false);
    expect(httpCalls).toBe(0);
  });
});

for (const failAdmission of [false, true]) {
  test(`real WMS log retry keeps persisted recovery successful, queue admission failure=${failAdmission}`, async () => {
    await budget(0); const row = await incomingFixture(1370);
    const activity = await db.activity_logs.create({ data: { action: 'WMS_PROCESS_INCOMING_GOODS', description: 'Synthetic async failure' } });
    const payload = { wms_id: row.wms_id, company_code: 1370, owner: 1370, customs_document_type: 'BC23',
      ppkek_number: 'DOC', customs_registration_date: '2026-10-23', incoming_evidence_number: 'EVIDENCE', incoming_date: '2026-10-24',
      invoice_number: null, invoice_date: null, shipper_name: 'Synthetic', timestamp: '2026-10-24T01:02:03.123Z',
      items: [1, 2].map(n => ({ item_type: 'ROH', item_code: `ITEM-${n}`, item_name: `Synthetic ${n}`, uom: 'PCS', qty: n, currency: 'USD', amount: 10 })) };
    await db.item_types.upsert({ where: { item_type_code: 'ROH' }, update: {}, create: { item_type_code: 'ROH', name_en: 'Synthetic raw', category: 'raw' } });
    const log = await db.wms_transmission_logs.create({ data: { activity_log_id: activity.id, action: activity.action,
      company_code: 1370, wms_id: row.wms_id, transmission_status: 'ERROR', error_type: 'ASYNC_PROCESSING_ERROR', wms_request_payload: payload } });
    const before = await db.incoming_good_items.findMany();
    if (failAdmission) await db.insw_uom_mapping.deleteMany();
    try {
      await withApiSession(async () => {
        const response = await require('../app/api/settings/wms-transmission-logs/[id]/retry/route').POST(
          new Request('http://localhost/retry', { method: 'POST' }), { params: Promise.resolve({ id: log.id.toString() }) });
        expect(response.status).toBe(200);
        const body = await response.json(); expect(body.success).toBe(true);
        expect(body.insw.status).toBe(failAdmission ? 'failed' : 'accepted');
        expect(await db.incoming_good_items.findMany()).toEqual(before);
        expect(await db.insw_queue_cycle.count()).toBe(failAdmission ? 0 : 1); expect(httpCalls).toBe(0);
      });
    } finally { if (failAdmission) await db.insw_uom_mapping.create({ data: { wms_uom: 'PCS', insw_uom: 'PCE' } }); }
  });
}
