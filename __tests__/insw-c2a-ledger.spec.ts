import { test, expect } from '@playwright/test';
import { Prisma, PrismaClient } from '@prisma/client';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { isolatedIncomingPreparation, discoverProductionIncoming } from '../lib/insw-queue/incoming-preparation';
import { inspectIncomingRecovery } from '../lib/insw-queue/incoming-recovery';

const url = process.env.INSW_LEDGER_TEST_DATABASE_URL;
test.describe.configure({ mode: 'serial' });
test.skip(!url, 'Requires fresh disposable loopback *_phase_c2a_test');
let db: PrismaClient;
let other: PrismaClient;
let rollout: string;
let member: string;
let source: number;
const measurements: { query: string; duration: number; observedAt: number }[] = [];
let clock = new Date('2026-10-23T10:00:00Z');
const principal = { role: 'USER', companyCode: 1370 };
const evidence = { exclusiveProducer: 'SYNTHETIC_NO_DIRECT_PRODUCER', membership: 'EXPLICIT_SYNTHETIC_MANIFEST', review: 'ISOLATED_TEST' };
const payload = () => ({ data: [{ kdKegiatan: '30', dokumenKegiatan: [{ nomorDokKegiatan: 'LEDGER', tanggalKegiatan: '23-10-2026', namaEntitas: 'Synthetic', barangTransaksi: [{ kdKategoriBarang: '1', kdBarang: 'A', uraianBarang: 'A', jumlah: 1.125, kdSatuan: 'PCE', nilai: 12.3456, dokumen: [] }] }] }] });
const engine = (client = db, provider = async () => payload()) => isolatedIncomingPreparation(client, provider, () => clock);
const discover = () => engine().discover(principal, 1370, rollout);
const retry = () => engine().retryQueue(principal, 1370, rollout, member);
const ledger = () => db.insw_preparation_ledger.findUniqueOrThrow({ where: { member_id: member } });

test.beforeAll(async () => {
  const parsed = new URL(url!);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '127.0.0.1'].includes(parsed.hostname) ||
    !/^\/[a-z0-9_]+_phase_c2a_test$/.test(parsed.pathname) || parsed.search || parsed.hash || process.env.NODE_ENV === 'production') throw new Error('Unsafe test DB');
  const instrumented = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  instrumented.$on('query', event => measurements.push({ ...event, observedAt: performance.now() })); db = instrumented;
  other = new PrismaClient({ datasources: { db: { url } } });
  const [state] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  if (state.count !== BigInt(0)) throw new Error('NEW EMPTY DB required');
  for (const name of readdirSync('prisma/migrations').sort().filter(n => n !== 'migration_lock.toml')) {
    execFileSync('psql', [url!, '-X', '-v', 'ON_ERROR_STOP=1', '-f', `prisma/migrations/${name}/migration.sql`], { stdio: 'pipe' });
  }
  const hotfix = readFileSync('scripts/sql/production/20260722_outgoing_non_facility_goods_hotfix.sql', 'utf8');
  await db.$executeRawUnsafe(hotfix.slice(hotfix.indexOf('CREATE OR REPLACE VIEW vw_laporan_pemasukan AS'), hotfix.indexOf('CREATE OR REPLACE VIEW vw_laporan_pengeluaran AS')));
  await db.companies.createMany({ data: [{ code: 1370, name: 'Synthetic', company_type: 'SEZ' }, { code: 1371, name: 'BZ', company_type: 'BZ' }] });
});
test.afterAll(async () => { await Promise.all([db?.$disconnect(), other?.$disconnect()]); });
test.beforeEach(async () => {
  clock = new Date('2026-10-23T10:00:00Z');
  await db.insw_preparation_ledger.deleteMany(); await db.insw_preparation_member.deleteMany(); await db.insw_preparation_rollout.deleteMany();
  await db.insw_tracking_log.deleteMany(); await db.insw_queue_attempt.deleteMany(); await db.insw_queue_cycle.deleteMany();
  await db.incoming_good_items.deleteMany(); await db.incoming_goods.deleteMany();
  await db.wms_transmission_logs.deleteMany(); await db.activity_logs.deleteMany();
  rollout = (await db.insw_preparation_rollout.create({ data: { company_code: 1370, mode: 'PREPARED', evidence } })).id;
  const saved = await db.incoming_goods.create({ data: { company_code: 1370, owner: 1370, wms_id: 'LEDGER', incoming_date: new Date('2026-10-23'),
    ppkek_number: 'DOC', incoming_evidence_number: 'EVIDENCE', shipper_name: 'Synthetic', timestamp: clock } });
  source = saved.id;
  await db.incoming_good_items.create({ data: { incoming_good_id: source, incoming_good_company: 1370, incoming_good_date: saved.incoming_date,
    item_type: 'ROH', item_code: 'A', item_name: 'A', uom: 'PCS', qty: 1.125, currency: 'USD', amount: 12.3456 } });
  member = (await db.insw_preparation_member.create({ data: { rollout_id: rollout, company_code: 1370, wms_reference: 'LEDGER', source_id: source,
    business_date: saved.incoming_date, proof: 'SYNTHETIC_ACCEPTED_QUEUE_ERA' } })).id;
});
async function sourceIntact() {
  expect(await other.incoming_goods.count({ where: { id: source } })).toBe(1);
  expect((await other.incoming_good_items.findFirstOrThrow()).qty.toString()).toBe('1.125');
}

