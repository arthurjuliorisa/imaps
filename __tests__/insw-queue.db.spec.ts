import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enqueueExisting, enqueueInTransaction, claimJob, transition, transitionInTransaction, holdExpiredClaims, reserveTail, EnqueueInput, Claim } from '../lib/insw-queue/queue.repository';
import { readPolicy, updatePolicy } from '../lib/insw-queue/policy.repository';

// Never use DATABASE_URL or lib/prisma. An explicitly supplied empty local test DB is required.
test.describe.configure({ mode: 'serial' });
const url = process.env.INSW_QUEUE_TEST_DATABASE_URL;
test.skip(!url, 'Set INSW_QUEUE_TEST_DATABASE_URL to a NEW EMPTY isolated local *_phase_b_test database');
let a: PrismaClient;
let b: PrismaClient;
let queries: string[] = [];
const migration = readFileSync('prisma/migrations/20261022000000_insw_queue_foundation/migration.sql', 'utf8');
function fixture(key = 'source-1'): EnqueueInput {
  return {
    identity: { companyCode: 1370, kind: 'WMS_REFERENCE', operation: 'OUTGOING', reference: key, revision: '1', businessDate: '2026-10-22' },
    payload: { documents: [{ reference: key }] }, intent: 'SOURCE_COMMIT', requestedBy: 'test-only',
  };
}
async function claimed() {
  const row = await claimJob(a, 60000);
  expect(row).not.toBeNull();
  return row!;
}
async function expire(c: Claim) {
  await a.$executeRaw`UPDATE insw_queue_cycle SET lease_until = clock_timestamp() - interval '1 second' WHERE id = ${c.id}::uuid`;
}

test.beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !/^\/[a-z0-9_]+_phase_b_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Refusing unsafe test database URL');
  const instrumented = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  instrumented.$on('query', event => { queries.push(event.query); });
  a = instrumented;
  b = new PrismaClient({ datasources: { db: { url } } });
  const [state] = await a.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  if (state.count !== BigInt(0)) throw new Error('Refusing nonempty test database; provision a fresh empty database for each run');
  // Bootstrap the exact pre-Phase-B schema, then apply the real additive migration.
  const directory = mkdtempSync('/tmp/imaps-insw-queue-schema-');
  const schema = readFileSync('prisma/schema.prisma', 'utf8').split('// Dormant Phase B persistence.')[0]
    .replace(/^.*queue_attempt_id.*\n/gm, '').replace(/^.*queue_attempt\s+insw_queue_attempt.*\n/gm, '');
  const schemaFile = join(directory, 'baseline.prisma');
  writeFileSync(schemaFile, schema);
  const baseline = execFileSync('node_modules/.bin/prisma', ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaFile, '--script'], { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  const sqlFile = join(directory, 'bootstrap.sql');
  writeFileSync(sqlFile, baseline + `\nINSERT INTO insw_tracking_log (id, transaction_type, company_code, insw_status, metadata, updated_at) VALUES (77, 'incoming', 1370, 'LEGACY_CUSTOM', '{"legacy":true}', CURRENT_TIMESTAMP);\n` + migration + readFileSync('prisma/migrations/20261022010000_insw_worker_recovery/migration.sql', 'utf8') + '\nCREATE TABLE phase_b_test_source (id integer PRIMARY KEY);');
  execFileSync('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], { stdio: 'pipe' });
});
test.afterAll(async () => { await Promise.all([a?.$disconnect(), b?.$disconnect()]); });
test.beforeEach(async () => {
  await a.insw_tracking_log.deleteMany({ where: { queue_attempt_id: { not: null } } });
  await a.insw_queue_attempt.deleteMany();
  await a.insw_queue_cycle.deleteMany();
  const p = await readPolicy(a);
  if (p.max_auto_retry !== 0) await updatePolicy(a, p.version, { min_processing_interval_ms: 3600, max_auto_retry: 0 }, 'test-reset', 'Reset isolated test policy');
});

test('migration preserves legacy history, initializes policy idempotently and enforces SQL constraints', async () => {
  expect(await readPolicy(a)).toMatchObject({ min_processing_interval_ms: 3600, max_auto_retry: 0 });
  const initSql = migration.slice(migration.indexOf('INSERT INTO "insw_transmission_policy"'));
  const sqlFile = join(mkdtempSync('/tmp/imaps-insw-queue-init-'), 'init.sql');
  writeFileSync(sqlFile, initSql);
  execFileSync('psql', [url!, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], { stdio: 'pipe' });
  expect(await a.insw_transmission_policy.count()).toBe(1);
  expect(await a.insw_policy_change.count()).toBe(1);
  expect(await a.insw_dispatch_gate.findUnique({ where: { id: 1 } })).toMatchObject({ last_started_at: null, owner_token: null });
  const legacy = await a.insw_tracking_log.findUnique({ where: { id: BigInt(77) } });
  expect(legacy).toMatchObject({ insw_status: 'LEGACY_CUSTOM', metadata: { legacy: true }, queue_attempt_id: null });
  await expect(a.$executeRaw`UPDATE insw_transmission_policy SET min_processing_interval_ms = 0 WHERE id = 1`).rejects.toThrow();
  await expect(a.$executeRaw`UPDATE insw_transmission_policy SET max_auto_retry = -1 WHERE id = 1`).rejects.toThrow();
  await expect(a.$transaction(async tx => { await tx.insw_transmission_policy.delete({ where: { id: 1 } }); await readPolicy(tx); })).rejects.toThrow('missing');
  expect(await readPolicy(a)).toBeTruthy();
});

