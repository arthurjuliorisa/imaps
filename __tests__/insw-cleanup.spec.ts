import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import net from 'node:net';
import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import * as jsxRuntime from 'react/jsx-runtime';

// Every application import is injected: no Prisma connection, service constructor,
// auth initialization or provider transport can escape this harness.
function load(path: string, imports: Record<string, unknown>, env: Record<string, string | undefined> = {}, globals: Record<string, unknown> = {}) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, ...globals, process: { env }, require(name: string) {
    if (!(name in imports)) throw new Error(`Unmocked import: ${name}`);
    return imports[name];
  } });
  return exports;
}
const connect = net.Socket.prototype.connect, fetch = globalThis.fetch;
test.beforeAll(() => {
  net.Socket.prototype.connect = (() => { throw new Error('CLEANUP_NETWORK_FORBIDDEN'); }) as typeof connect;
  globalThis.fetch = async () => { throw new Error('CLEANUP_PROVIDER_POST_FORBIDDEN'); };
});
test.afterAll(() => { net.Socket.prototype.connect = connect; globalThis.fetch = fetch; });

function harness(phase = 'development', env: Record<string, string | undefined> = { DATABASE_PHASE: phase }) {
  let rows: Record<string, any[]> = {
    insw_queue_cycle: [1370, 1380].map(company_code => ({ id: `q${company_code}`, company_code, status: 'FAILED' })),
    insw_queue_attempt: [1370, 1380].map(c => ({ id: `a${c}`, queue_id: `q${c}`, completed_at: new Date(0) })),
    insw_admin_resolution: [1370, 1380].map(c => ({ queue_id: `q${c}` })),
    insw_tracking_log: [1370, 1380].map(company_code => ({ company_code, queue_attempt_id: `a${company_code}` })),
    insw_preparation_ledger: [1370, 1380].map(company_code => ({ company_code, member_id: `m${company_code}`, queue_id: `q${company_code}` })),
    insw_preparation_member: [1370, 1380].map(company_code => ({ id: `m${company_code}`, company_code })),
    insw_preparation_rollout: [{ company_code: 1370, mode: 'PREPARED' }],
    incoming_goods: [{ company_code: 1370 }], wms_transmission_logs: [{ company_code: 1370 }],
    insw_integration_settings: [{ company_code: 1370 }], insw_uom_mapping: [{ company_code: 1370 }],
    insw_uom_reference: [{ id: 'reference' }],
    insw_worker_recovery: [{ id: 'recovery' }], insw_transmission_policy: [{ id: 1 }],
    insw_policy_change: [{ version: 1 }],
  };
  const events: string[] = [];
  let locked = false, fail = '', residual = '', external = 'success', remoteCalls = 0;
  let gate: any = { owner_token: null, lease_until: null, busy_attempt_id: null, process_identity: null, last_started_at: new Date(0), prior_interval_ms: 3600, recovery_barrier_at: new Date(10) };
  const tx: any = {
    $executeRaw: async (parts: TemplateStringsArray) => {
      if (parts.join('').includes('UPDATE insw_dispatch_gate')) {
        if (fail === 'release') throw new Error('Injected release failure');
        Object.assign(gate, { owner_token: null, lease_until: null, process_identity: null,
          recovery_barrier_at: gate.last_started_at === null ? gate.recovery_barrier_at
            : new Date(Math.max(gate.recovery_barrier_at?.getTime() ?? 0, Date.now())) });
        events.push('release'); return 1;
      }
      expect(parts.join('')).toContain('IN SHARE ROW EXCLUSIVE MODE NOWAIT');
      if (fail === 'lock') throw new Prisma.PrismaClientKnownRequestError('busy', { code: 'P2010', clientVersion: '6.5', meta: { code: '55P03' } });
      locked = true; events.push('lock');
    },
    $queryRaw: async (parts: TemplateStringsArray) => {
      expect(locked).toBe(true);
      const sql = parts.join('');
      if (sql.includes('SELECT u.id')) return user?.role === 'ADMIN' && user.company_code === 1370 && company ? [{ id: user.id }] : [];
      if (sql.includes('AS conflict')) return [{ conflict:
        rows.insw_tracking_log.some(l => l.queue_attempt_id && rows.insw_queue_attempt.some(a => a.id === l.queue_attempt_id
          && rows.insw_queue_cycle.some(q => q.id === a.queue_id && q.company_code !== l.company_code)))
        || rows.insw_preparation_ledger.some(l => l.queue_id && rows.insw_queue_cycle.some(q => q.id === l.queue_id && q.company_code !== l.company_code)) }];
      return gate ? [{ ...gate, expired: gate.lease_until != null && gate.lease_until <= new Date() }] : [];
    },
  };
  const matches = (row: any, where: any) => where.queue
    ? rows.insw_queue_cycle.some(q => q.id === row.queue_id && q.company_code === where.queue.company_code)
    : where.company_code === undefined || row.company_code === where.company_code;
  for (const table of Object.keys(rows)) tx[table] = {
    count: async ({ where }: any) => {
      expect(locked).toBe(true);
      if (!where.OR && where.completed_at === undefined) expect(where.company_code ?? where.queue?.company_code).toBe(1370);
      if (where.completed_at === undefined && !where.OR) {
        return rows[table].filter(row => matches(row, where)).length;
      }
      if (table === 'insw_queue_attempt') expect(where.completed_at).toBe(null);
      else expect(where.OR).toEqual([
        table === 'insw_queue_cycle' ? { status: { in: ['CLAIMED', 'REMOTE_SUCCEEDED'] } } : { state: 'CLAIMED' },
        { owner_token: { not: null } }, { lease_until: { not: null } },
      ]);
      return rows[table].filter(row => matches(row, where) && (where.completed_at === null
        ? row.completed_at === null
        : where.OR.some((predicate: any) => Object.entries(predicate).some(([key, value]: [string, any]) =>
          value.in ? value.in.includes(row[key]) : value.not === null
            ? row[key] != null : row[key] === value)))).length;
    },
    deleteMany: async ({ where }: any) => {
      if (phase !== 'production') expect(locked).toBe(true);
      if (fail === table) throw new Error('Injected local failure');
      if (residual === table) return { count: 0 }; // Simulate a delete that leaves eligible rows.
      const selected = rows[table].filter(row => matches(row, where));
      // Model actual RESTRICT FKs (including those defined only in migrations).
      for (const row of selected) {
        if (table === 'insw_queue_cycle') {
          expect(rows.insw_queue_attempt.some(a => a.queue_id === row.id)).toBe(false);
          expect(rows.insw_admin_resolution.some(a => a.queue_id === row.id)).toBe(false);
          expect(rows.insw_preparation_ledger.some(a => a.queue_id === row.id)).toBe(false);
        }
        if (table === 'insw_queue_attempt') expect(rows.insw_tracking_log.some(l => l.queue_attempt_id === row.id)).toBe(false);
        if (table === 'insw_preparation_member') expect(rows.insw_preparation_ledger.some(l => l.member_id === row.id)).toBe(false);
      }
      rows[table] = rows[table].filter(row => !selected.includes(row));
      events.push(table);
      return { count: selected.length };
    },
  };
  const db: any = { ...tx, $transaction: async (fn: any) => {
    const snapshot = structuredClone(rows), gateSnapshot = structuredClone(gate);
    try { return await fn(tx); } catch (error) { rows = snapshot; gate = gateSnapshot; throw error; }
    finally { locked = false; }
  } };
  tx.insw_worker_recovery.create = async ({ data }: any) => {
    if (fail === 'audit') throw new Error('Injected audit failure');
    rows.insw_worker_recovery.push({ ...data, recovered_at: new Date() }); events.push('audit');
  };
  const operations = load('lib/insw-queue/cleanup.ts', {
    '@prisma/client': { Prisma }, '@/lib/prisma': { prisma: db },
    '@/lib/config/insw-company-config': { resolveInswCompanyConfig: () => ({ useTestMode: testMode }) },
  }, env);
  const context = load('lib/cleanup/cleanup-company-context.ts', {
    'next-auth': { getServerSession: async () => session }, '@/lib/auth': { authOptions: {} },
    '@/lib/prisma': { prisma: {
      users: { findUnique: async () => user }, companies: { findUnique: async () => company },
    } },
  });
  let session: any = { user: { email: 'admin@example.invalid', companyCode: 1370 } };
  let user: any = { id: 'admin', email: 'admin@example.invalid', role: 'ADMIN', company_code: 1370 };
  let company: any = { code: 1370, name: 'Synthetic company' };
  let testMode = true, afterRemote = () => {};
  const post = load('app/api/admin/insw-cleanup/route.ts', {
    'next/server': { NextResponse }, '@/lib/utils/logger': { logger: { error() {}, info() {} } },
    '@/lib/services/insw-transmission.service': { INSWTransmissionService: class {
      async cleanupINSWData(code: number) {
        expect(code).toBe(1370); expect(locked).toBe(false); remoteCalls++;
        afterRemote(); return { status: external, success_count: 1, failed_count: 0 };
      }
    } },
    '@/lib/log-activity': { logActivity: async () => {} },
    '@/lib/config/insw-company-config': { resolveInswCompanyConfig: () => ({ useTestMode: testMode }) },
    '@/lib/cleanup/cleanup-company-context': context,
    '@/lib/repositories/insw-tracking-log.repository': {
      deleteINSWTrackingLogsForCompany: async (code: number) => (await tx.insw_tracking_log.deleteMany({ where: { company_code: code } })).count,
    },
    '@/lib/insw-queue/cleanup': operations,
    '@/lib/security/request-origin': load('lib/security/request-origin.ts', {}, env),
  }, { NEXTAUTH_URL: 'https://imaps.invalid', ...env }).POST;
  return { operations, post, events, get rows() { return rows; }, get remoteCalls() { return remoteCalls; },
    setGate: (value: any) => { gate = value; }, get gate() { return gate; },
    setFail: (value: string) => { fail = value; }, setActive: (table: string) => {
      Object.assign(rows[table][0], table === 'insw_queue_attempt' ? { completed_at: null }
        : table === 'insw_queue_cycle' ? { status: 'CLAIMED' } : { state: 'CLAIMED' });
    },
    setResidual: (value: string) => { residual = value; },
    setExternal: (value: string) => { external = value; }, afterRemote: (fn: () => void) => { afterRemote = fn; },
    setSession: (value: any) => { session = value; }, setUser: (value: any) => { user = value; },
    setCompany: (value: any) => { company = value; }, setTestMode: () => { testMode = false; },
  };
}
function request(body: Record<string, unknown> = { confirmation: 'RESET 1370', producersStopped: true }, origin = 'https://imaps.invalid') {
  return new Request('https://imaps.invalid/api/admin/insw-cleanup', { method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify(body) });
}