test('durable disabled boundary; no ACTIVE, timestamp-only evidence or production enumeration', async () => {
  const row = await db.insw_preparation_rollout.create({ data: { company_code: 1371 } });
  expect(row.mode).toBe('DISABLED');
  await expect(db.insw_preparation_rollout.update({ where: { id: rollout }, data: { mode: 'ACTIVE' } })).rejects.toThrow();
  await db.insw_preparation_rollout.update({ where: { id: rollout }, data: { evidence: { timestamp: clock.toISOString() } } });
  await expect(discover()).rejects.toThrow('ROLLOUT_PROOF_REQUIRED');
  expect(discoverProductionIncoming).toThrow('C2C_EXCLUSIVITY');
  expect(await db.insw_preparation_ledger.count()).toBe(0);
});

test('crash gap recovered only through explicit durable membership, independent of retained logs', async () => {
  await db.incoming_goods.create({ data: { company_code: 1370, owner: 1370, wms_id: 'LEGACY', incoming_date: new Date('2026-10-22'),
    ppkek_number: 'OLD', incoming_evidence_number: 'OLD', shipper_name: 'Legacy', timestamp: clock } });
  expect(await db.insw_preparation_ledger.count()).toBe(0);
  await db.insw_preparation_rollout.update({ where: { id: rollout }, data: { mode: 'DISABLED' } });
  await expect(discover()).rejects.toThrow('ROLLOUT_PROOF_REQUIRED');
  await db.insw_preparation_rollout.update({ where: { id: rollout }, data: { mode: 'PREPARED' } });
  expect(await discover()).toMatchObject({ observed: 1 });
  await retry();
  expect(await ledger()).toMatchObject({ state: 'QUEUE_CREATED', attempt_count: 1 });
  expect(await db.insw_queue_cycle.count()).toBe(1);
  expect(await db.wms_transmission_logs.count()).toBe(0);
});

for (const status of ['SUCCESS', 'PENDING', 'FAILED', 'UNKNOWN', 'Duplicate Possibility']) {
  test(`legacy ${status} never causes automatic replay`, async () => {
    await db.insw_tracking_log.create({ data: { transaction_type: 'incoming', company_code: 1370, transaction_id: source, wms_id: 'LEDGER', insw_status: status === 'Duplicate Possibility' ? 'FAILED' : status, metadata: { classification: status } } });
    await discover(); await retry();
    expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: status === 'SUCCESS' ? 'REMOTE_SUCCESS_NO_REPOST' : 'DIRECT_HISTORY_REQUIRES_REVIEW' });
    await retry(); expect(await db.insw_queue_cycle.count()).toBe(0);
    expect(await db.insw_queue_attempt.count()).toBe(0);
  });
}

