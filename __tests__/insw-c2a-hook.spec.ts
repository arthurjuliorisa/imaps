import { test, expect } from '@playwright/test';
import { PrismaClient, Prisma } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { handoffIncomingInTransaction, prepareIncomingHandoff } from '../lib/insw-queue/incoming-handoff';
import { inspectIncomingRecovery } from '../lib/insw-queue/incoming-recovery';
import type { IncomingGoodRequestInput } from '../lib/validators/schemas/incoming-goods.schema';
import type { IncomingGoodsRepository } from '../lib/repositories/incoming-goods.repository';

// Source writes are real; payloads/failure injection are synthetic. Snapshot,
// cascade and description work is stubbed: these are not stock end-to-end tests.
const url = process.env.INSW_HOOK_TEST_DATABASE_URL;
test.describe('post-commit independence and dormant recovery; real source DB writes', () => {
  test.skip(!url, 'Requires fresh empty loopback *_phase_c2a_test database');
  let db: PrismaClient;
  let other: PrismaClient;
  let repo: IncomingGoodsRepository;
  const queries: { query: string; duration: number; observedAt: number }[] = [];
  const postCommit: string[] = [];
  let logId: bigint;
  test.beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
        !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
        !/^\/[a-z0-9_]+_phase_c2a_test$/.test(parsed.pathname) || parsed.search || parsed.hash ||
        process.env.NODE_ENV === 'production') throw new Error('Unsafe test runtime/database');
    db = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    (db as PrismaClient<Prisma.PrismaClientOptions, 'query'>).$on('query', e => queries.push({ ...e, observedAt: performance.now() }));
    other = new PrismaClient({ datasources: { db: { url } } });
    const [state] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
    if (state.count !== BigInt(0)) throw new Error('NEW EMPTY DB required');
    // Exact existing migration files; ignore no SQL silently: report empty dirs.
    for (const name of readdirSync('prisma/migrations').sort()) {
      if (name === 'migration_lock.toml') continue;
      const file = `prisma/migrations/${name}/migration.sql`;
      if (!existsSync(file)) { console.log(`MISSING_MIGRATION_FILE ${file}`); continue; }
      execFileSync('psql', [url!, '-X', '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: 'pipe' });
    }
    await db.companies.createMany({ data: [
      { code: 1370, name: 'Synthetic SEZ', company_type: 'SEZ' },
      { code: 1371, name: 'Synthetic BZ', company_type: 'BZ' },
      { code: 1372, name: 'Synthetic unspecified', company_type: null },
    ] });
    // Bind the existing singleton before importing the real repository. No app
    // credentials are read. Only post-commit snapshot/description work is stubbed.
    (globalThis as unknown as { prisma: PrismaClient }).prisma = db;
    const { IncomingGoodsRepository } = require('../lib/repositories/incoming-goods.repository') as typeof import('../lib/repositories/incoming-goods.repository');
    class HookRepository extends IncomingGoodsRepository {
      protected async updateItemSnapshots() { postCommit.push('snapshot'); }
      protected async cascadeRecalculateSnapshots() { postCommit.push('cascade'); }
      protected async syncItemDescriptionsFromPayload() { postCommit.push('description'); }
    }
    repo = new HookRepository();
  });
  test.afterAll(async () => { await Promise.all([db?.$disconnect(), other?.$disconnect()]); });
  test.beforeEach(async () => {
    await db.insw_tracking_log.deleteMany();
    await db.insw_queue_attempt.deleteMany(); await db.insw_queue_cycle.deleteMany();
    await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany();
    await db.$queryRaw`SELECT 1 AS hook_measurement_barrier`;
    await expect.poll(() => queries.at(-1)?.query).toBe('SELECT 1 AS hook_measurement_barrier');
    queries.length = 0; postCommit.length = 0;
    await db.wms_transmission_logs.deleteMany(); await db.activity_logs.deleteMany();
    const activity = await db.activity_logs.create({ data: { action: 'WMS_PROCESS_INCOMING_GOODS', description: 'Synthetic accepted request' } });
    const log = await db.wms_transmission_logs.create({ data: { activity_log_id: activity.id,
      action: 'WMS_PROCESS_INCOMING_GOODS', wms_id: 'HOOK', company_code: 1370, transmission_status: 'SUCCESS' } });
    logId = log.id;
  });
  function input(wms_id = 'HOOK', qty = 1): IncomingGoodRequestInput {
    return { wms_id, company_code: 1370, owner: 1370, customs_document_type: 'BC23',
      ppkek_number: 'DOC', customs_registration_date: '2026-10-23', incoming_evidence_number: 'EVIDENCE',
      incoming_date: '2026-10-23', invoice_number: null, invoice_date: null, shipper_name: 'Synthetic',
      timestamp: '2026-10-23T01:02:03.123Z', items: [1, 2].map(n => ({ item_type: 'ROH',
        item_code: `ITEM${n}`, item_name: `Item ${n}`, hs_code: null, uom: 'PCS', qty, currency: 'USD', amount: 10 })) };
  }
  const principal = { role: 'USER', companyCode: 1370 };
  const observe = () => inspectIncomingRecovery(db, principal, 1370, [logId]);
  function syntheticPreparation() {
    return prepareIncomingHandoff({ companyCode: 1370, wmsReference: 'HOOK', revision: 'synthetic-only',
      businessDate: '2026-10-23', requestedBy: 'synthetic-post-commit-test',
      authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT',
      payload: { data: [{ kdKegiatan: '30', dokumenKegiatan: [{ nomorDokKegiatan: 'HOOK',
        tanggalKegiatan: '23-10-2026', namaEntitas: 'Synthetic', barangTransaksi: [{
          kdKategoriBarang: '1', kdBarang: 'ITEM1', uraianBarang: 'Item', jumlah: 1,
          kdSatuan: 'PCE', nilai: 10, dokumen: [] }] }] }] } });
  }
  async function assertSaved() {
    expect(await other.incoming_goods.count()).toBe(1);
    expect((await other.incoming_good_items.findMany()).map(i => Number(i.qty))).toEqual([1, 1]);
    expect(postCommit).toEqual(['snapshot', 'cascade', 'description']);
    expect((await observe())[0].source.status).toBe('COMMITTED');
  }
  test('accepted log is not proof of source commit; after simulated stop, missing queue is detectable but blocked', async () => {
    expect((await observe())[0].source.status).toBe('ACCEPTED_PERSISTING');
    await repo.createOrUpdate(input()); // Simulated process stop: deliberately no post-commit intention write.
    await assertSaved();
    const [row] = await observe();
    expect(row.preparation).toEqual({ status: 'PREPARATION_BLOCKED', reason: 'QUEUE_ERA_AND_EXCLUSIVE_PRODUCER_UNPROVEN',
      attemptCount: null, nextEligibleAt: null, rolloutId: null });
    expect(row.actions.retryQueue).toBe(false);
    expect(await db.insw_queue_cycle.count()).toBe(0);
  });
  for (const failure of ['intention insert', 'mapping/converter', 'queue insert', 'after queue insert']) {
    test(`real source persists independently of post-commit ${failure} failure`, async () => {
      await repo.createOrUpdate(input());
      await expect((async () => {
        if (failure === 'mapping/converter') throw new Error('synthetic missing UOM mapping');
        await db.$transaction(async tx => {
          if (failure === 'intention insert') await tx.$executeRawUnsafe('INSERT INTO nonexistent_c2a_intention VALUES (1)');
          else if (failure === 'queue insert') {
            await tx.$executeRawUnsafe(`CREATE FUNCTION pg_temp.c2a_reject_queue() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic queue insert failed'; END $$`);
            await tx.$executeRawUnsafe('CREATE TRIGGER c2a_reject_queue BEFORE INSERT ON insw_queue_cycle FOR EACH ROW EXECUTE FUNCTION pg_temp.c2a_reject_queue()');
            await handoffIncomingInTransaction(tx, syntheticPreparation());
          } else {
            await handoffIncomingInTransaction(tx, syntheticPreparation());
            throw new Error('synthetic post-queue failure');
          }
        });
      })()).rejects.toThrow();
      await assertSaved();
      expect(await db.insw_queue_cycle.count()).toBe(0);
      expect(await db.insw_queue_attempt.count()).toBe(0);
    });
  }
  test('concurrent assessments remain read-only; explicit IDs exclude other history; measures batch query cost', async () => {
    await repo.createOrUpdate(input());
    const activity = await db.activity_logs.create({ data: { action: 'WMS_PROCESS_INCOMING_GOODS', description: 'Historical' } });
    await db.wms_transmission_logs.create({ data: { activity_log_id: activity.id, action: 'WMS_PROCESS_INCOMING_GOODS',
      wms_id: 'OLD', company_code: 1370, created_at: new Date('2020-01-01'), transmission_status: 'SUCCESS' } });
    const assessments = await Promise.all([observe(), observe()]);
    expect(assessments.map(rows => rows.map(r => r.logId))).toEqual([[String(logId)], [String(logId)]]);
    expect(await db.insw_queue_cycle.count()).toBe(0);
    const extraIds: bigint[] = [logId];
    for (let n = 0; n < 99; n++) {
      const activity = await db.activity_logs.create({ data: { action: 'WMS_PROCESS_INCOMING_GOODS', description: 'Load fixture' } });
      extraIds.push((await db.wms_transmission_logs.create({ data: { activity_log_id: activity.id, action: 'WMS_PROCESS_INCOMING_GOODS',
        wms_id: 'HOOK', company_code: 1370, transmission_status: 'SUCCESS' } })).id);
    }
    await db.$queryRaw`SELECT 1 AS recovery_measurement_barrier`;
    await expect.poll(() => queries.at(-1)?.query).toBe('SELECT 1 AS recovery_measurement_barrier');
    queries.length = 0;
    const start = performance.now();
    expect(await inspectIncomingRecovery(db, principal, 1370, extraIds)).toHaveLength(100);
    const elapsed = performance.now() - start;
    await expect.poll(() => queries.length).toBe(1);
    console.log(JSON.stringify({ recoveryBatchSize: 100, queryCount: queries.length, elapsedMs: elapsed }));
  });
  test('queue and HTTP states stay separate, remote success prevents repost, no payloads in projection', async () => {
    await repo.createOrUpdate(input());
    await db.insw_tracking_log.create({ data: { transaction_type: 'incoming', company_code: 1370, wms_id: 'HOOK',
      insw_status: 'SUCCESS', insw_request_payload: { secret: 'never expose' } } });
    expect((await observe())[0].preparation.reason).toBe('REMOTE_SUCCESS_NO_REPOST');
    // Synthetic queue only, explicitly inserted by harness; inspection never posts.
    await db.$transaction(tx => handoffIncomingInTransaction(tx, syntheticPreparation()));
    const [row] = await observe();
    expect(row.preparation.status).toBe('QUEUE_CREATED');
    expect(row.transmission.queueStatus).toBe('READY');
    expect(row.transmission.httpRetryIndex).toBe(0);
    expect(row.transmission.httpAttemptsStarted).toBe(0);
    expect(row.transmission.knownRemoteSuccess).toBe(true);
    expect(row.preparation.attemptCount).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/never expose|frozen_payload|insw_request_payload/);
    expect(await db.insw_queue_attempt.count()).toBe(0);
    await db.insw_queue_cycle.update({ where: { id: row.transmission.queueId! }, data: { error_category: 'DUPLICATE_POSSIBILITY' } });
    expect((await observe())[0].transmission.classification).toBe('DUPLICATE_POSSIBILITY');
    expect((await observe())[0].transmission.queueStatus).toBe('READY');
  });
  test('known direct pending/failed history never authorizes preparation', async () => {
    await repo.createOrUpdate(input());
    for (const status of ['PENDING', 'FAILED']) {
      await db.insw_tracking_log.create({ data: { transaction_type: 'incoming', company_code: 1370, wms_id: 'HOOK', insw_status: status } });
      const [row] = await observe();
      expect(row.preparation.reason).toBe('DIRECT_HISTORY_REQUIRES_REVIEW');
      expect(row.actions.retryQueue).toBe(false);
    }
    expect(await db.insw_queue_cycle.count()).toBe(0);
  });
  test('authorization fails before DB access, non-SEZ is not applicable, different-date source ambiguity requires review', async () => {
    await expect(inspectIncomingRecovery(db, { role: 'USER', companyCode: 1371 }, 1370, [logId])).rejects.toThrow('access denied');
    await expect(inspectIncomingRecovery(db, { role: 'USER' }, 1370, [logId])).rejects.toThrow('access denied');
    await expect(inspectIncomingRecovery(db, principal, 1370, Array(101).fill(logId))).rejects.toThrow('batch size');
    expect(await inspectIncomingRecovery(db, { role: 'SUPER_ADMIN' }, 1371, [logId])).toEqual([]);
    await db.wms_transmission_logs.update({ where: { id: logId }, data: { action: 'WMS_PROCESS_WIP_BALANCE' } });
    expect(await observe()).toEqual([]); // WIP is a distinct source kind, never an Incoming candidate.
    await db.wms_transmission_logs.update({ where: { id: logId }, data: { action: 'WMS_PROCESS_INCOMING_GOODS' } });
    for (const company of [1371, 1372]) {
      await db.wms_transmission_logs.update({ where: { id: logId }, data: { company_code: company } });
      expect((await inspectIncomingRecovery(db, { role: 'SUPER_ADMIN' }, company, [logId]))[0].preparation.status)
        .toBe(company === 1371 ? 'NOT_REQUIRED' : 'UNKNOWN_NEEDS_REVIEW');
    }
    await db.wms_transmission_logs.update({ where: { id: logId }, data: { company_code: 1370 } });
    await repo.createOrUpdate(input());
    const source = await db.incoming_goods.findFirstOrThrow();
    const { id: _id, ...data } = source;
    await db.incoming_goods.create({ data: { ...data, incoming_date: new Date('2026-10-24') } });
    const [row] = await observe();
    expect(row.source.status).toBe('UNKNOWN_NEEDS_REVIEW');
    expect(row.preparation.reason).toBe('AMBIGUOUS_SOURCE_OR_QUEUE_IDENTITY');
  });
});