for (const phase of ['development', 'staging']) test(`${phase}: scoped bulk deletion, FK order, retention and repeat invocation`, async () => {
  const h = harness(phase);
  const preserved = structuredClone(h.rows);
  for (const table of ['insw_queue_attempt', 'insw_queue_cycle']) expect(h.rows[table]).toHaveLength(2);
  expect(h.rows.insw_queue_cycle.filter(q => q.company_code === 1370)).toHaveLength(1);
  expect(h.rows.insw_queue_attempt.filter(a => a.queue_id === 'q1370')).toHaveLength(1);
  const response = await h.post(request()), body = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(200); expect(body.success).toBe(true);
  expect(body.localTrackingLogCleanup.deletedRows).toBe(1);
  expect(body.localQueueCleanup).toEqual({ success: true, trackingLogs: 1, resolutions: 1, preparationLedgers: 1,
    preparationMembers: 1, attempts: 1, queues: 1 });
  expect(h.rows.insw_queue_cycle.filter(q => q.company_code === 1370)).toHaveLength(0);
  expect(h.rows.insw_queue_attempt.filter(a => a.queue_id === 'q1370')).toHaveLength(0);
  expect(h.rows.insw_queue_cycle.map(q => q.id)).toEqual(['q1380']);
  expect(h.rows.insw_queue_attempt.map(a => a.id)).toEqual(['a1380']);
  expect(h.events.filter(e => e !== 'lock')).toEqual(['insw_tracking_log', 'insw_admin_resolution',
    'insw_preparation_ledger', 'insw_preparation_member', 'insw_queue_attempt', 'insw_queue_cycle']);
  for (const [table, original] of Object.entries(preserved)) {
    if (h.events.includes(table)) expect(h.rows[table]).toEqual(original.filter((r: any) =>
      r.company_code === 1380 || r.queue_id === 'q1380'));
    else expect(h.rows[table]).toEqual(original);
  }
  const repeat = await (await h.post(request())).json();
  expect(repeat.localQueueCleanup.queues).toBe(0); expect(repeat.localTrackingLogCleanup.deletedRows).toBe(0);
  expect(h.gate).toEqual({ owner_token: null, lease_until: null, busy_attempt_id: null, process_identity: null,
    last_started_at: new Date(0), prior_interval_ms: 3600, recovery_barrier_at: new Date(10) });
  expect(h.remoteCalls).toBe(2); // Mocked cleanup only; all real sockets/fetch are blocked.
});

