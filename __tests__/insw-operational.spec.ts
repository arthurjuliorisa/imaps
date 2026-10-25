import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { spawn, ChildProcess, execFileSync } from 'node:child_process';
import { createServer, request, Server, ServerResponse } from 'node:http';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { enqueueExisting } from '../lib/insw-queue/queue.repository';
import { readPolicy, updatePolicy } from '../lib/insw-queue/policy.repository';
import { acquireOperationalOwnership, admitNext, recoverOperationalOwnership, finalizeSyntheticSuccess } from '../lib/insw-worker/operational.repository';
import { runIsolatedWorker, isolatedDatabaseUrl } from '../lib/insw-worker/isolated-worker';

const url = process.env.INSW_OPERATIONAL_TEST_DATABASE_URL;
test.skip(!url, 'Needs new empty local *_phase_c1_test database');
let db: PrismaClient; let server: Server; let endpoint: string;
let children: ChildProcess[] = []; let responses: ServerResponse[] = [];
let arrivals: { at: number; document: string; body: string }[] = [];
let handler: (response: ServerResponse, document: string) => void;
const messages = new Map<ChildProcess, { event: string; data?: { token?: string } }[]>();
let queryCount = 0;
async function policy(interval = 1, retries = 0) {
  const p = await readPolicy(db);
  await updatePolicy(db, p.version, { min_processing_interval_ms: interval, max_auto_retry: retries }, 'isolated-test', 'Synthetic acceptance');
}
async function enqueue(document: string) {
  await db.outgoing_goods.create({ data: { company_code: 1370, owner: 1370, wms_id: document,
    outgoing_date: new Date('2026-10-22'), ppkek_number: 'N', is_non_facility: true, outgoing_evidence_number: 'N',
    invoice_number: 'INV', invoice_date: new Date('2026-10-22'), recipient_name: 'Synthetic', timestamp: new Date() } });
  return enqueueExisting(db, { identity: { kind: 'WMS_REFERENCE', companyCode: 1370, operation: 'OUTGOING',
    reference: document, revision: 'ACCEPTED_WMS_ID', businessDate: '2026-10-22' }, intent: 'SOURCE_COMMIT', requestedBy: 'synthetic-test',
    payload: { data: [{ dokumenKegiatan: [{ nomorDokKegiatan: document }] }] } });
}
function launch(timeout = 10000) {
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/insw-isolated-worker.ts'], {
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', INSW_ISOLATED_WORKER_ENABLED: 'true',
      INSW_WORKER_TEST_DATABASE_URL: url, INSW_SYNTHETIC_ENDPOINT: endpoint, INSW_SYNTHETIC_TIMEOUT_MS: String(timeout) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  messages.set(child, []); children.push(child);
  child.on('message', message => messages.get(child)!.push(message as never));
  return child;
}
async function event(child: ChildProcess, name: string) {
  await expect.poll(() => messages.get(child)?.some(message => message.event === name), { timeout: 15000 }).toBe(true);
  return messages.get(child)!.find(message => message.event === name)!;
}
async function reap(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const done = new Promise<void>(resolve => child.once('close', () => resolve()));
  child.kill(signal); await done;
}
async function recover(token: string) {
  return recoverOperationalOwnership(db, { expectedToken: token, operator: 'test-operator',
    evidence: 'Test supervisor disabled; child close/reap observed; adapter creates no children', shutdownAcknowledged: true });
}
async function finished(count: number) {
  await expect.poll(() => db.insw_queue_attempt.count({ where: { completed_at: { not: null } } }), { timeout: 50000 }).toBe(count);
}

