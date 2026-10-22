import { test, expect } from '@playwright/test';
import { Prisma, PrismaClient } from '@prisma/client';
import { ChildProcess, execFileSync, spawn } from 'node:child_process';
import { createServer, request, Server, ServerResponse } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { enqueueExisting, claimJob, holdExpiredClaims, transition } from '../lib/insw-queue/queue.repository';
import { freezePayload } from '../lib/insw-queue/contracts';
import { executeFrozenRequest } from '../lib/insw-worker/transport';
import { acquireStickyOwnership } from '../lib/insw-worker/ownership.repository';

// Protocol probes only: passing negative tests demonstrates why activation stays
// blocked. Sticky probe success does NOT certify a production dispatcher/restart.
test.describe.configure({ mode: 'serial', timeout: 60000 });
const url = process.env.INSW_WORKER_TEST_DATABASE_URL;
test.skip(!url, 'Requires a NEW EMPTY local *_phase_c1_test database');
let db: PrismaClient;
let server: Server;
let endpoint: string;
let responses: ServerResponse[] = [];
let arrivals: number[] = [];
let beganAt = 0;
let children: ChildProcess[] = [];
type Message = { event: string; claim?: { id: string; owner_token: string }; token?: string; pid?: number; outcome?: unknown };
const inbox = new Map<ChildProcess, Message[]>();
const output = new Map<ChildProcess, string[]>();

function launch(topology: 'lease' | 'sticky', marker = true, timeout = false) {
  // Load TS in the actual signalled process; a tsx CLI supervisor would leave
  // SIGSTOP/SIGKILL targeting its wrapper instead of the process issuing HTTP.
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/test-fixtures/insw-ownership-process.ts'], {
    // Intentionally do not inherit application DB credentials or INSW secrets.
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  children.push(child); inbox.set(child, []); output.set(child, []);
  child.on('message', message => inbox.get(child)!.push(message as Message));
  for (const stream of [child.stdout, child.stderr]) stream?.on('data', chunk => output.get(child)!.push(String(chunk)));
  child.send({ action: 'init', url, endpoint, topology, marker, timeout });
  return child;
}
async function event(child: ChildProcess, name: string) {
  await expect.poll(() => inbox.get(child)?.map(m => m.event), { timeout: 15000 }).toContain(name);
  return inbox.get(child)!.find(m => m.event === name)!;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('close', () => resolve()));
  child.kill('SIGKILL'); // Also kills a SIGSTOP-paused process; no resume window.
  await exited;
}
async function pause(child: ChildProcess) {
  expect(child.kill('SIGSTOP')).toBe(true);
  // Linux /proc confirms the actual HTTP process stopped, not merely that a
  // signal was queued. These tests intentionally require Linux/PostgreSQL.
  await expect.poll(() => readFileSync(`/proc/${child.pid}/status`, 'utf8').match(/^State:\s+(\w)/m)?.[1]).toBe('T');
  child.send({ action: 'send' });
}
async function forceExpiry(id?: string) {
  await db.$executeRaw`UPDATE insw_dispatch_gate SET lease_until = clock_timestamp() - interval '1 second' WHERE id = 1`;
  if (id) await db.$executeRaw`UPDATE insw_queue_cycle SET lease_until = clock_timestamp() - interval '1 second' WHERE id = ${id}::uuid`;
}
async function jobs() {
  for (const reference of ['A', 'B']) await enqueueExisting(db, {
    identity: { companyCode: 1370, kind: 'WMS_REFERENCE', operation: 'OUTGOING', reference, revision: '1', businessDate: '2026-10-22' },
    payload: { documents: [{ reference }] }, intent: 'SOURCE_COMMIT', requestedBy: 'ownership-test',
  });
}

