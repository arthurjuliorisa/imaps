import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import type { Session } from 'next-auth';
import { intervalSettingsRequest } from '../lib/insw-queue/interval-settings-http';
import { readPolicy } from '../lib/insw-queue/policy.repository';
import { updateInterval } from '../lib/insw-queue/interval-settings';

const url = process.env.INSW_SETTINGS_TEST_DATABASE_URL;
test.skip(!url, 'Explicit new empty local *_insw_settings_test database required');
test.describe.configure({ mode: 'serial' });
let db: PrismaClient;
const admin = { user: { id: 'isolated-admin', role: 'ADMIN' }, expires: '' } as Session;
const patch = (intervalMs: number, expectedVersion: number) => intervalSettingsRequest(new Request('http://localhost/api/insw/queue-settings', {
  method: 'PATCH', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ intervalMs, expectedVersion, reason: 'Isolated interval acceptance' }),
}), admin, db);

test.beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !['localhost', '127.0.0.1'].includes(parsed.hostname) || !/^\/[a-z0-9_]+_insw_settings_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Unsafe test database URL');
  db = new PrismaClient({ datasources: { db: { url } } });
  const [state] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  if (state.count !== BigInt(0)) throw new Error('Refusing nonempty database');
  const migration = readFileSync('prisma/migrations/20261022000000_insw_queue_foundation/migration.sql', 'utf8');
  for (const table of ['insw_transmission_policy', 'insw_policy_change']) {
    const sql = migration.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`))![0];
    await db.$executeRawUnsafe(sql);
  }
  const constraint = migration.match(/ALTER TABLE "insw_transmission_policy"[\s\S]*?version > 0\);/)![0];
  await db.$executeRawUnsafe(constraint);
  await db.insw_transmission_policy.create({ data: { id: 1, min_processing_interval_ms: 3600, max_auto_retry: 7, version: 1, updated_by: 'isolated-fixture', change_reason: 'Isolated fixture' } });
});
test.afterAll(async () => { await db?.$disconnect(); });

test('isolated update preserves nonzero retry, increments version and atomically audits', async () => {
  const before = await readPolicy(db);
  expect(before).toMatchObject({ min_processing_interval_ms: 3600, max_auto_retry: 7, version: 1 });
  const response = await patch(5000, before.version);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ data: { intervalMs: 5000, version: 2, updatedBy: 'isolated-admin' } });
  expect(await readPolicy(db)).toMatchObject({ min_processing_interval_ms: 5000, max_auto_retry: 7, version: 2 });
  expect(await db.insw_policy_change.findUnique({ where: { version: 2 } })).toMatchObject({ min_processing_interval_ms: 5000, max_auto_retry: 7, changed_by: 'isolated-admin' });
});

test('stale version returns 409 without an audit or policy mutation', async () => {
  const before = await readPolicy(db); const count = await db.insw_policy_change.count();
  expect((await patch(6000, before.version - 1)).status).toBe(409);
  expect(await readPolicy(db)).toEqual(before); expect(await db.insw_policy_change.count()).toBe(count);
});

test('two concurrent edits produce exactly one success and one conflict, preserving retry', async () => {
  const before = await readPolicy(db); const count = await db.insw_policy_change.count();
  const responses = await Promise.all([patch(6000, before.version), patch(7000, before.version)]);
  expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
  const after = await readPolicy(db);
  expect(after.version).toBe(before.version + 1); expect(after.max_auto_retry).toBe(7);
  expect([6000, 7000]).toContain(after.min_processing_interval_ms);
  expect(await db.insw_policy_change.count()).toBe(count + 1);
});

test('floor and maximum save successfully; rejected payloads leave both policy and audit unchanged', async () => {
  for (const intervalMs of [3600, 2147483647]) {
    const before = await readPolicy(db);
    expect((await patch(intervalMs, before.version)).status).toBe(200);
    expect((await readPolicy(db)).max_auto_retry).toBe(7);
  }
  const before = await readPolicy(db); const count = await db.insw_policy_change.count();
  expect((await patch(3599, before.version)).status).toBe(400);
  const crafted = new Request('http://localhost/api/insw/queue-settings', { method: 'PATCH', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: JSON.stringify({ intervalMs: 9000, expectedVersion: before.version, reason: 'Crafted', max_auto_retry: 0 }) });
  expect((await intervalSettingsRequest(crafted, admin, db)).status).toBe(400);
  expect(await readPolicy(db)).toEqual(before); expect(await db.insw_policy_change.count()).toBe(count);
});

test('audit failure rolls back policy interval, version and retained retry together', async () => {
  const before = await readPolicy(db);
  // Deliberately occupy the next audit version in this disposable database.
  await db.insw_policy_change.create({ data: { version: before.version + 1, min_processing_interval_ms: before.min_processing_interval_ms,
    max_auto_retry: 7, changed_by: 'isolated-collision', reason: 'Test transactional rollback' } });
  const count = await db.insw_policy_change.count();
  await expect(updateInterval(db, { intervalMs: 9000, expectedVersion: before.version, reason: 'Must roll back' }, 'isolated-admin')).rejects.toThrow();
  expect(await readPolicy(db)).toEqual(before);
  expect(await db.insw_policy_change.count()).toBe(count);
});