test.beforeAll(async () => {
  if (!url) return;
  isolatedDatabaseUrl({ NODE_ENV: 'test', INSW_ISOLATED_WORKER_ENABLED: 'true', INSW_WORKER_TEST_DATABASE_URL: url });
  const instrumented = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  instrumented.$on('query', () => queryCount++); db = instrumented;
  const [state] = await db.$queryRaw<{ count: bigint }[]>`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'`;
  if (state.count !== BigInt(0)) throw new Error('NEW_EMPTY_DATABASE_REQUIRED');
  const dir = mkdtempSync('/tmp/imaps-operational-schema-');
  const schema = `${dir}/baseline.prisma`;
  writeFileSync(schema, readFileSync('prisma/schema.prisma', 'utf8').split('// Dormant Phase B persistence.')[0]
    .replace(/^.*queue_attempt_id.*\n/gm, '').replace(/^.*queue_attempt\s+insw_queue_attempt.*\n/gm, ''));
  const baseline = execFileSync('node_modules/.bin/prisma', ['migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script'],
    { env: { ...process.env, DATABASE_URL: url }, encoding: 'utf8' });
  writeFileSync(`${dir}/bootstrap.sql`, baseline
    + readFileSync('prisma/migrations/20261022000000_insw_queue_foundation/migration.sql', 'utf8')
    + readFileSync('prisma/migrations/20261022010000_insw_worker_recovery/migration.sql', 'utf8'));
  execFileSync('psql', [url, '-X', '-v', 'ON_ERROR_STOP=1', '-f', `${dir}/bootstrap.sql`], { stdio: 'pipe' });
  await db.companies.create({ data: { code: 1370, name: 'Fixture SEZ', company_type: 'SEZ' } });
  server = createServer((incoming, response) => {
    let body = '';
    incoming.on('data', chunk => { body += chunk; });
    incoming.on('end', () => {
      const document = JSON.parse(body).data[0].dokumenKegiatan[0].nomorDokKegiatan;
      arrivals.push({ at: Date.now(), document, body }); responses.push(response); handler(response, document);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/synthetic`;
});
test.beforeEach(async () => {
  children = []; responses = []; arrivals = [];
  handler = response => response.end('{"status":true}');
  await db.$executeRaw`UPDATE insw_dispatch_gate SET busy_attempt_id = NULL, owner_token = NULL, lease_until = NULL,
    last_started_at = NULL, recovery_barrier_at = NULL, prior_interval_ms = NULL, process_identity = NULL WHERE id = 1`;
  await db.insw_tracking_log.deleteMany(); await db.insw_queue_attempt.deleteMany(); await db.insw_queue_cycle.deleteMany();
  await db.outgoing_goods.deleteMany();
  await policy();
});
test.afterEach(async () => {
  const processSamples = children.flatMap(child => {
    try {
      const status = readFileSync(`/proc/${child.pid}/status`, 'utf8');
      const stat = readFileSync(`/proc/${child.pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
      return [{ pid: child.pid, rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1] ?? 0),
        userCpuTicks: Number(fields[11]), systemCpuTicks: Number(fields[12]) }];
    } catch { return []; }
  });
  await Promise.all(children.map(child => reap(child, 'SIGKILL')));
  for (const response of responses) response.destroy();
  writeFileSync(test.info().outputPath('evidence.json'), JSON.stringify({ arrivals, processSamples,
    events: children.map(child => messages.get(child)) }, null, 2));
});
test.afterAll(async () => {
  server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  await db?.$disconnect();
});

test('concurrent processes serialize; paused owner cannot be recovered; reaped owner rotates token', async () => {
  await enqueue('A'); await enqueue('B'); handler = () => {};
  const contenders = [launch(), launch()];
  await expect.poll(() => contenders.filter(c => messages.get(c)!.some(m => m.event === 'owned')).length).toBe(1);
  const owner = contenders.find(c => messages.get(c)!.some(m => m.event === 'owned'))!;
  const token = (await event(owner, 'owned')).data!.token!;
  await expect.poll(() => arrivals.length).toBe(1);
  owner.kill('SIGSTOP');
  await expect.poll(() => readFileSync(`/proc/${owner.pid}/status`, 'utf8').match(/^State:\s+(\w)/m)?.[1]).toBe('T');
  await expect(recover(token)).rejects.toThrow('NOT_REAPED');
  expect(arrivals.length).toBe(1);
  owner.kill('SIGCONT'); await reap(owner, 'SIGKILL');
  await recover(token);
  handler = response => response.end('{"status":true}');
  const replacement = launch();
  expect((await event(replacement, 'owned')).data!.token).not.toBe(token);
  await expect.poll(() => arrivals.length).toBe(2); await finished(2);
  expect(await db.insw_queue_cycle.count({ where: { status: 'HELD', hold_reason: 'DELIVERY_UNKNOWN' } })).toBe(1);
  expect(await db.insw_worker_recovery.count({ where: { old_owner_token: token } })).toBe(1);
});