test('policy updates are versioned, audited, and snapshotted per cycle', async () => {
  const input = fixture();
  const first = await enqueueExisting(a, input);
  const policy = await readPolicy(a);
  const updated = await updatePolicy(a, policy.version, { min_processing_interval_ms: 3600, max_auto_retry: 3 }, 'operator:test', 'Exercise snapshot semantics');
  await expect(updatePolicy(b, policy.version, { min_processing_interval_ms: 1, max_auto_retry: 9 }, 'stale:test', 'Stale write')).rejects.toThrow('stale');
  expect(await a.insw_policy_change.findUnique({ where: { version: updated.version } })).toMatchObject({ max_auto_retry: 3, changed_by: 'operator:test' });
  expect((await enqueueExisting(b, input)).max_auto_retry_snapshot).toBe(0);
  const c = await claimed();
  await transition(a, c, 'MARK_POSSIBLE_START');
  await transition(a, c, 'FINALIZE_FAILURE');
  const next = await enqueueExisting(b, { ...input, intent: 'MANUAL_RESUBMIT', payload: { corrected: true } });
  expect(next).toMatchObject({ cycle: first.cycle + 1, max_auto_retry_snapshot: 3, created: true });
  expect(await a.insw_queue_cycle.findUnique({ where: { id: first.id }, select: { max_auto_retry_snapshot: true } })).toEqual({ max_auto_retry_snapshot: 0 });
  await expect(a.insw_queue_cycle.update({ where: { id: first.id }, data: { max_auto_retry_snapshot: 3 } })).rejects.toThrow();
});

test('two independent connections deduplicate simultaneous enqueue; partial index independently protects active identity', async () => {
  const [[pidA], [pidB]] = await Promise.all([a.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`, b.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`]);
  expect(pidA.pid).not.toBe(pidB.pid);
  const [one, two] = await Promise.all([enqueueExisting(a, fixture()), enqueueExisting(b, fixture())]);
  expect(one.id).toBe(two.id);
  expect([one.created, two.created].filter(Boolean)).toHaveLength(1);
  expect(await a.insw_queue_cycle.count()).toBe(1);
  await expect(enqueueExisting(a, { ...fixture(), payload: { conflicting: true } })).rejects.toThrow('conflicts');
  await expect(a.$executeRaw`INSERT INTO insw_queue_cycle (id, company_code, operation, identity_key, source_revision, business_date, cycle, intent, requested_by, frozen_payload, payload_sha256, max_auto_retry_snapshot)
    SELECT '00000000-0000-4000-8000-000000000002'::uuid, company_code, operation, identity_key, source_revision, business_date, cycle + 1, intent, requested_by, frozen_payload, payload_sha256, max_auto_retry_snapshot FROM insw_queue_cycle WHERE id = ${one.id}::uuid`).rejects.toThrow();
});