test('Production ignores forged scope/environment and preserves queue and resolution history', async () => {
  const h = harness('production'); staleOwner(h);
  const before = structuredClone(h.rows), gate = structuredClone(h.gate);
  const body = await (await h.post(request({ environment: 'staging', companyCode: 1380, confirmation: 'RESET 1380', producersStopped: true }))).json();
  expect(h.gate).toEqual(gate);
  expect(body.success).toBe(true); expect(body.localQueueCleanup).toBeUndefined();
  expect(h.events).toEqual(['insw_tracking_log']);
  for (const table of Object.keys(before).filter(t => t !== 'insw_tracking_log')) expect(h.rows[table]).toEqual(before[table]);
  await expect(h.operations.deleteINSWOperationalData(1370)).rejects.toThrow('requires Development/Staging');
  expect(h.events).toEqual(['insw_tracking_log']);
});

test('eligible attempt or cycle residue rejects full success and rolls back', async () => {
  for (const table of ['insw_tracking_log', 'insw_admin_resolution', 'insw_preparation_ledger', 'insw_preparation_member', 'insw_queue_attempt', 'insw_queue_cycle']) {
    const h = harness(), before = structuredClone(h.rows);
    h.setResidual(table);
    const response = await h.post(request()), body = await response.json();
    expect(response.status).toBe(500);
    expect(body.success).toBe(false);
    expect(['INSW_CLEANUP_RESIDUAL_DATA', 'LOCAL_INSW_OPERATIONAL_CLEANUP_FAILED']).toContain(body.error.code);
    if (body.error.code === 'INSW_CLEANUP_RESIDUAL_DATA') expect(body.error.message).toContain('rolled back');
    expect(body.externalINSWCleanup.success).toBe(true);
    expect(body.localQueueCleanup.success).toBe(false);
    expect(h.rows).toEqual(before);
  }
});