test.beforeAll(async () => {
  if (!url) return;
  const parsed = new URL(url);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.hostname !== '127.0.0.1'
    || !/^\/[a-z0-9_]+_phase_c1_test$/.test(parsed.pathname) || parsed.search || parsed.hash) throw new Error('Unsafe test database');
  db = new PrismaClient({ datasources: { db: { url } } });
  const [state] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  if (state.count !== BigInt(0)) throw new Error('Refusing nonempty database');
  const directory = mkdtempSync('/tmp/imaps-c1-ownership-schema-');
  const schemaFile = join(directory, 'baseline.prisma');
  writeFileSync(schemaFile, readFileSync('prisma/schema.prisma', 'utf8').split('// Dormant Phase B persistence.')[0]
    .replace(/^.*queue_attempt_id.*\n/gm, '').replace(/^.*queue_attempt\s+insw_queue_attempt.*\n/gm, ''));
  const baseline = execFileSync('node_modules/.bin/prisma', ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schemaFile, '--script'], {
    env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8',
  });
  const sqlFile = join(directory, 'bootstrap.sql');
  writeFileSync(sqlFile, baseline + readFileSync('prisma/migrations/20261022000000_insw_queue_foundation/migration.sql', 'utf8')
    + readFileSync('prisma/migrations/20261022010000_insw_worker_recovery/migration.sql', 'utf8'));
  execFileSync('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', '-f', sqlFile], { stdio: 'pipe' });
  server = createServer((incoming, response) => { incoming.resume(); responses.push(response); arrivals.push(Date.now() - beganAt); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/mock`;
});
test.beforeEach(async () => {
  responses = []; arrivals = []; beganAt = Date.now(); children = [];
  await db.insw_queue_attempt.deleteMany();
  await db.insw_queue_cycle.deleteMany();
  // Test fixture reset only, NEVER an operational takeover procedure.
  await db.$executeRaw`UPDATE insw_dispatch_gate SET owner_token = NULL, lease_until = NULL, last_started_at = NULL WHERE id = 1`;
  await jobs();
});
test.afterEach(async () => {
  const evidencePath = test.info().outputPath('loopback-http-evidence.json');
  writeFileSync(evidencePath, JSON.stringify({
    test: test.info().title, receivedAfterTestStartMs: arrivals,
    openResponsesAtAssertionEnd: responses.filter(response => !response.writableEnded).length,
    childEvents: children.map(child => inbox.get(child)?.map(message => message.event)),
  }, null, 2));
  await test.info().attach('loopback-http-evidence', { contentType: 'application/json', path: evidencePath });
  await Promise.all(children.map(stop));
  for (const response of responses) response.destroy();
  for (const child of children) {
    expect(output.get(child)?.join('')).toBe('');
    inbox.delete(child); output.delete(child);
  }
});
test.afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await db?.$disconnect();
});

test('counterexample: expired global lease permits overlapping real HTTP after SIGSTOP/resume', async () => {
  const a = launch('lease'); const readyA = await event(a, 'ready');
  await pause(a);
  await forceExpiry();
  const b = launch('lease'); const readyB = await event(b, 'ready');
  expect(readyA.claim!.id).not.toBe(readyB.claim!.id);
  b.send({ action: 'send' });
  await expect.poll(() => responses.length).toBe(1);
  expect(await db.$queryRaw`UPDATE insw_dispatch_gate SET last_started_at = clock_timestamp()
    WHERE id = 1 AND owner_token = ${readyA.token}::uuid RETURNING id`).toEqual([]);
  a.kill('SIGCONT');
  await expect.poll(() => responses.length).toBe(2);
  expect(responses.every(response => !response.writableEnded)).toBe(true);
  for (const response of responses) response.end('{"status":true}');
  await Promise.all([event(a, 'finished'), event(b, 'finished')]);
});

test('sticky protocol probe denies second process across pause, DB session loss, crash and restart', async () => {
  const a = launch('sticky'); const ready = await event(a, 'ready');
  await pause(a);
  await forceExpiry();
  await db.$queryRaw`SELECT pg_terminate_backend(${ready.pid}::integer)`;
  const b = launch('sticky'); await event(b, 'blocked');
  expect(responses).toHaveLength(0);
  a.kill('SIGCONT');
  await expect.poll(() => responses.length).toBe(1);
  await stop(a); // Response/outcome deliberately unknown, not drained.
  const c = launch('sticky'); await event(c, 'blocked');
  expect(responses).toHaveLength(1);
  expect(await db.insw_dispatch_gate.findUnique({ where: { id: 1 } })).toMatchObject({ owner_token: ready.token });
  await forceExpiry(ready.claim!.id);
  expect(await holdExpiredClaims(db)).toEqual([{ id: ready.claim!.id, deliveryState: 'POSSIBLY_STARTED' }]);
  await expect(transition(db, ready.claim!, 'RECORD_REMOTE_SUCCESS')).rejects.toThrow('Stale');
});

test('actual process crashes before vs after marker retain distinct held evidence and never requeue it', async () => {
  for (const marker of [false, true]) {
    const child = launch('sticky', marker); const ready = await event(child, 'ready');
    await stop(child);
    await forceExpiry(ready.claim!.id);
    await holdExpiredClaims(db);
    expect(await db.insw_queue_cycle.findUnique({ where: { id: ready.claim!.id }, select: { status: true, hold_reason: true } })).toEqual({
      status: 'HELD', hold_reason: marker ? 'DELIVERY_UNKNOWN' : 'PRE_SEND_LEASE_EXPIRED',
    });
    const restarted = launch('sticky'); await event(restarted, 'blocked');
    // Fixture reset after confirmed process death, not automatic recovery code.
    await db.$executeRaw`UPDATE insw_dispatch_gate SET owner_token = NULL, lease_until = NULL WHERE id = 1`;
  }
  expect(await claimJob(db, 60000)).toBeNull();
  expect(responses).toHaveLength(0);
});

test('counterexample: bounded local timeout does not end real HTTP when primitive ignores AbortSignal', async () => {
  const payload = { documents: [] };
  const pending = new Set<ReturnType<typeof request>>();
  const primitive = () => new Promise<Response>((resolve, reject) => {
    const outgoing = request(endpoint, { method: 'POST' }, response => {
      response.resume(); response.on('end', () => resolve(new Response('{"status":true}')));
    });
    pending.add(outgoing); outgoing.on('error', reject); outgoing.on('close', () => pending.delete(outgoing)); outgoing.end('{}');
  });
  try {
    const input = { payload, sha256: freezePayload(payload).sha256, request: primitive, timeoutMs: 200 };
    expect(await executeFrozenRequest(input)).toMatchObject({ delivery: 'POSSIBLY_STARTED', errorClass: 'TIMEOUT' });
    await expect.poll(() => responses.length).toBe(1);
    expect(responses[0].writableEnded).toBe(false);
    expect(await executeFrozenRequest(input)).toMatchObject({ delivery: 'POSSIBLY_STARTED', errorClass: 'TIMEOUT' });
    await expect.poll(() => responses.length).toBe(2);
    expect(responses.every(response => !response.writableEnded)).toBe(true);
  } finally { for (const outgoing of pending) outgoing.destroy(); }
});

test('simultaneous independent sticky launches admit only one HTTP process across different queued jobs', async () => {
  const contenders = [launch('sticky'), launch('sticky')];
  await expect.poll(() => contenders.flatMap(child => inbox.get(child)!.map(m => m.event)).sort()).toEqual(['blocked', 'ready']);
  const owner = contenders.find(child => inbox.get(child)!.some(m => m.event === 'ready'))!;
  owner.send({ action: 'send' });
  await expect.poll(() => responses.length).toBe(1);
  expect(await db.insw_queue_cycle.count({ where: { status: 'READY' } })).toBe(1);
  responses[0].end('{"status":true}');
  await event(owner, 'finished');
  const replacement = launch('sticky'); await event(replacement, 'blocked');
  expect(responses).toHaveLength(1);
});

test('sticky denial survives a local timeout while the abort-ignoring HTTP primitive remains active', async () => {
  const owner = launch('sticky', true, true); const ready = await event(owner, 'ready');
  owner.send({ action: 'send' });
  expect((await event(owner, 'timeout')).outcome).toMatchObject({ errorClass: 'TIMEOUT', delivery: 'POSSIBLY_STARTED', autoRetry: false });
  await expect.poll(() => responses.length).toBe(1);
  expect(responses[0].writableEnded).toBe(false);
  await forceExpiry(ready.claim!.id);
  const replacement = launch('sticky'); await event(replacement, 'blocked');
  expect(responses).toHaveLength(1);
  expect(await db.insw_queue_cycle.count({ where: { status: 'READY' } })).toBe(1);
  expect(await holdExpiredClaims(db)).toEqual([{ id: ready.claim!.id, deliveryState: 'POSSIBLY_STARTED' }]);
});

test('PM2-like graceful SIGTERM retains ownership and queue; restart requires maintenance', async () => {
  const owner = launch('sticky', false); const ready = await event(owner, 'ready');
  const exited = new Promise<void>(resolve => owner.once('close', () => resolve()));
  owner.kill('SIGTERM'); await exited;
  expect(owner.exitCode).toBe(0);
  const replacement = launch('sticky'); await event(replacement, 'blocked');
  expect(await db.insw_dispatch_gate.findUnique({ where: { id: 1 } })).toMatchObject({ owner_token: ready.token });
  expect(await db.insw_queue_cycle.count()).toBe(2);
  expect(await db.insw_queue_cycle.count({ where: { status: 'READY' } })).toBe(1);
  expect(responses).toHaveLength(0);
});

test('sticky acquisition fails closed on missing policy, missing gate, orphaned timing and DB outage', async () => {
  const policy = await db.insw_transmission_policy.findUniqueOrThrow({ where: { id: 1 } });
  await db.insw_transmission_policy.delete({ where: { id: 1 } });
  await expect(acquireStickyOwnership(db)).rejects.toThrow('policy missing');
  await db.insw_transmission_policy.create({ data: policy });
  await db.$executeRaw`UPDATE insw_dispatch_gate SET last_started_at = clock_timestamp() WHERE id = 1`;
  await expect(acquireStickyOwnership(db)).rejects.toThrow('MAINTENANCE_REQUIRED');
  await db.$executeRaw`UPDATE insw_dispatch_gate SET last_started_at = NULL WHERE id = 1`;
  await expect(db.$executeRaw`UPDATE insw_dispatch_gate SET lease_until = clock_timestamp() WHERE id = 1`).rejects.toThrow();
  const gate = await db.insw_dispatch_gate.findUniqueOrThrow({ where: { id: 1 } });
  await db.insw_dispatch_gate.delete({ where: { id: 1 } });
  await expect(acquireStickyOwnership(db)).rejects.toThrow('MAINTENANCE_REQUIRED');
  await db.insw_dispatch_gate.create({ data: { ...gate, process_identity: gate.process_identity === null ? Prisma.DbNull : gate.process_identity } });
  const unavailable = new PrismaClient({ datasources: { db: { url: 'postgresql://synthetic@127.0.0.1:1/unavailable_phase_c1_test?connect_timeout=1' } } });
  try { await expect(acquireStickyOwnership(unavailable)).rejects.toThrow(); }
  finally { await unavailable.$disconnect(); }
  expect(responses).toHaveLength(0);
});