for (const duration of [2600, 5000]) test(`persisted 3600ms spacing after ${duration}ms response`, async () => {
  await policy(3600); await enqueue('A'); await enqueue('B');
  handler = (response, document) => setTimeout(() => response.end('{"status":true}'), document === 'A' ? duration : 0);
  const worker = launch(); await event(worker, 'owned'); await finished(2);
  const delta = arrivals[1].at - arrivals[0].at;
  expect(delta).toBeGreaterThanOrEqual(Math.max(3600, duration) - 10);
  expect(delta).toBeLessThan(Math.max(3600, duration) + 1500);
});

test('graceful stop/reap and recovery preserve empty-queue interval and reread increased policy', async () => {
  await policy(3600); await enqueue('A'); const first = launch();
  const token = (await event(first, 'owned')).data!.token!; await finished(1);
  await reap(first); expect(first.exitCode).toBe(0);
  const before = await db.insw_dispatch_gate.findUniqueOrThrow({ where: { id: 1 } });
  await recover(token);
  const after = await db.insw_dispatch_gate.findUniqueOrThrow({ where: { id: 1 } });
  expect(after.last_started_at).toEqual(before.last_started_at); expect(after.prior_interval_ms).toBe(3600);
  await enqueue('B'); const second = launch(); await event(second, 'owned');
  await policy(4500);
  await finished(2);
  expect(arrivals[1].at - arrivals[0].at).toBeGreaterThanOrEqual(4490);
});

test('retry-to-tail B,C,D,A with frozen identity and linked sanitized evidence', async () => {
  await policy(20, 1); for (const id of ['A', 'B', 'C', 'D']) await enqueue(id);
  handler = (response, document) => {
    if (document === 'A' && arrivals.filter(a => a.document === 'A').length === 1) { response.statusCode = 503; response.end('{"status":false,"secret":"DO_NOT_STORE"}'); }
    else response.end('{"status":true}');
  };
  launch(); await finished(5);
  expect(arrivals.map(a => a.document)).toEqual(['A', 'B', 'C', 'D', 'A']);
  expect(arrivals[0].body).toBe(arrivals[4].body);
  const logs = await db.insw_tracking_log.findMany({ include: { queue_attempt: true } });
  expect(logs).toHaveLength(5); expect(logs.every(l => l.queue_attempt !== null)).toBe(true);
  expect(JSON.stringify(logs, (_, value) => typeof value === 'bigint' ? String(value) : value)).not.toContain('DO_NOT_STORE');
});

for (const maximum of [0, 10]) test(`persisted retry snapshot ${maximum} permits ${maximum + 1} total invocations`, async () => {
  await policy(1, maximum); await enqueue('A'); await policy(1, maximum === 0 ? 10 : 0);
  handler = response => { response.statusCode = 503; response.end('{"status":false}'); };
  launch(); await finished(maximum + 1);
  expect(arrivals).toHaveLength(maximum + 1);
  expect(await db.insw_queue_cycle.findFirst()).toMatchObject({ status: 'FAILED', retry_index: maximum, max_auto_retry_snapshot: maximum });
});

test('duplicate possibility holds; mismatched document stays UNKNOWN; auth and validation never retry', async () => {
  await policy(1, 10); for (const id of ['duplicate', 'mismatch', 'auth', 'validation']) await enqueue(id);
  handler = (response, document) => {
    response.statusCode = document === 'auth' ? 401 : document === 'validation' ? 422 : 400;
    response.end(JSON.stringify({ status: false, code: '02', message: `Atas nomor dokumen kegiatan ${document === 'mismatch' ? 'other' : document} sudah pernah dikirim` }));
  };
  launch(); await finished(4);
  const rows = await db.insw_queue_cycle.findMany({ orderBy: { tail_key: 'asc' } });
  expect(rows.map(r => [r.status, r.error_category])).toEqual([
    ['HELD', 'DUPLICATE_POSSIBILITY'], ['HELD', 'UNKNOWN'], ['FAILED', 'PERMANENT_FAILURE'], ['FAILED', 'PERMANENT_FAILURE'],
  ]);
});

test('abort-cooperative real HTTP timeout drains socket before retry; bounded max=1', async () => {
  await policy(10, 1); await enqueue('A'); handler = () => {};
  launch(200); await finished(2);
  expect(arrivals).toHaveLength(2);
  expect(await db.insw_queue_cycle.findFirst()).toMatchObject({ status: 'FAILED', error_code: 'REQUEST_TIMEOUT' });
});