test('server environment is explicit, production/invalid fail closed, no implicit test allowance', () => {
  const { includesINSWQueueCleanup: include } = harness().operations;
  expect(include({})).toBe(false); expect(include({ NODE_ENV: 'test' })).toBe(false);
  expect(include({ NODE_ENV: 'development' })).toBe(false);
  expect(include({ NEXT_PUBLIC_ENVIRONMENT_PHASE: 'staging' })).toBe(false);
  expect(include({ NODE_ENV: 'production', DATABASE_PHASE: 'staging' })).toBe(true);
  for (const phase of ['production', 'invalid']) expect(include({ NEXT_PUBLIC_ENVIRONMENT_PHASE: phase,
    NODE_ENV: 'development', DATABASE_PHASE: 'staging' })).toBe(false);
});

test('sticky owner, outstanding POST, missing gate, active claims and preparation reject before remote', async () => {
  for (const field of ['owner_token', 'lease_until', 'busy_attempt_id', 'process_identity', 'missing', 'queue', 'preparation', 'attempt', 'lock']) {
    const h = harness();
    if (field === 'missing') h.setGate(null);
    else if (field === 'queue') h.setActive('insw_queue_cycle');
    else if (field === 'preparation') h.setActive('insw_preparation_ledger');
    else if (field === 'attempt') h.setActive('insw_queue_attempt');
    else if (field === 'lock') h.setFail('lock');
    else h.setGate({ ...h.gate, [field]: field === 'lease_until' ? new Date(0) : 'owned' });
    const before = structuredClone(h.rows);
    const response = await h.post(request());
    expect(response.status).toBe(409); expect((await response.json()).error.code).toBe('INSW_CLEANUP_QUEUE_BUSY');
    expect(h.remoteCalls).toBe(0); expect(h.rows).toEqual(before);
  }
});

test('remote failure skips local data; local failure rolls back and reports external success separately', async () => {
  for (const fail of ['remote', 'insw_tracking_log', 'insw_admin_resolution', 'insw_preparation_ledger',
    'insw_preparation_member', 'insw_queue_attempt', 'insw_queue_cycle', 'race']) {
    const h = harness(), before = structuredClone(h.rows);
    if (fail === 'remote') h.setExternal('failed');
    else if (fail === 'race') h.afterRemote(() => h.setGate({ ...h.gate, owner_token: 'new-worker' }));
    else h.setFail(fail);
    const response = await h.post(request()), body = await response.json();
    expect(response.status).toBe(fail === 'remote' ? 502 : fail === 'race' ? 409 : 500);
    expect(body.success).toBe(false); expect(body.externalINSWCleanup.success).toBe(fail !== 'remote');
    expect(body.localTrackingLogCleanup.success).toBe(false); expect(h.rows).toEqual(before);
  }
});