test('caller source persistence and enqueue commit or roll back together', async () => {
  await a.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO phase_b_test_source VALUES (1)`;
    await enqueueInTransaction(tx, fixture('committed'));
  });
  for (const id of [2, 3]) await expect(a.$transaction(async tx => {
    await tx.$executeRaw`INSERT INTO phase_b_test_source VALUES (${id})`;
    await enqueueInTransaction(tx, id === 2 ? { ...fixture('invalid'), payload: { bad: undefined } } : fixture('rolled-back'));
    throw new Error('Simulated source failure after enqueue');
  })).rejects.toThrow();
  expect(await a.$queryRaw`SELECT id FROM phase_b_test_source ORDER BY id`).toEqual([{ id: 1 }]);
  expect(await a.insw_queue_cycle.count()).toBe(1);
});

test('atomic claim has one winner; stale tokens and invalid transitions cannot mutate state', async () => {
  await enqueueExisting(a, fixture());
  queries = [];
  const results = await Promise.all([claimJob(a, 60000), claimJob(b, 60000)]);
  const claimQueries = [...queries];
  expect(results.filter(Boolean)).toHaveLength(1);
  const c = results.find(Boolean)!;
  expect(await a.insw_queue_attempt.count()).toBe(1);
  const claimSql = claimQueries.find(q => q.includes('WITH candidate'))!;
  expect(claimSql).toContain('SKIP LOCKED LIMIT 1');
  expect(claimSql).not.toContain('frozen_payload');
  expect(claimQueries.filter(q => !/^(BEGIN|COMMIT|ROLLBACK)/.test(q)).length).toBeLessThanOrEqual(3);
  await expect(transition(b, { ...c, owner_token: '00000000-0000-4000-8000-000000000099' }, 'MARK_POSSIBLE_START')).rejects.toThrow('Stale');
  await expect(transition(b, c, 'FINALIZE_SUCCESS')).rejects.toThrow('invalid transition');
  await transition(a, c, 'MARK_POSSIBLE_START');
  await transition(b, c, 'RECORD_REMOTE_SUCCESS');
  expect(await a.insw_queue_cycle.findUnique({ where: { id: c.id }, select: { status: true, delivery_state: true } })).toEqual({ status: 'REMOTE_SUCCEEDED', delivery_state: 'KNOWN_SUCCESS' });
  // Local success finalization and future domain updates share a transaction.
  await a.$transaction(tx => transitionInTransaction(tx, c, 'FINALIZE_SUCCESS'));
  await expect(transition(a, c, 'FINALIZE_SUCCESS')).rejects.toThrow('Stale');
  expect(await claimJob(a, 60000)).toBeNull();
});

test('due selection skips delayed and held jobs and uses monotonic sequence tails', async () => {
  const delayed = await enqueueExisting(a, fixture('delayed'));
  await a.$executeRaw`UPDATE insw_queue_cycle SET next_eligible_at = clock_timestamp() + interval '1 day' WHERE id = ${delayed.id}::uuid`;
  const held = await enqueueExisting(a, fixture('held'));
  await transition(a, await claimed(), 'HOLD_DISABLED');
  const first = await enqueueExisting(a, fixture('first'));
  const reserved = await a.$transaction(tx => reserveTail(tx));
  const second = await enqueueExisting(a, fixture('second'));
  expect(delayed.tail_key < held.tail_key && held.tail_key < first.tail_key && first.tail_key < reserved && reserved < second.tail_key).toBe(true);
  expect((await claimed()).id).toBe(first.id);
  expect((await claimed()).id).toBe(second.id);
  expect(await claimJob(a, 60000)).toBeNull();
});

test('expiry distinguishes pre-send, unknown delivery and known success; all remain held', async () => {
  for (const state of ['NOT_STARTED', 'POSSIBLY_STARTED', 'KNOWN_SUCCESS'] as const) {
    const input = fixture(state);
    await enqueueExisting(a, input);
    const c = await claimed();
    if (state !== 'NOT_STARTED') await transition(a, c, 'MARK_POSSIBLE_START');
    if (state === 'KNOWN_SUCCESS') await transition(a, c, 'RECORD_REMOTE_SUCCESS');
    await expire(c);
    await expect(transition(a, c, state === 'KNOWN_SUCCESS' ? 'FINALIZE_SUCCESS' : 'MARK_POSSIBLE_START')).rejects.toThrow('expired lease');
  }
  expect(await holdExpiredClaims(a, 2)).toHaveLength(2);
  expect(await holdExpiredClaims(b, 2)).toHaveLength(1);
  const rows = await a.insw_queue_cycle.findMany({ select: { status: true, hold_reason: true, delivery_state: true } });
  expect(rows.map(r => r.hold_reason).sort()).toEqual(['DELIVERY_UNKNOWN', 'LOCAL_FINALIZATION_REQUIRED', 'PRE_SEND_LEASE_EXPIRED']);
  expect(rows.every(r => r.status === 'HELD')).toBe(true);
  expect(await claimJob(a, 60000)).toBeNull();
  expect(await enqueueExisting(b, fixture('KNOWN_SUCCESS'))).toMatchObject({ created: false, status: 'HELD' });
});

test('explicit unknown hold, immutable payload and nullable log linkage preserve old history', async () => {
  const job = await enqueueExisting(a, fixture());
  const c = await claimed();
  await transition(a, c, 'MARK_POSSIBLE_START');
  await transition(a, c, 'HOLD_UNKNOWN', { category: 'TRANSPORT', code: 'UNCERTAIN', message: 'Delivery requires reconciliation' });
  expect(await a.insw_queue_cycle.findUnique({ where: { id: job.id }, select: { status: true, hold_reason: true } })).toEqual({ status: 'HELD', hold_reason: 'DELIVERY_UNKNOWN' });
  await expect(a.insw_queue_cycle.update({ where: { id: job.id }, data: { frozen_payload: { changed: true } } })).rejects.toThrow();
  await a.insw_tracking_log.create({ data: { transaction_type: 'outgoing', company_code: 1370, queue_attempt_id: c.attemptId, insw_status: 'FAILED' } });
  const attempt = await a.insw_queue_attempt.findUnique({ where: { id: c.attemptId }, include: { logs: true, queue: { select: { cycle: true } } } });
  expect(attempt?.logs).toHaveLength(1);
  expect(attempt?.queue.cycle).toBe(1);
  expect(await a.insw_tracking_log.findUnique({ where: { id: BigInt(77) }, select: { insw_status: true, queue_attempt_id: true } })).toEqual({ insw_status: 'LEGACY_CUSTOM', queue_attempt_id: null });
});
