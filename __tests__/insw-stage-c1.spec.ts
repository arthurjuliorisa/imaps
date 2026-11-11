import { test, expect } from '@playwright/test';
import net from 'node:net';
import vm from 'node:vm';
import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { NextResponse } from 'next/server';
import { resolveQueue, resolutionNotes, ResolutionError } from '../lib/insw-queue/admin-resolution';
import { canResolveQueue } from '../lib/insw-queue/operational-state';
import { transmissionStatus, recordedResult } from '../lib/insw-log-presentation';
import { currentQueueStates, operationalLogPage } from '../lib/insw-queue/operational-logs';
import { projectWmsInswStatus, wmsLogInswStatuses, wmsInswClassifiedSql } from '../lib/insw-queue/wms-log-status';
import { canonicalIdentity } from '../lib/insw-queue/contracts';
import { enqueueInTransaction, claimJob } from '../lib/insw-queue/queue.repository';
import { wmsLogResendEligibility } from '../lib/insw-queue/wms-coordination';
import { admitNext } from '../lib/insw-worker/operational.repository';
import { Prisma } from '@prisma/client';

const connect = net.Socket.prototype.connect, fetch = globalThis.fetch;
test.beforeAll(() => {
  net.Socket.prototype.connect = (() => { throw new Error('C1_NO_NETWORK'); }) as typeof connect;
  globalThis.fetch = async () => { throw new Error('C1_NO_NETWORK'); };
});
test.afterAll(() => { net.Socket.prototype.connect = connect; globalThis.fetch = fetch; });
const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const principal = { id: 'admin', role: 'ADMIN', companyCode: '1370' };
const resolution = { resolved_by: 'admin', resolved_at: '2026-11-11T01:00:00Z', notes: 'Reconciled externally' };
const key = canonicalIdentity({ kind: 'WMS_REFERENCE', operation: 'INCOMING', companyCode: 1370,
  reference: 'DOC', revision: 'ACCEPTED_WMS_ID', businessDate: '2026-11-11' }).key;