test('session authentication, DB admin role, company validation and test mode remain authoritative', async () => {
  for (const variant of ['session', 'role', 'mismatch', 'invalid', 'company', 'mode']) {
    const h = harness();
    if (variant === 'session') h.setSession(null);
    if (variant === 'role') h.setUser({ role: 'USER', company_code: 1370 });
    if (variant === 'mismatch') h.setUser({ role: 'ADMIN', company_code: 1380 });
    if (variant === 'invalid') h.setSession({ user: { email: 'admin@example.invalid', companyCode: 'invalid' } });
    if (variant === 'company') h.setCompany(null);
    if (variant === 'mode') h.setTestMode();
    const response = await h.post(request());
    expect(response.status).toBe(variant === 'session' ? 401 : ['role', 'mode'].includes(variant) ? 403 : 400);
    expect(h.remoteCalls).toBe(0); expect(h.events).toEqual([]);
  }
});


test('cross-company child references fail closed without widening deletion scope', async () => {
  for (const table of ['insw_tracking_log', 'insw_preparation_ledger']) {
    const h = harness();
    if (table === 'insw_tracking_log') h.rows[table][1].queue_attempt_id = 'a1370';
    else h.rows[table][1].queue_id = 'q1370';
    const before = structuredClone(h.rows);
    const response = await h.post(request());
    expect(response.status).toBe(409); expect((await response.json()).success).toBe(false);
    expect(h.remoteCalls).toBe(0);
    expect(h.rows).toEqual(before);
  }
});

test('nullable/unlinked tracking and preparation records are removed within company scope', async () => {
  const h = harness();
  h.rows.insw_tracking_log.push({ company_code: 1370, queue_attempt_id: null });
  h.rows.insw_preparation_ledger.push({ company_code: 1370, member_id: 'unlinked', queue_id: null });
  h.rows.insw_preparation_member.push({ company_code: 1370, id: 'unlinked' });
  const body = await (await h.post(request())).json();
  expect(body.success).toBe(true); expect(body.localTrackingLogCleanup.deletedRows).toBe(2);
  expect(body.localQueueCleanup.preparationLedgers).toBe(2);
  expect(body.localQueueCleanup.preparationMembers).toBe(2);
});

const restoredIdentity = { host: 'vps', machine: 'a'.repeat(32), boot: 'historical-boot', pid: 1234,
  uid: 1000, start: '1234', pidNamespace: 'pid:[1234]' };
function staleOwner(h: ReturnType<typeof harness>) {
  h.setGate({ ...h.gate, owner_token: '11111111-1111-4111-8111-111111111111',
    lease_until: new Date(0), process_identity: restoredIdentity });
}

for (const phase of ['development', 'staging']) test(`${phase}: NR-01 restored owner, 362 ambiguous HELD and 4 successful cycles discarded with audit`, async () => {
  const h = harness(phase);
  staleOwner(h);
  h.rows.insw_queue_cycle = h.rows.insw_queue_cycle.filter(q => q.company_code !== 1370);
  for (let i = 0; i < 366; i++) h.rows.insw_queue_cycle.push({ id: i === 0 ? 'q1370' : `restored-${i}`, company_code: 1370,
    status: i < 362 ? 'HELD' : 'SUCCEEDED', delivery_state: i < 362 ? 'POSSIBLY_STARTED' : 'KNOWN_SUCCESS',
    owner_token: null, lease_until: null });
  // The real reported fixture has zero unfinished attempts (retained completed history is deletable).
  const originalGate = structuredClone(h.gate), other = structuredClone(h.rows.insw_queue_cycle.filter(q => q.company_code === 1380));
  const result = await h.post(request()), body = await result.json();
  expect(result.status, JSON.stringify(body)).toBe(200);
  expect(body.localQueueCleanup.queues).toBe(366); expect(body.localQueueCleanup.attempts).toBe(1);
  expect(h.rows.insw_queue_cycle).toEqual(other);
  expect(h.gate.owner_token).toBe(null); expect(h.gate.lease_until).toBe(null); expect(h.gate.process_identity).toBe(null);
  expect(h.gate.last_started_at).toEqual(originalGate.last_started_at);
  expect(h.gate.prior_interval_ms).toBe(3600);
  expect(h.gate.recovery_barrier_at).toBeInstanceOf(Date);
  expect(h.rows.insw_worker_recovery).toHaveLength(2);
  expect(h.rows.insw_worker_recovery[1]).toMatchObject({ old_owner_token: originalGate.owner_token, operator: 'admin', process_identity: restoredIdentity });
  expect(h.rows.insw_worker_recovery[1].evidence).toContain('Admin attests');
  expect(h.events.indexOf('audit')).toBeLessThan(h.events.indexOf('release'));
  const repeat = await (await h.post(request())).json();
  expect(repeat.localQueueCleanup.queues).toBe(0); expect(h.rows.insw_worker_recovery).toHaveLength(2);
  expect(h.remoteCalls).toBe(2);
});