test('two scanners and competing Retry Queue share one fenced preparation/cycle', async () => {
  await Promise.all([
    (async () => { await discover(); return retry(); })(),
    (async () => { await engine(other).discover(principal, 1370, rollout); return engine(other).retryQueue(principal, 1370, rollout, member); })(),
    retry(),
  ]);
  expect(await db.insw_preparation_ledger.count()).toBe(1);
  expect(await db.insw_queue_cycle.count()).toBe(1);
  expect(await ledger()).toMatchObject({ state: 'QUEUE_CREATED', attempt_count: 1 });
  expect(await db.insw_queue_attempt.count()).toBe(0);
});

test('queue and ledger completion rollback together; committed header/items survive all failures', async () => {
  await db.$executeRawUnsafe(`CREATE FUNCTION c2a_reject_completion() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'QUEUE_CREATED' THEN RAISE EXCEPTION 'completion failed'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER reject_completion BEFORE UPDATE ON insw_preparation_ledger FOR EACH ROW EXECUTE FUNCTION c2a_reject_completion()');
  await discover();
  await expect(retry()).rejects.toThrow('completion failed');
  expect(await db.insw_queue_cycle.count()).toBe(0);
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: 'PERMANENT_PREPARATION', queue_id: null });
  await sourceIntact();
  await db.$executeRawUnsafe('DROP TRIGGER reject_completion ON insw_preparation_ledger');
  await db.$executeRawUnsafe('DROP FUNCTION c2a_reject_completion()');
});

test('separate bounded preparation backoff/budget does not consume HTTP policy or attempts', async () => {
  await discover();
  const failing = engine(db, async () => { throw new Prisma.PrismaClientKnownRequestError('synthetic', { code: 'P2034', clientVersion: '6.5' }); });
  for (let attempt = 1; attempt <= 5; attempt++) {
    await expect(failing.retryQueue(principal, 1370, rollout, member)).rejects.toThrow('synthetic');
    const row = await ledger();
    expect(row.attempt_count).toBe(attempt);
    expect(row.next_eligible_at.getTime() - clock.getTime()).toBe(1000 * 2 ** (attempt - 1));
    expect(await failing.retryQueue(principal, 1370, rollout, member)).toEqual({ claimed: false });
    clock = row.next_eligible_at;
  }
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: 'BUDGET_EXHAUSTED' });
  expect(await retry()).toEqual({ claimed: false });
  expect(await db.insw_queue_attempt.count()).toBe(0);
  expect(await db.insw_transmission_policy.findUnique({ where: { id: 1 } })).toMatchObject({ max_auto_retry: 0 });
});

test('permanent mapping failure holds, forbids manual bypass and preserves source', async () => {
  await discover();
  await expect(engine(db, async () => { throw new Error('synthetic mapping failure'); }).retryQueue(principal, 1370, rollout, member)).rejects.toThrow('mapping');
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: 'PERMANENT_PREPARATION' });
  expect(await retry()).toEqual({ claimed: false }); await sourceIntact();
});

test('fencing rejects stale converter completion after lease expiry and replacement', async () => {
  await discover();
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>(r => entered = r);
  const waiting = new Promise<void>(r => release = r);
  const old = engine(db, async () => { entered(); await waiting; return payload(); }).retryQueue(principal, 1370, rollout, member);
  await started;
  clock = new Date(clock.getTime() + 31000);
  await retry(); release();
  await expect(old).rejects.toThrow('STALE_PREPARATION_OWNER');
  expect(await ledger()).toMatchObject({ state: 'QUEUE_CREATED', attempt_count: 2, fence: 2 });
  expect(await db.insw_queue_cycle.count()).toBe(1);
});

test('authorization, forged source identity, BZ and unproven members fail closed', async () => {
  await expect(engine().discover({ role: 'USER', companyCode: 1371 }, 1370, rollout)).rejects.toThrow('Company');
  await expect(engine().discover({ role: 'FORGED', companyCode: 1370 }, 1370, rollout)).rejects.toThrow('Company');
  await expect(engine().discover(principal, 1371, rollout)).rejects.toThrow('Company');
  await db.insw_preparation_member.update({ where: { id: member }, data: { proof: 'UNKNOWN' } });
  expect(await discover()).toMatchObject({ observed: 0 });
  await db.insw_preparation_member.update({ where: { id: member }, data: { proof: 'SYNTHETIC_ACCEPTED_QUEUE_ERA', source_id: source + 999 } });
  await discover(); await retry();
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: 'SOURCE_IDENTITY_UNCONFIRMED' });
  await db.insw_preparation_ledger.deleteMany();
  await db.insw_preparation_member.update({ where: { id: member }, data: { source_id: source } });
  await db.companies.update({ where: { code: 1370 }, data: { company_type: 'BZ' } });
  await discover(); await retry();
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD' });
  await db.companies.update({ where: { code: 1370 }, data: { company_type: 'SEZ' } });
});

test('persisted projection separates acceptance, source, preparation and send; no raw payload exposure', async () => {
  const activity = await db.activity_logs.create({ data: { action: 'WMS_PROCESS_INCOMING_GOODS', description: 'Synthetic' } });
  const log = await db.wms_transmission_logs.create({ data: { activity_log_id: activity.id, action: activity.action, company_code: 1370, wms_id: 'LEDGER', transmission_status: 'SUCCESS' } });
  await discover(); await retry();
  const [row] = await inspectIncomingRecovery(db, principal, 1370, [log.id]);
  expect(row.request.status).toBe('ACCEPTED'); expect(row.source.status).toBe('COMMITTED');
  expect(row.preparation).toMatchObject({ status: 'QUEUE_CREATED', attemptCount: 1, rolloutId: rollout, queueId: (await ledger()).queue_id });
  expect(row.transmission).toMatchObject({ httpAttemptsStarted: 0, deliveryState: 'NOT_STARTED' });
  expect(row.actions.retryQueue).toBe(false);
  expect(JSON.stringify(row)).not.toContain('barangTransaksi');
  const stored = await db.insw_queue_cycle.findFirstOrThrow();
  expect(stored.source_revision).toBe('ACCEPTED_WMS_ID');
  await expect(db.insw_queue_cycle.update({ where: { id: stored.id }, data: { frozen_payload: { changed: true } } })).rejects.toThrow();
});

test('dormant service has no production imports; protected WMS files and existing migrations unchanged', () => {
  for (const file of ['lib/repositories/incoming-goods.repository.ts', 'lib/services/incoming-goods.service.ts', 'lib/services/wms-duplicate.service.ts', 'ecosystem.config.js']) {
    expect(readFileSync(file, 'utf8')).toBe(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 2000000 }));
  }
  const imports = spawnSync('rg', ['-l', 'incoming-preparation', 'app', 'lib'], { encoding: 'utf8' });
  expect(imports.status).toBe(1); expect(imports.stdout).toBe('');
});


test('actual persisted view/converter fixtures: facility, nonfacility, fallback, decimal, active UOM and company scope', async () => {
  // Bind the existing converter singleton ONLY in this isolated test worker.
  Object.assign(globalThis, { prisma: db, prismaVersion: 2 });
  const { INSWIntegrationService } = require('../lib/services/insw-integration.service') as typeof import('../lib/services/insw-integration.service');
  const converter = new INSWIntegrationService('synthetic', 'synthetic');
  await db.insw_uom_mapping.deleteMany();
  await db.insw_uom_mapping.create({ data: { wms_uom: 'PCS', insw_uom: 'PCE', is_active: true } });
  await db.incoming_goods.update({ where: { company_code_id_incoming_date: { company_code: 1370, id: source, incoming_date: new Date('2026-10-23') } },
    data: { customs_document_type: 'BC23', customs_registration_date: new Date('2026-10-22') } });
  const converted = await converter.convertPemasukanToINSW(1370, [source]);
  const doc = converted.data[0].dokumenKegiatan[0];
  expect(doc.nomorDokKegiatan).toBe('LEDGER');
  expect(doc.barangTransaksi[0]).toMatchObject({ kdKategoriBarang: '1', jumlah: 1.125, nilai: 12.3456, kdSatuan: 'PCE',
    dokumen: [{ kodeDokumen: '0407023', nomorDokumen: 'DOC', tanggalDokumen: '22-10-2026' }] });
  expect((await converter.convertPemasukanToINSW(1371, [source])).data[0].dokumenKegiatan).toEqual([]);
  await db.incoming_goods.updateMany({ where: { id: source }, data: { is_non_facility: true } });
  expect((await converter.convertPemasukanToINSW(1370, [source])).data[0].dokumenKegiatan[0].barangTransaksi[0].dokumen).toEqual([]);
  await db.incoming_goods.updateMany({ where: { id: source }, data: { is_non_facility: false, customs_document_type: null, customs_registration_date: null, ppkek_number: '' } });
  expect((await converter.convertPemasukanToINSW(1370, [source])).data[0].dokumenKegiatan[0].barangTransaksi[0].dokumen)
    .toEqual([{ kodeDokumen: '0407020', nomorDokumen: 'EVIDENCE', tanggalDokumen: '23-10-2026' }]);
  await db.insw_uom_mapping.updateMany({ data: { is_active: false } });
  await expect(converter.convertPemasukanToINSW(1370, [source])).rejects.toThrow('UOM mapping');
  await sourceIntact();
});

test('bounded statement and short queue transaction samples', async () => {
  await db.$queryRaw`SELECT 1 AS ledger_barrier`;
  await expect.poll(() => measurements.at(-1)?.query).toBe('SELECT 1 AS ledger_barrier');
  measurements.length = 0;
  const began = performance.now(); await discover(); await retry();
  await db.$queryRaw`SELECT 1 AS ledger_end_barrier`;
  await expect.poll(() => measurements.at(-1)?.query).toBe('SELECT 1 AS ledger_end_barrier');
  const statements = measurements.filter(m => !/^(BEGIN|COMMIT|ROLLBACK)/.test(m.query));
  expect(statements.length).toBeLessThanOrEqual(32);
  expect(await db.insw_queue_cycle.count()).toBe(1);
  console.log(JSON.stringify({ preparationStatements: statements.length - 1, preparationWallMs: performance.now() - began,
    transactionWallSamplesMs: measurements.flatMap((m, i) => m.query === 'BEGIN' ? [measurements.slice(i + 1).find(e => e.query === 'COMMIT')!.observedAt - m.observedAt] : []),
    databaseStatementMs: measurements.map(m => m.duration), transactionCount: measurements.filter(m => m.query === 'BEGIN').length }));
});

test('failed ledger insert cannot undo committed source; observation alone grants no retry', async () => {
  await db.$executeRawUnsafe(`CREATE FUNCTION c2a_reject_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ledger insert failed'; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER reject_ledger BEFORE INSERT ON insw_preparation_ledger FOR EACH ROW EXECUTE FUNCTION c2a_reject_ledger()');
  await expect(discover()).rejects.toThrow('ledger insert failed'); await sourceIntact();
  await db.$executeRawUnsafe('DROP TRIGGER reject_ledger ON insw_preparation_ledger');
  await db.$executeRawUnsafe('DROP FUNCTION c2a_reject_ledger()');
  const m = await db.insw_preparation_member.findUniqueOrThrow({ where: { id: member } });
  await db.insw_preparation_ledger.create({ data: { member_id: member, rollout_id: rollout, company_code: 1370,
    source_kind: 'INCOMING', wms_reference: m.wms_reference, source_id: source, business_date: m.business_date } });
  expect(await retry()).toEqual({ claimed: false });
  expect(await ledger()).toMatchObject({ state: 'SOURCE_OBSERVED', reason: 'ACCEPTANCE_UNPROVEN', attempt_count: 0 });
});