test('abort-ignoring invocation holds busy after timeout; no next HTTP until it actually settles', async () => {
  await policy(1, 1); await enqueue('A'); await enqueue('B'); handler = () => {};
  const stop = new AbortController(); let bounded = false;
  const running = runIsolatedWorker({ db, signal: stop.signal, timeoutMs: 100, maxJobs: 2,
    onEvent: event => { if (event === 'boundedOutcome') bounded = true; },
    request: body => new Promise<Response>((resolve, reject) => {
      const outgoing = request(endpoint, { method: 'POST' }, response => {
        response.resume(); response.on('end', () => resolve(new Response('{"status":true}')));
      }); outgoing.on('error', reject); outgoing.end(body);
    }),
  });
  await expect.poll(() => bounded).toBe(true); expect(arrivals).toHaveLength(1);
  expect((await db.insw_dispatch_gate.findUniqueOrThrow({ where: { id: 1 } })).busy_attempt_id).not.toBeNull();
  await new Promise(resolve => setTimeout(resolve, 250)); expect(arrivals).toHaveLength(1);
  handler = response => response.end('{"status":true}'); responses[0].end('{"status":true}');
  await running;
  expect(arrivals.map(a => a.document)).toEqual(['A', 'B']);
});

test('known success local-finalization failure never resends; repair is local and owner checked', async () => {
  const job = await enqueue('A'); const worker = launch();
  const token = (await event(worker, 'owned')).data!.token!; await finished(1);
  await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_finalization() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW.status = 'SUCCEEDED' THEN RAISE EXCEPTION 'synthetic local finalization outage'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER test_reject_finalization BEFORE UPDATE ON insw_queue_cycle FOR EACH ROW EXECUTE FUNCTION test_reject_finalization()');
  await expect(finalizeSyntheticSuccess(db, token, job.id)).rejects.toThrow();
  expect(await db.insw_queue_cycle.findFirst()).toMatchObject({ status: 'HELD', delivery_state: 'KNOWN_SUCCESS' });
  await db.$executeRawUnsafe('DROP TRIGGER test_reject_finalization ON insw_queue_cycle');
  await db.$executeRawUnsafe('DROP FUNCTION test_reject_finalization()');
  await finalizeSyntheticSuccess(db, token, job.id);
  await expect(finalizeSyntheticSuccess(db, '00000000-0000-4000-8000-000000000000', job.id)).rejects.toThrow('OWNER_LOST');
  expect(arrivals).toHaveLength(1);
});

test('known remote success with first result-persistence DB failure repairs evidence without another POST', async () => {
  await enqueue('A');
  await db.$executeRawUnsafe('CREATE SEQUENCE test_result_write_count');
  await db.$executeRawUnsafe(`CREATE FUNCTION test_reject_first_result() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF nextval('test_result_write_count') = 1 THEN RAISE EXCEPTION 'synthetic result persistence outage'; END IF; RETURN NEW; END $$`);
  await db.$executeRawUnsafe('CREATE TRIGGER test_reject_first_result BEFORE INSERT ON insw_tracking_log FOR EACH ROW EXECUTE FUNCTION test_reject_first_result()');
  try {
    launch(); await finished(1);
    expect(await db.insw_tracking_log.count()).toBe(1);
    expect(await db.insw_queue_cycle.findFirst()).toMatchObject({ status: 'HELD', delivery_state: 'KNOWN_SUCCESS' });
    expect(arrivals).toHaveLength(1);
    const [writes] = await db.$queryRaw<{ last_value: bigint }[]>`SELECT last_value FROM test_result_write_count`;
    expect(writes.last_value).toBe(BigInt(2));
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER test_reject_first_result ON insw_tracking_log');
    await db.$executeRawUnsafe('DROP FUNCTION test_reject_first_result()');
    await db.$executeRawUnsafe('DROP SEQUENCE test_result_write_count');
  }
});