test('NR-02 global active evidence including another tenant, inconsistent timing and unknown identities fail closed', async () => {
  for (const variant of ['futureLease', 'missingLease', 'busy', 'identity', 'emptyIdentity', 'interval', 'timing', 'otherQueue', 'otherAttempt', 'otherPreparation']) {
    const h = harness(); staleOwner(h);
    if (variant === 'futureLease') h.setGate({ ...h.gate, lease_until: new Date('9999-01-01') });
    if (variant === 'missingLease') h.setGate({ ...h.gate, lease_until: null });
    if (variant === 'busy') h.setGate({ ...h.gate, busy_attempt_id: 'a1380' });
    if (variant === 'identity') h.setGate({ ...h.gate, process_identity: null });
    if (variant === 'emptyIdentity') h.setGate({ ...h.gate, process_identity: {} });
    if (variant === 'interval') h.setGate({ ...h.gate, prior_interval_ms: 3599 });
    if (variant === 'timing') h.setGate({ ...h.gate, last_started_at: null });
    if (variant === 'otherQueue') Object.assign(h.rows.insw_queue_cycle[1], { status: 'CLAIMED' });
    if (variant === 'otherAttempt') Object.assign(h.rows.insw_queue_attempt[1], { completed_at: null });
    if (variant === 'otherPreparation') Object.assign(h.rows.insw_preparation_ledger[1], { state: 'CLAIMED' });
    const before = structuredClone(h.rows), gate = structuredClone(h.gate);
    const response = await h.post(request()), body = await response.json();
    expect(response.status, variant).toBe(409); expect(body.error.message.length).toBeGreaterThan(40);
    expect(h.remoteCalls).toBe(0); expect(h.rows).toEqual(before); expect(h.gate).toEqual(gate);
  }
});

test('NR-03 missing/mismatched private phase, client flags, CSRF and confirmation cannot authorize reset', async () => {
  for (const env of [{}, { NODE_ENV: 'development' }, { NEXT_PUBLIC_ENVIRONMENT_PHASE: 'staging' },
    { DATABASE_PHASE: 'invalid' }, { DATABASE_PHASE: 'staging', NEXT_PUBLIC_ENVIRONMENT_PHASE: 'production' },
    { DATABASE_PHASE: 'production', NEXT_PUBLIC_ENVIRONMENT_PHASE: 'staging' }]) {
    const h = harness('development', env);
    const response = await h.post(request({ confirmation: 'RESET 1370', producersStopped: true, environment: 'staging' }));
    expect(response.status).toBe(403); expect(h.remoteCalls).toBe(0); expect(h.events).toEqual([]);
  }
  for (const body of [{}, { confirmation: 'RESET 1370' }, { confirmation: 'RESET 1370', producersStopped: 'true' },
    { confirmation: 'RESET 1380', producersStopped: true }, { confirmation: 'RESET 1370', producersStopped: true, companyCode: 1380 }]) {
    const h = harness(); expect((await h.post(request(body))).status).toBe(400); expect(h.remoteCalls).toBe(0);
  }
  for (const origin of ['', 'https://attacker.invalid']) {
    const h = harness(); expect((await h.post(request(undefined, origin))).status).toBe(403); expect(h.remoteCalls).toBe(0);
  }
});

test('NR-05 audit, ownership release and every delete failure roll back stale gate, audit and data', async () => {
  for (const failure of ['audit', 'release', 'insw_tracking_log', 'insw_admin_resolution', 'insw_preparation_ledger',
    'insw_preparation_member', 'insw_queue_attempt', 'insw_queue_cycle']) {
    const h = harness(); staleOwner(h); h.setFail(failure);
    const before = structuredClone(h.rows), gate = structuredClone(h.gate);
    const result = await h.post(request()), body = await result.json();
    expect(result.status, failure).toBe(500); expect(body.success).toBe(false);
    expect(body.externalINSWCleanup.success).toBe(true); expect(body.localQueueCleanup.success).toBe(false);
    expect(h.rows).toEqual(before); expect(h.gate).toEqual(gate);
  }
});