function harness(change: Record<string, unknown> = {}, options: { actor?: boolean; missing?: boolean; busy?: boolean; latest?: string; failInsert?: boolean } = {}) {
  const q = { id, status: 'FAILED', owner_token: null, lease_until: null, ...change };
  const writes: { text: string; values: unknown[] }[] = [], queries: string[] = [];
  let saved = false, tail = Promise.resolve();
  const tx: any = {
    insw_queue_cycle: { findFirst: async ({ where }: any) => where.company_code === 1370 && !options.missing
      ? { identity_key: key, operation: 'INCOMING', wms_reference: 'DOC' } : null },
    $queryRaw: async (sql: any, ...values: unknown[]) => {
      const text = Array.isArray(sql) ? sql.join('?') : sql.sql; queries.push(text);
      if (text.includes('FROM users')) return options.actor === false ? [] : [{ id: 'admin' }];
      if (text.includes('ORDER BY cycle')) return [{ ...q, id: options.latest || id }];
      if (text.includes('SELECT queue_id FROM insw_admin_resolution')) return saved ? [{ queue_id: id }] : [];
      if (text.includes('AS busy')) return [{ busy: !!options.busy }];
      return [];
    },
    $executeRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      if (options.failInsert) throw new Error('failure');
      writes.push({ text: sql.join('?'), values }); saved = true; return 1;
    },
  };
  const db: any = { $transaction: (fn: any) => {
    // Serialize transactions like the gate/identity locks; DB lock behavior is a separate runtime gate.
    const run = tail.then(() => fn(tx)); tail = run.catch(() => {}); return run;
  } };
  return { db, tx, writes, queries };
}
for (const status of ['FAILED', 'HELD']) test(`Admin resolves stable ${status}; only overlay written`, async () => {
  const h = harness({ status });
  expect(await resolveQueue(h.db, principal, id, { notes: '  External reconciliation  ' })).toMatchObject({ status: 'resolved' });
  expect(h.writes).toHaveLength(1);
  expect(h.writes[0].text).toContain('INSERT INTO insw_admin_resolution');
  expect(h.writes[0].values).toEqual([id, 'admin', 'External reconciliation']);
  expect(h.queries.findIndex(q => q.includes('insw_dispatch_gate'))).toBeLessThan(h.queries.findIndex(q => q.includes('pg_advisory')));
  expect(h.queries.some(q => q.includes('FOR UPDATE'))).toBe(true);
});
for (const status of ['READY', 'CLAIMED', 'REMOTE_SUCCEEDED', 'SUCCEEDED']) test(`Cannot resolve ${status}`, async () => {
  const h = harness({ status });
  await expect(resolveQueue(h.db, principal, id, { notes: 'checked' })).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
  expect(h.writes).toHaveLength(0);
});
for (const body of [{}, { notes: '' }, { notes: '  \n ' }, { notes: 2 }, { notes: 'x'.repeat(2001) },
  { notes: 'ok', resolvedBy: 'forged' }, { notes: 'ok', resolvedAt: 'forged' }, { notes: 'ok', status: 'SUCCESS' },
  { notes: 'ok', companyCode: 1380 }, { notes: 'ok', evidence: {} }, null, [], { notes: '\u0000' }]) {
  test(`Reject malformed/crafted notes ${JSON.stringify(body).slice(0, 70)}`, () => expect(() => resolutionNotes(body)).toThrow(ResolutionError));
}
test('Notes trim, bounded multiline accepted', () => {
  expect(resolutionNotes({ notes: '  line 1\nline 2  ' })).toBe('line 1\nline 2');
  expect(resolutionNotes({ notes: 'x'.repeat(2000) })).toHaveLength(2000);
});
for (const role of ['USER', 'SUPER_ADMIN']) test(`Generic permissions / ${role} cannot resolve`, async () => {
  const h = harness();
  await expect(resolveQueue(h.db, { ...principal, role }, id, { notes: 'checked' })).rejects.toMatchObject({ status: 403 });
  expect(h.queries).toHaveLength(0);
});
test('Active database Admin role and company rechecked', async () => {
  const h = harness({}, { actor: false });
  await expect(resolveQueue(h.db, principal, id, { notes: 'checked' })).rejects.toMatchObject({ status: 403 });
  expect(h.writes).toHaveLength(0);
});
test('Cross company, missing and unlinked target denied', async () => {
  const h = harness();
  await expect(resolveQueue(h.db, { ...principal, companyCode: '1380' }, id, { notes: 'checked' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  await expect(resolveQueue(h.db, principal, 'legacy:1', { notes: 'checked' })).rejects.toMatchObject({ code: 'INVALID_TARGET' });
});
for (const change of [{ owner_token: 'owned' }, { lease_until: new Date() }]) test(`Owned terminal state denied ${Object.keys(change)}`, async () => {
  const h = harness(change);
  await expect(resolveQueue(h.db, principal, id, { notes: 'checked' })).rejects.toMatchObject({ code: 'NOT_ELIGIBLE' });
});
test('Unfinished attempt or gate ownership denies a terminal row', async () => {
  const h = harness({}, { busy: true });
  await expect(resolveQueue(h.db, principal, id, { notes: 'checked' })).rejects.toMatchObject({ code: 'TRANSMISSION_IN_FLIGHT' });
  expect(h.writes).toHaveLength(0);
});
test('Stale cycle rejected rather than resolving successor', async () => {
  const h = harness({}, { latest: 'other' });
  await expect(resolveQueue(h.db, principal, id, { notes: 'checked' })).rejects.toMatchObject({ code: 'TARGET_CHANGED' });
});
test('Concurrent and repeat Resolve produce one write and stable already_resolved', async () => {
  const h = harness();
  const results = await Promise.all(Array.from({ length: 8 }, () => resolveQueue(h.db, principal, id, { notes: 'checked' })));
  expect(results.filter(r => r.status === 'resolved')).toHaveLength(1);
  expect(results.filter(r => r.status === 'already_resolved')).toHaveLength(7);
  expect(h.writes).toHaveLength(1);
});
const facts: any = { log_id: BigInt(1), company_code: 1370, operation: 'INCOMING', wms_id: 'DOC', transmission_status: 'SUCCESS',
  source_id: BigInt(1), source_matches: BigInt(1), business_date: '2026-11-11', revision: 'ACCEPTED_WMS_ID', source_valid: true,
  history_count: 1, remote_success: false, history_mismatch: false,
  queues: [{ id, identity_key: key, business_date: '2026-11-11', source_revision: 'ACCEPTED_WMS_ID', cycle: 1,
    status: 'FAILED', delivery_state: 'KNOWN_FAILURE', owner_token: null, lease_until: null, resolution }] };
for (const recorded of ['SUCCESS', 'FAILED', 'PENDING', 'NO_ATTEMPT_LOG']) test(`WMS / INSW parity; original ${recorded} independent`, () => {
  const q: any = { ...facts.queues[0], resolution };
  const log = { insw_status: recorded, current_queue: q };
  expect(transmissionStatus(log).label).toBe('Resolved');
  expect(projectWmsInswStatus(facts, true).operationalLabel).toBe('Resolved');
  expect(recordedResult(log).label).toBe(recorded === 'SUCCESS' ? 'Success' : recorded === 'FAILED' ? 'Failed' : 'Not Recorded');
  expect(canResolveQueue(q)).toBe(false);
});
test('Unlinked/conflicting WMS history never gets a target', () => {
  for (const change of [{ queues: [] }, { source_matches: BigInt(2) }, { history_mismatch: true }]) {
    const projected = projectWmsInswStatus({ ...facts, ...change }, true);
    expect(projected.queueId).toBeUndefined(); expect(projected.canResolve).toBeFalsy();
  }
});
for (const size of [10, 50]) test(`Visible ${size} rows use bounded batched status and resolution lookup`, async () => {
  let calls = 0; const sqls: string[] = [];
  const wms = await wmsLogInswStatuses({ $queryRaw: async (sql: any) => { calls++; sqls.push(sql.sql); return Array.from({ length: size }, (_, i) => ({ ...facts, log_id: BigInt(i + 1) })); } } as any,
    principal, Array.from({ length: size }, (_, i) => BigInt(i + 1)));
  expect(calls).toBe(1); expect(wms.size).toBe(size); expect(sqls[0]).toContain('insw_admin_resolution');
  calls = 0;
  const page = await operationalLogPage({ $queryRaw: async (sql: any) => {
    calls++; sqls.push(sql.sql);
    return calls === 1 ? [{ total: size, logs: Array.from({ length: size }, (_, i) => ({ id: String(i), queue_id: id })) }]
      : [{ original_id: id, state: { ...facts.queues[0], resolution } }];
  } } as any, { company_code: 1370, limit: size, offset: 0 });
  expect(calls).toBe(2); expect(page.logs.every(l => l.current_queue?.resolution?.notes === resolution.notes)).toBe(true);
  expect(sqls.at(-1)).toContain('r.queue_id = q.id');
});
test('Resolved WMS filter uses same overlay before success/hold classification', () => {
  const sql = wmsInswClassifiedSql(Prisma.sql`true`).sql;
  expect(sql.indexOf("THEN 'Resolved'")).toBeLessThan(sql.indexOf('WHEN remote_success'));
});
test('Generic enqueue and ordinary resend fenced without mutation', async () => {
  const h = harness();
  h.tx.$queryRaw = async () => [{ queue_id: id }];
  await expect(enqueueInTransaction(h.tx, { identity: { kind: 'WMS_REFERENCE', companyCode: 1370, operation: 'INCOMING', reference: 'DOC', revision: 'ACCEPTED_WMS_ID', businessDate: '2026-11-11' }, payload: { data: [] }, intent: 'EXPLICIT_POST', requestedBy: 'admin' })).rejects.toThrow('ADMINISTRATIVELY_RESOLVED');
  let query = '';
  const eligible = await wmsLogResendEligibility({ $queryRaw: async (sql: any) => { query = sql.sql; return []; } } as any, 1370, [BigInt(1)]);
  expect(eligible.size).toBe(0); expect(query).toContain('r.queue_id = p.id'); expect(h.writes).toHaveLength(0);
});

function route(auth: any, command = resolveQueue) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/api/insw/queues/[id]/resolve/route.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, URL, require: (name: string) => {
    if (name === 'next/server') return { NextResponse };
    if (name.endsWith('api-auth')) return { checkAuth: async () => auth };
    if (name.endsWith('admin-resolution')) return { resolveQueue: command, ResolutionError };
    if (name.endsWith('prisma')) return { prisma: {} };
    throw new Error(name);
  } });
  return exports.POST;
}
for (const role of ['USER', 'SUPER_ADMIN']) test(`HTTP role guard rejects ${role}`, async () => {
  const post = route({ authenticated: true, session: { user: { ...principal, role } } });
  expect((await post(new Request('http://localhost/api/resolve', { method: 'POST' }), { params: Promise.resolve({ id }) })).status).toBe(403);
});
test('HTTP auth, origin, malformed JSON and successful command wiring', async () => {
  expect((await route({ authenticated: false, response: NextResponse.json({}, { status: 401 }) })(new Request('http://localhost'), {})).status).toBe(401);
  let calls = 0;
  const post = route({ authenticated: true, session: { user: principal } }, (async (_db: any, actor: any, target: any, body: any) => {
    calls++; expect(actor.id).toBe('admin'); expect(target).toBe(id); expect(body).toEqual({ notes: 'checked' });
    return { success: true, status: 'resolved', queue_id: id };
  }) as any);
  const send = (body: string, origin = 'http://localhost') => post(new Request('http://localhost/api/resolve', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body,
  }), { params: Promise.resolve({ id }) });
  expect((await send('{}', 'http://evil')).status).toBe(403);
  expect((await send('{')).status).toBe(400);
  expect((await send('{"notes":"checked"}')).status).toBe(200); expect(calls).toBe(1);
});


