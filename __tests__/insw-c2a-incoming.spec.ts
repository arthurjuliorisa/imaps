import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { prepareIncomingHandoff, handoffIncomingInTransaction, type IncomingPreparation, type PreparedIncomingHandoff } from '../lib/insw-queue/incoming-handoff';
import { freezePayload } from '../lib/insw-queue/contracts';
import { claimJob, transition } from '../lib/insw-queue/queue.repository';

function fixture(extra: Partial<IncomingPreparation> = {}): IncomingPreparation {
  return {
    companyCode: 1370, wmsReference: 'C2A-SYNTHETIC', revision: '2026-10-23T01:02:03.123Z',
    businessDate: '2026-10-23', requestedBy: 'isolated-test',
    authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT',
    payload: { data: [{ kdKegiatan: '30', dokumenKegiatan: [{
      nomorDokKegiatan: 'C2A-SYNTHETIC', tanggalKegiatan: '23-10-2026', namaEntitas: 'Synthetic shipper',
      barangTransaksi: [{ kdKategoriBarang: '1', kdBarang: 'ITEM', uraianBarang: 'Item',
        jumlah: 1, kdSatuan: 'KGM', nilai: 10, dokumen: [{ kodeDokumen: '0407020',
          nomorDokumen: 'DOC', tanggalDokumen: '23-10-2026' }] }],
    }] }] }, ...extra,
  };
}

test('preparation fails closed on incomplete, invalid or oversized inputs', () => {
  for (const extra of [
    { authoritativeInputs: undefined }, { revision: '' }, { businessDate: '2026-02-30' },
    { payload: { data: [] } }, { wmsReference: 'OTHER' },
    { payload: { data: [{ kdKegiatan: '31', dokumenKegiatan: [] }] } },
  ]) expect(() => prepareIncomingHandoff(fixture(extra as Partial<IncomingPreparation>))).toThrow();
  const huge = fixture();
  huge.payload.data[0].dokumenKegiatan[0].namaEntitas = 'x'.repeat(1024 * 1024 + 1);
  expect(() => prepareIncomingHandoff(huge)).toThrow('limit');
  const invalid = fixture();
  invalid.payload.data[0].dokumenKegiatan[0].barangTransaksi[0].jumlah = NaN;
  expect(() => prepareIncomingHandoff(invalid)).toThrow('JSON');
});

test('live paths including source repository remain byte-identical to checkpoint', () => {
  for (const file of [
    'lib/services/incoming-goods.service.ts',
    'lib/validators/schemas/incoming-goods.schema.ts', 'lib/services/insw-integration.service.ts',
    'lib/repositories/insw-integration.repository.ts', 'lib/services/insw-transmission.service.ts',
    'lib/services/insw-service.factory.ts', 'ecosystem.config.js',
  ]) expect(readFileSync(file, 'utf8'), file).toBe(execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 2000000 }));
  expect(readFileSync('lib/repositories/incoming-goods.repository.ts', 'utf8')).toBe(
    execFileSync('git', ['show', 'HEAD:lib/repositories/incoming-goods.repository.ts'], { encoding: 'utf8' }));
});

