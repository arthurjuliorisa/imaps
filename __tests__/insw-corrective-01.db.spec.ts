import { test, expect } from '@playwright/test';
import { Prisma, PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { handoffIncomingInTransaction, prepareCountHandoff } from '../lib/insw-queue/incoming-handoff';

// PREPARED ONLY. This file never provisions, migrates, seeds or resets a DB.
// Approval must separately authorize the exact new target and fixture insertion.
const url = process.env.INSW_C1_TEST_DATABASE_URL;
test('C1-RACE-01: real independent PostgreSQL connections contend on stable reference', async () => {
  test.skip(!url || process.env.INSW_C1_DB_WRITES_APPROVED !== 'imaps_insw_c1_20261108_disposable',
    'BLOCKED — AUTHORIZATION REQUIRED: new empty task-owned disposable PostgreSQL target');
  const parsed = new URL(url!);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1'
    || parsed.pathname !== '/imaps_insw_c1_20261108_disposable' || parsed.search || parsed.hash
    || process.env.NODE_ENV === 'production') throw new Error('Unsafe C1 test target');
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!process.env.INSW_C1_EXPECTED_HEAD || head !== process.env.INSW_C1_EXPECTED_HEAD) throw new Error('Runtime HEAD mismatch');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const other = new PrismaClient({ datasources: { db: { url } } });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let first: Promise<unknown> | undefined;
  let second: Promise<unknown> | undefined;
  const fetch = globalThis.fetch;
  let httpCalls = 0;
  globalThis.fetch = async () => { httpCalls++; throw new Error('C1_NO_PROVIDER_HTTP'); };
  try {
    const [identity] = await db.$queryRaw<{ db: string; oid: number; host: string; port: number }[]>`
      SELECT current_database() AS db, oid, inet_server_addr()::text AS host, inet_server_port() AS port
      FROM pg_database WHERE datname = current_database()`;
    expect(identity.db).toBe('imaps_insw_c1_20261108_disposable');
    expect(await db.insw_queue_cycle.count()).toBe(0);
    expect(await db.insw_queue_attempt.count()).toBe(0);
    expect(await db.insw_tracking_log.count()).toBe(0);
    const indexes = await db.$queryRaw<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'insw_queue_cycle'
        AND indexname = 'insw_preparation_queue_correlation_idx'`;
    expect(indexes[0]?.indexdef).toContain('(company_code, operation, wms_reference)');
    console.log(JSON.stringify({ head, database: identity, index: indexes[0].indexdef }));
    function token(sourceId: number) {
      return prepareCountHandoff({ companyCode: 1370, operation: 'ADJUSTMENT', sourceId,
        wmsReference: 'C1-RACE', revision: 'COMMITTED_SOURCE', businessDate: '2026-11-08',
        requestedBy: 'C1-DISPOSABLE-INTEGRATION', authoritativeInputs: 'COMPLETE_SOURCE_AND_MAPPING_SNAPSHOT',
        payload: { data: [{ kdKegiatan: '33', dokumenKegiatan: [{ nomorDokKegiatan: 'C1-RACE',
          tanggalKegiatan: '08-11-2026', namaEntitas: '1370', barangTransaksi: [{ kdKategoriBarang: '1',
            kdBarang: 'C1-ITEM', uraianBarang: 'Synthetic', jumlah: 1, kdSatuan: 'PCE', nilai: 1, dokumen: [] }] }] }] } });
    }
    const a = token(30); const b = token(32);
    let inserted!: () => void;
    const ready = new Promise<void>(resolve => { inserted = resolve; });
    let firstPid = 0; let secondPid = 0;
    first = db.$transaction(async tx => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      firstPid = backend.pid;
      const result = await handoffIncomingInTransaction(tx, a);
      inserted();
      await gate; // Deliberate real overlap; test-only, never production behavior.
      return result;
    }, { timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
    await Promise.race([ready, first]);
    second = other.$transaction(async tx => {
      const [backend] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      secondPid = backend.pid;
      return handoffIncomingInTransaction(tx, b);
    }, { timeout: 15000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted })
      .then(result => ({ result }), error => ({ error: String(error) }));
    await expect.poll(async () => {
      if (!secondPid) return false;
      const [row] = await db.$queryRaw<{ waiting: boolean }[]>`SELECT EXISTS (
        SELECT 1 FROM pg_locks WHERE pid = ${secondPid} AND locktype = 'advisory' AND NOT granted) AS waiting`;
      return row.waiting;
    }, { timeout: 5000 }).toBe(true);
    expect(firstPid).not.toBe(secondPid);
    release();
    await first;
    expect(await second).toMatchObject({ error: expect.stringContaining('BUSINESS_REFERENCE_ALREADY_QUEUED') });
    expect(await db.insw_queue_cycle.count()).toBe(1);
    expect(await db.insw_queue_attempt.count()).toBe(0);
    expect(await db.insw_tracking_log.count()).toBe(0);
    expect(httpCalls).toBe(0);
    console.log(JSON.stringify({ firstPid, secondPid, observedAdvisoryWait: true, cycles: 1, attempts: 0, httpCalls }));
    // Retain evidence; no cleanup/reset or worker is launched.
  } finally {
    release();
    await Promise.allSettled([first, second]);
    globalThis.fetch = fetch;
    await Promise.all([db.$disconnect(), other.$disconnect()]);
  }
});