test('Both claim paths exclude resolved identities before claim or attempt writes', async () => {
  const queries: string[] = [];
  const tx: any = {
    insw_transmission_policy: { findUnique: async () => ({ min_processing_interval_ms: 3600, max_auto_retry: 10, version: 1 }) },
    $queryRaw: async (sql: TemplateStringsArray) => {
      const query = sql.join('?'); queries.push(query);
      if (query.includes('SELECT last_started_at')) return [{ last_started_at: null, prior_interval_ms: null, busy_attempt_id: null }];
      if (query.includes('AS wait_ms')) return [{ wait_ms: 0 }];
      return [];
    },
  };
  const db: any = { $transaction: async (fn: any) => fn(tx) };
  expect(await claimJob(db, 60000)).toBeNull();
  expect(await admitNext(db, 'owner', 3600, [1370])).toEqual({ waitMs: 0, job: null });
  const selectors = queries.filter(q => q.includes("status = 'READY'"));
  expect(selectors).toHaveLength(2);
  for (const selector of selectors) {
    expect(selector).toContain('NOT EXISTS (SELECT 1 FROM insw_admin_resolution');
    expect(selector).toContain('resolved.identity_key =');
  }
});

test('Failed persistence propagates failure instead of claiming resolution', async () => {
  const h = harness({}, { failInsert: true });
  await expect(resolveQueue(h.db, principal, id, { notes: 'checked' })).rejects.toThrow('failure');
  expect(h.writes).toHaveLength(0);
});