test.describe('isolated queue API only — real Incoming source atomicity UNPROVEN', () => {
  const url = process.env.INSW_INCOMING_TEST_DATABASE_URL;
  test.skip(!url, 'Requires NEW EMPTY loopback *_phase_c2a_test database');
  let a: PrismaClient;
  let b: PrismaClient;
  let queries: string[] = [];
  test.beforeAll(async () => {
    const parsed = new URL(url!);
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['127.0.0.1', 'localhost'].includes(parsed.hostname) ||
        !/^\/[a-z0-9_]+_phase_c2a_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Unsafe test DB');
    const instrumented = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
    instrumented.$on('query', event => queries.push(event.query)); a = instrumented;
    b = new PrismaClient({ datasources: { db: { url } } });
    const [state] = await a.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
    if (state.count !== BigInt(0)) throw new Error('NEW EMPTY DB required');
    const dir = mkdtempSync('/tmp/imaps-c2a-schema-');
    const schema = `${dir}/baseline.prisma`;
    writeFileSync(schema, readFileSync('prisma/schema.prisma', 'utf8').split('// Dormant Phase B persistence.')[0]
      .replace(/^.*queue_attempt_id.*\n/gm, '').replace(/^.*queue_attempt\s+insw_queue_attempt.*\n/gm, ''));
    const baseline = execFileSync('node_modules/.bin/prisma', ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script'],
      { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
    const sql = `${dir}/bootstrap.sql`;
    writeFileSync(sql, baseline + readFileSync('prisma/migrations/20261022000000_insw_queue_foundation/migration.sql', 'utf8') +
      readFileSync('prisma/migrations/20261022010000_insw_worker_recovery/migration.sql', 'utf8') +
      '\nCREATE TABLE c2a_mutable_input (id integer PRIMARY KEY, value text);');
    execFileSync('psql', [url!, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sql], { stdio: 'pipe' });
  });
  test.afterAll(async () => { await Promise.all([a?.$disconnect(), b?.$disconnect()]); });
  test.beforeEach(async () => {
    await a.insw_queue_attempt.deleteMany(); await a.insw_queue_cycle.deleteMany();
    await a.$executeRaw`DELETE FROM c2a_mutable_input`;
  });
  const submit = (db: PrismaClient, input = fixture()) => db.$transaction(tx => handoffIncomingInTransaction(tx, prepareIncomingHandoff(input)));

  test('requires opaque preparation and an explicit transaction client', async () => {
    await expect(handoffIncomingInTransaction(a, prepareIncomingHandoff(fixture()))).rejects.toThrow('transaction client');
    await expect(a.$transaction(tx => handoffIncomingInTransaction(tx, {} as PreparedIncomingHandoff))).rejects.toThrow('Unrecognized');
    expect(await a.insw_queue_cycle.count()).toBe(0);
  });

  test('queue writes obey caller commit/rollback; no production source integration claimed', async () => {
    await submit(a);
    await expect(a.$transaction(async tx => {
      await handoffIncomingInTransaction(tx, prepareIncomingHandoff(fixture({ revision: 'next' })));
      throw new Error('caller rollback');
    })).rejects.toThrow('caller rollback');
    expect(await a.insw_queue_cycle.count()).toBe(1);
    expect(await a.insw_queue_attempt.count()).toBe(0);
  });

  test('concurrent retries deduplicate; revision and business date retain distinct identities', async () => {
    const [one, two] = await Promise.all([submit(a), submit(b)]);
    expect(one.id).toBe(two.id);
    expect([one, two].filter(row => row.created)).toHaveLength(1);
    const revision = await submit(a, fixture({ revision: 'next' }));
    const date = await submit(b, fixture({ businessDate: '2026-10-24' }));
    expect(new Set([one.id, revision.id, date.id]).size).toBe(3);
    const conflicting = fixture(); conflicting.payload.data[0].dokumenKegiatan[0].namaEntitas = 'Changed';
    await expect(submit(b, conflicting)).rejects.toThrow('conflicts');
  });

  test('same transmission after terminal failure, success or hold never creates another cycle', async () => {
    for (const status of ['FAILED', 'SUCCEEDED', 'HELD']) {
      const input = fixture({ revision: status });
      const original = await submit(a, input);
      const claim = (await claimJob(a, 60000))!;
      if (status === 'HELD') await transition(a, claim, 'HOLD_DISABLED');
      else {
        await transition(a, claim, 'MARK_POSSIBLE_START');
        if (status === 'SUCCEEDED') {
          await transition(a, claim, 'RECORD_REMOTE_SUCCESS');
          await transition(a, claim, 'FINALIZE_SUCCESS');
        } else await transition(a, claim, 'FINALIZE_FAILURE');
      }
      expect(await submit(b, input)).toMatchObject({ id: original.id, created: false, status });
    }
    expect(await a.insw_queue_cycle.count()).toBe(3);
  });

  test('preparation and stored hash stay detached from later mutable source/mapping inputs', async () => {
    const input = fixture();
    const expected = freezePayload(input.payload);
    const prepared = prepareIncomingHandoff(input);
    input.revision = 'mutated'; input.payload.data[0].dokumenKegiatan[0].barangTransaksi[0].kdSatuan = 'CHANGED';
    await a.$executeRaw`INSERT INTO c2a_mutable_input VALUES (1, 'mapping-before')`;
    const row = await a.$transaction(tx => handoffIncomingInTransaction(tx, prepared));
    await a.$executeRaw`UPDATE c2a_mutable_input SET value = 'mapping-after'`;
    expect(await a.insw_queue_cycle.findUnique({ where: { id: row.id } })).toMatchObject({
      frozen_payload: expected.payload, payload_sha256: expected.sha256, source_revision: fixture().revision,
    });
    await expect(a.insw_queue_cycle.update({ where: { id: row.id }, data: { frozen_payload: { changed: true } } })).rejects.toThrow();
  });

  test('bounded queue queries and untouched policy; no attempts or automatic dispatch', async () => {
    // Prisma query events may arrive after the awaited operation. Drain cleanup
    // through an observed barrier rather than counting a late DELETE as handoff.
    await a.$queryRaw`SELECT 1 AS c2a_measurement_barrier`;
    await expect.poll(() => queries.at(-1)).toBe('SELECT 1 AS c2a_measurement_barrier');
    queries = [];
    const started = performance.now();
    await submit(a);
    const durationMs = performance.now() - started;
    await expect.poll(() => queries.at(-1)).toBe('COMMIT');
    const sql = queries.filter(query => !/^(BEGIN|COMMIT|ROLLBACK)/.test(query));
    expect(sql).toHaveLength(7);
    queries = []; await submit(b);
    const rows = await a.insw_queue_cycle.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'READY', max_auto_retry_snapshot: 0, delivery_state: 'NOT_STARTED' });
    expect(await a.insw_queue_attempt.count()).toBe(0);
    expect(await a.insw_transmission_policy.findUnique({ where: { id: 1 } })).toMatchObject({ min_processing_interval_ms: 3600, max_auto_retry: 0 });
    console.log(JSON.stringify({ queueStatements: sql.length, isolatedHandoffDurationMs: durationMs }));
  });
});