test('NR-06 atomic second guard refuses new owner, tenant contradiction or lost DB authorization after Sandbox', async () => {
  for (const race of ['owner', 'reference', 'role', 'company', 'mode', 'lock']) {
    const h = harness();
    h.afterRemote(() => {
      if (race === 'owner') h.setGate({ ...h.gate, owner_token: 'new-worker', lease_until: new Date('9999-01-01') });
      if (race === 'reference') h.rows.insw_tracking_log[1].queue_attempt_id = 'a1370';
      if (race === 'role') h.setUser({ role: 'USER', company_code: 1370 });
      if (race === 'company') h.setCompany(null);
      if (race === 'mode') h.setTestMode();
      if (race === 'lock') h.setFail('lock');
    });
    const response = await h.post(request()), body = await response.json();
    expect(response.status, race).toBe(race === 'mode' ? 500 : 409);
    expect(body.externalINSWCleanup.success).toBe(true); expect(body.localQueueCleanup.success).toBe(false);
    expect(h.rows.insw_queue_cycle).toHaveLength(2); expect(h.rows.insw_queue_attempt).toHaveLength(2);
  }
});

test('NR-08 existing component confirmation submits to the real handler and renders success, conflict and split failure', async () => {
  for (const scenario of ['success', 'busy', 'split']) {
    const h = harness(); staleOwner(h);
    if (scenario === 'busy') h.setGate({ ...h.gate, busy_attempt_id: 'a1370' });
    if (scenario === 'split') h.setFail('insw_queue_cycle');
    const state: any[] = [], notices: string[] = [], submissions: any[] = [];
    let cursor = 0;
    const mui = Object.fromEntries(['Box', 'Card', 'CardContent', 'CardHeader', 'Typography', 'Button', 'Stack',
      'Dialog', 'DialogTitle', 'DialogContent', 'DialogActions', 'TextField', 'Checkbox', 'FormControlLabel',
      'Alert', 'LinearProgress', 'Chip'].map(name => [name, name]));
    const component = load('app/(authenticated)/settings/database-cleanup/components/INSWCleanupMode.tsx', {
      react: { useState: (initial: any) => { const index = cursor++; if (!(index in state)) state[index] = initial;
        return [state[index], (value: any) => { state[index] = value; }]; } },
      'react/jsx-runtime': jsxRuntime,
      '@mui/material': { ...mui, useTheme: () => ({ palette: { info: { main: '#123' }, success: { main: '#456' }, error: { main: '#789' } } }), alpha: (v: string) => v },
      '@mui/icons-material': Object.fromEntries(['ArrowBack', 'Warning', 'CheckCircle', 'Error', 'CloudOff'].map(name => [name, name])),
      '@/app/components/ToastProvider': { useToast: () => ({ showToast: (message: string) => notices.push(message) }) },
      'next-auth/react': { useSession: () => ({ data: { user: { companyCode: 1370 } } }) },
    }, {}, { fetch: async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/admin/insw-cleanup'); submissions.push(JSON.parse(String(init.body)));
      return h.post(new Request(`https://imaps.invalid${url}`, { ...init,
        headers: { ...init.headers, origin: 'https://imaps.invalid' } }));
    } }).INSWCleanupMode;
    const render = () => { cursor = 0; return component({ onBack() {} }); };
    function elements(node: any): any[] {
      if (Array.isArray(node)) return node.flatMap(elements);
      if (!node || typeof node !== 'object') return [];
      return [node, ...elements(node.props?.children), ...elements(node.props?.control)];
    }
    const find = (tree: any, type: string, child?: string) => elements(tree).find(n => n.type === type && (!child || n.props.children === child));
    let tree = render(); find(tree, 'Button', 'Proceed with Cleanup').props.onClick(); tree = render();
    expect(find(tree, 'Button', 'Confirm').props.disabled).toBe(true);
    find(tree, 'TextField').props.onChange({ target: { value: 'RESET 1370' } }); tree = render();
    expect(find(tree, 'Button', 'Confirm').props.disabled).toBe(true);
    find(tree, 'Checkbox').props.onChange({ target: { checked: true } }); tree = render();
    expect(find(tree, 'Button', 'Confirm').props.disabled).toBe(false);
    await find(tree, 'Button', 'Confirm').props.onClick(); tree = render();
    expect(submissions).toEqual([{ confirmation: 'RESET 1370', producersStopped: true }]);
    const rendered = JSON.stringify(tree);
    if (scenario === 'success') {
      expect(rendered).toContain('Cleanup Completed Successfully'); expect(rendered).toContain('Queues: ');
      expect(h.rows.insw_queue_cycle).toHaveLength(1);
    } else {
      expect(rendered).toContain('Cleanup Failed'); expect(h.rows.insw_queue_cycle).toHaveLength(2);
      expect(notices[0]).toContain(scenario === 'busy' ? 'busy attempt' : 'External INSW cleanup succeeded');
    }
    expect(h.remoteCalls).toBe(scenario === 'busy' ? 0 : 1);
  }
});