test('crash before admission leaves READY; crash after possible-send marker holds uncertainty without HTTP', async () => {
  for (const marker of [false, true]) {
    const job = await enqueue(marker ? 'after-marker' : 'before-marker');
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/test-fixtures/insw-operational-boundary.ts'], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', INSW_ISOLATED_WORKER_ENABLED: 'true',
        INSW_WORKER_TEST_DATABASE_URL: url }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    messages.set(child, []); children.push(child);
    child.on('message', message => messages.get(child)!.push(message as never));
    await event(child, 'ready'); child.send('acquire');
    const token = (await event(child, 'owned')).data!.token!;
    if (marker) { child.send('admit'); await event(child, 'admitted'); }
    await reap(child, 'SIGKILL');
    const prior = await db.insw_dispatch_gate.findUniqueOrThrow({ where: { id: 1 } });
    await recover(token);
    const recovered = await db.insw_dispatch_gate.findUniqueOrThrow({ where: { id: 1 } });
    expect(recovered.last_started_at).toEqual(prior.last_started_at);
    if (marker) expect(recovered.recovery_barrier_at).not.toBeNull();
    const row = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: job.id } });
    expect(row).toMatchObject(marker ? { status: 'HELD', delivery_state: 'POSSIBLY_STARTED', hold_reason: 'DELIVERY_UNKNOWN' }
      : { status: 'READY', delivery_state: 'NOT_STARTED' });
    if (!marker) await db.insw_queue_cycle.update({ where: { id: job.id }, data: { next_eligible_at: new Date('2099-01-01') } });
  }
  expect(arrivals).toHaveLength(0);
});

test('owner loss and unavailable DB forbid admission; idle query rate is bounded', async () => {
  const token = await acquireOperationalOwnership(db);
  const start = queryCount;
  const stop = new AbortController();
  // Own gate denies duplicate loop; test adaptive idle on a fresh reset below.
  await expect(runIsolatedWorker({ db, signal: stop.signal, timeoutMs: 100, request: async () => { throw new Error(); } })).rejects.toThrow('MAINTENANCE_REQUIRED');
  expect(queryCount - start).toBeLessThan(10);
  await db.$executeRaw`UPDATE insw_dispatch_gate SET owner_token = NULL, lease_until = NULL, process_identity = NULL WHERE id = 1`;
  await expect(admitNext(db, token)).rejects.toThrow('OWNER_LOST');
  const unavailable = new PrismaClient({ datasources: { db: { url: 'postgresql://test@127.0.0.1:1/unavailable_phase_c1_test?connect_timeout=1' } } });
  try { await expect(admitNext(unavailable, token)).rejects.toThrow(); } finally { await unavailable.$disconnect(); }
  const baseline = queryCount; const began = process.cpuUsage();
  const idle = runIsolatedWorker({ db, signal: stop.signal, timeoutMs: 100, request: async () => { throw new Error('NO_HTTP'); } });
  await new Promise(resolve => setTimeout(resolve, 2200)); stop.abort(); await idle;
  const queries = queryCount - baseline; expect(queries).toBeLessThan(50);
  writeFileSync(test.info().outputPath('resource-sample.json'), JSON.stringify({ idleWindowMs: 2200, queries,
    cpuMicroseconds: process.cpuUsage(began), memoryBytes: process.memoryUsage() }, null, 2));
  expect(arrivals).toHaveLength(0);
});

test('policy decrease during wait retains previous 3600ms admission minimum', async () => {
  await policy(3600); await enqueue('A'); await enqueue('B');
  launch(); await finished(1); await policy(100);
  await finished(2);
  expect(arrivals[1].at - arrivals[0].at).toBeGreaterThanOrEqual(3590);
});

test('isolated executable guard denies production environment, application DB and non-loopback DB', () => {
  for (const env of [
    { NODE_ENV: 'production', INSW_ISOLATED_WORKER_ENABLED: 'true', INSW_WORKER_TEST_DATABASE_URL: url },
    { NODE_ENV: 'test', INSW_ISOLATED_WORKER_ENABLED: 'false', INSW_WORKER_TEST_DATABASE_URL: url },
    { NODE_ENV: 'test', INSW_ISOLATED_WORKER_ENABLED: 'true', INSW_WORKER_TEST_DATABASE_URL: 'postgresql://test@127.0.0.1/imaps' },
    { NODE_ENV: 'test', INSW_ISOLATED_WORKER_ENABLED: 'true', INSW_WORKER_TEST_DATABASE_URL: 'postgresql://test@example.com/fake_phase_c1_test' },
  ] satisfies NodeJS.ProcessEnv[]) expect(() => isolatedDatabaseUrl(env)).toThrow();
});