test('existing queue at any revision or terminal state requires review, never a new cycle', async () => {
  const { prepareIncomingHandoff, handoffIncomingInTransaction } = await import('../lib/insw-queue/incoming-handoff');
  const token = prepareIncomingHandoff({ companyCode: 1370, wmsReference: 'LEDGER', revision: 'legacy-synthetic', businessDate: '2026-10-23',
    requestedBy: 'test', authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT', payload: payload() });
  await db.$transaction(tx => handoffIncomingInTransaction(tx, token));
  await discover(); await retry();
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: 'EXISTING_QUEUE_REQUIRES_REVIEW' });
  expect(await db.insw_queue_cycle.count()).toBe(1);
  // Header-identity queues can lack a WMS reference. Unresolved alias correlation
  // is conservative review, never permission to create a second cycle.
  await db.insw_preparation_ledger.deleteMany(); await db.insw_queue_cycle.deleteMany();
  const { enqueueExisting } = await import('../lib/insw-queue/queue.repository');
  await enqueueExisting(db, { identity: { kind: 'SOURCE_HEADER', operation: 'INCOMING', companyCode: 1370,
    sourceId: source, revision: 'old', businessDate: '2026-10-23' }, payload: payload(), intent: 'SOURCE_COMMIT', requestedBy: 'synthetic' });
  await discover(); await retry();
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: 'EXISTING_QUEUE_REQUIRES_REVIEW' });
  expect(await db.insw_queue_cycle.count()).toBe(1);
});