test('NR-02 idle web sessions are not used as live-sender evidence; table lock conflicts still refuse', async () => {
  // Simulated, not a PostgreSQL lock integration test: reject any query of idle
  // session catalogs/OS state and allow the existing mocked connection to remain.
  const source = readFileSync('lib/insw-queue/cleanup.ts', 'utf8');
  expect(source).not.toMatch(/pg_stat_activity|pg_terminate_backend|verifyReaped|\/proc\//);
  const h = harness(); staleOwner(h);
  expect((await h.post(request())).status).toBe(200);
  const writer = harness(); staleOwner(writer); writer.setFail('lock');
  const response = await writer.post(request()), body = await response.json();
  expect(response.status).toBe(409); expect(body.error.message).toContain('concurrent INSW writer');
  expect(writer.remoteCalls).toBe(0);
});

test('NR-07 release preserves a future recovery barrier and a larger historical sender interval', async () => {
  const h = harness(); staleOwner(h);
  const barrier = new Date('9999-01-01');
  h.setGate({ ...h.gate, prior_interval_ms: 9000, recovery_barrier_at: barrier });
  const start = h.gate.last_started_at;
  expect((await h.post(request())).status).toBe(200);
  expect(h.gate.last_started_at).toEqual(start); expect(h.gate.prior_interval_ms).toBe(9000);
  expect(h.gate.recovery_barrier_at).toEqual(barrier);
});

// Stop immediately after validation: no provider calls or data mutations.
test('configured public cleanup origins pass proxy boundaries while forged origins and invalid consent fail', async () => {
  for (const [configured, origin] of [['NEXTAUTH_URL', 'http://202.155.14.3'], ['ALLOWED_ORIGINS', 'http://202.155.14.3'],
    ['NEXTAUTH_URL', 'http://localhost:3000'], ['ALLOWED_ORIGINS', 'https://staging.example.invalid:8443']]) {
    for (const scenario of ['valid', 'wrong-confirmation', 'missing-confirmation', 'forged', 'forged-url', 'wrong-content-type', 'wrong-port', 'wrong-scheme', 'origin-path', 'missing-attestation', 'cross-site', 'missing-origin']) {
      const h = harness('staging', { DATABASE_PHASE: 'staging', [configured]: origin });
      h.setGate({ ...h.gate, busy_attempt_id: 'fixture-active' }); // validation passes into safe preflight refusal
      const headers: Record<string, string> = { 'content-type': 'application/json', origin,
        host: '202.155.14.3', 'x-forwarded-host': '202.155.14.3', 'x-forwarded-proto': 'http',
        referer: `${origin}/settings/database-cleanup` };
      if (scenario === 'forged') { headers.origin = 'http://evil.invalid'; headers.host = 'evil.invalid'; headers['x-forwarded-host'] = 'evil.invalid'; }
      if (scenario === 'forged-url') { headers.origin = 'http://internal.invalid'; headers.host = 'internal.invalid'; headers['x-forwarded-host'] = 'internal.invalid'; }
      if (scenario === 'wrong-content-type') headers['content-type'] = 'text/plain';
      if (scenario === 'wrong-scheme') headers.origin = origin.replace(/^http(s?):/, (_match, secure) => secure ? 'http:' : 'https:');
      if (scenario === 'wrong-port') headers.origin = new URL(origin).origin.replace(/:\d+$/, '') + ':9999';
      if (scenario === 'origin-path') headers.origin += '/cleanup';
      if (scenario === 'cross-site') headers['sec-fetch-site'] = 'cross-site';
      if (scenario === 'missing-origin') delete headers.origin;
      const body = scenario === 'missing-confirmation' ? {} : { confirmation: scenario === 'wrong-confirmation' ? 'RESET 1380' : 'RESET 1370', producersStopped: scenario !== 'missing-attestation' };
      const before = structuredClone(h.rows);
      const response = await h.post(new Request(`${scenario === 'forged-url' ? 'http://internal.invalid' : 'http://localhost:3000'}/api/admin/insw-cleanup`, { method: 'POST', headers, body: JSON.stringify(body) }));
      expect(response.status, `${configured}:${scenario}`).toBe(scenario === 'valid' ? 409 : scenario.includes('confirmation') || scenario === 'missing-attestation' ? 400 : 403);
      expect((await response.json()).error.code).toBe(scenario === 'valid' ? 'INSW_CLEANUP_QUEUE_BUSY' : 'INSW_CLEANUP_CONFIRMATION_REQUIRED');
      expect(h.remoteCalls).toBe(0); expect(h.rows).toEqual(before);
    }
  }
});