test('last expired claim is held at budget, and revoked membership blocks preparation', async () => {
  await discover();
  await db.insw_preparation_ledger.update({ where: { member_id: member }, data: { state: 'CLAIMED', attempt_count: 5,
    owner_token: '00000000-0000-4000-8000-000000000001', lease_until: new Date(clock.getTime() - 1) } });
  expect(await retry()).toEqual({ claimed: false });
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: 'BUDGET_EXHAUSTED' });
  await db.insw_preparation_ledger.deleteMany(); await discover();
  await db.insw_preparation_member.update({ where: { id: member }, data: { proof: 'REVOKED' } });
  await retry();
  expect(await ledger()).toMatchObject({ state: 'REVIEW_HOLD', reason: 'SOURCE_IDENTITY_UNCONFIRMED' });
  expect(await db.insw_queue_cycle.count()).toBe(0);
});


test('monitoring cannot associate an old ledger with a replacement source ID/date', async () => {
  const activity = await db.activity_logs.create({ data: { action: 'WMS_PROCESS_INCOMING_GOODS', description: 'Synthetic' } });
  const log = await db.wms_transmission_logs.create({ data: { activity_log_id: activity.id, action: activity.action,
    company_code: 1370, wms_id: 'LEDGER', transmission_status: 'SUCCESS' } });
  await discover(); await retry();
  await db.incoming_goods.deleteMany();
  await db.incoming_goods.create({ data: { company_code: 1370, owner: 1370, wms_id: 'LEDGER', incoming_date: new Date('2026-10-24'),
    ppkek_number: 'NEW', incoming_evidence_number: 'NEW', shipper_name: 'New', timestamp: clock } });
  const [row] = await inspectIncomingRecovery(db, principal, 1370, [log.id]);
  expect(row.preparation.rolloutId).toBeNull();
  expect(row.preparation.status).toBe('PREPARATION_BLOCKED');
  expect(row.actions.retryQueue).toBe(false);
});

test('runtime guard refuses production and a client reporting any application database', async () => {
  const previous = process.env.NODE_ENV;
  try {
    Object.assign(process.env, { NODE_ENV: 'production' });
    await expect(discover()).rejects.toThrow('ISOLATED_TEST_ONLY');
  } finally {
    if (previous === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Object.assign(process.env, { NODE_ENV: previous });
  }
  // No connection is made to an application DB; simulate its runtime identity.
  const fake = { $transaction() {}, $queryRaw: async () => [{ name: 'application', host: '127.0.0.1' }] } as unknown as PrismaClient;
  await expect(engine(fake).discover(principal, 1370, rollout)).rejects.toThrow('ISOLATED_TEST_ONLY');
  expect(() => isolatedIncomingPreparation({} as PrismaClient, async () => payload())).toThrow('Dedicated database');
  expect(() => isolatedIncomingPreparation(db, async () => payload(), () => clock, { maxAttempts: 6, leaseMs: 30000, baseDelayMs: 1000 })).toThrow('budget');
  expect(await db.insw_queue_cycle.count()).toBe(0);
});
