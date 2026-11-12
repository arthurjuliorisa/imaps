import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as crypto from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import net from 'node:net';
import { Prisma } from '@prisma/client';
import { boundedText } from '../lib/insw-queue/contracts';
import * as identity from '../lib/insw-worker/process-identity';
import { cloneDatabaseUrl, assertCloneTarget, CLONE_ACK, CloneManifest, CloneTarget } from '../lib/insw-worker/clone-fence';

const oldIdentity = { ...identity.processIdentity(), host: 'historical-other-host', machine: '11111111111111111111111111111111' };
const token = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const m: CloneManifest = { phase: 'staging', host: '127.0.0.1', database: 'imaps_db_vps', role: 'imapsuser',
  port: 5432, databaseOid: '16384', schemaOid: '2200', serverAddress: '127.0.0.1',
  expectedToken: token, expectedIdentity: oldIdentity, operator: 'reviewer', acknowledgement: CLONE_ACK,
  provenance: 'Reviewed backup record vps/test/2026-11-06; restored to local nonproduction database.',
  endpointEvidence: 'Verified local PostgreSQL listener and connection mapping; target access controlled by operator.',
  shutdownEvidence: 'All target apps, workers, schedulers, supervisors and children stopped; no transmission in flight.' };
const env = { INSW_POST_RESTORE_ENABLED: 'controlled-nonproduction', DATABASE_PHASE: 'staging',
  NEXT_PUBLIC_ENVIRONMENT_PHASE: 'staging',
  INSW_POST_RESTORE_DATABASE_URL: 'postgresql://imapsuser@127.0.0.1:5432/imaps_db_vps?connection_limit=1' };
const target: CloneTarget = { database: m.database, role: m.role, session_role: m.role, database_oid: m.databaseOid,
  schema_name: 'public', schema_oid: m.schemaOid, port: m.port, server_address: m.serverAddress,
  backend_pid: 44, other_sessions: 0, prepared_transactions: 0, recovery: false, unsafe_configuration: false };
function load(file: string, requireModule: (name: string) => unknown) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText, { exports, require: requireModule, process, URL, Buffer });
  return exports;
}
function harness(options: { target?: Partial<CloneTarget>; busy?: boolean; unfinished?: boolean; identity?: unknown;
  failAudit?: boolean; failRelease?: boolean;
  activeLease?: boolean; priorInterval?: number; wrongToken?: boolean; manifest?: Partial<CloneManifest> } = {}) {
  const fence = load('lib/insw-worker/clone-fence.ts', name => {
    if (name === 'node:fs') return {};
    if (name === 'node:net') return net;
    if (name === 'node:crypto') return crypto;
    throw new Error(name);
  });
  const repository = load('lib/insw-worker/operational.repository.ts', name => {
    if (name === './clone-fence') return fence;
    if (name === './process-identity') return identity;
    if (name === '../insw-queue/contracts') return { boundedText };
    if (name === 'node:crypto') return crypto;
    if (name === '@prisma/client') return { Prisma };
    return {};
  });
  let owner: string | null = token;
  let audits: any[] = [];
  const statements: string[] = [];
  const heldClaims: any[] = [];
  const gate = { last_started_at: new Date('2026-11-06T07:59:20.685Z'), prior_interval_ms: options.priorInterval ?? 5000,
    busy_attempt_id: options.busy ? 'busy' : null };
  const tx: any = {
    $queryRaw: async (sql: TemplateStringsArray, ...values: unknown[]) => {
      const text = sql.join('?'); statements.push(text);
      if (text.includes('current_database()')) return [{ ...target, ...options.target }];
      if (text.includes(' AS busy')) return [{ busy: !!options.unfinished }];
      if (text.includes('SELECT process_identity')) return [{ process_identity: options.identity === undefined ? oldIdentity : options.identity }];
      if (text.includes(' AS expired')) return [{ recovery_barrier_at: new Date('2026-11-07T00:00:00Z'), expired: !options.activeLease }];
      if (text.includes('SELECT last_started_at')) return values[0] === owner && !options.wrongToken ? [{ ...gate }] : [];
      throw new Error(text);
    },
    $executeRaw: async (sql: TemplateStringsArray) => {
      const text = sql.join('?'); statements.push(text);
      if (text.includes('UPDATE insw_dispatch_gate')) {
        if (options.failRelease) throw new Error('synthetic release failure');
        owner = null;
      }
      return 1;
    },
    insw_worker_recovery: { create: async ({ data }: any) => {
      if (options.failAudit) throw new Error('synthetic audit failure');
      audits.push(data);
    } },
    insw_queue_attempt: { findUnique: async () => ({ owner_token: token,
      queue: { id: 'claim', owner_token: token, status: 'CLAIMED', delivery_state: 'POSSIBLY_STARTED' } }),
      updateMany: async () => ({ count: 1 }) },
    insw_queue_cycle: { update: async ({ data }: any) => { heldClaims.push(data); } },
  };
  const db = { $transaction: async (fn: any) => {
    const saved = { owner, audits: [...audits] };
    try { return await fn(tx); } catch (e) { owner = saved.owner; audits = saved.audits; throw e; }
  } };
  return { run: (review?: string) => repository.recoverPostRestoreOwnership(db, { ...m, ...options.manifest }, review),
    normal: () => repository.recoverOperationalOwnership(db, { expectedToken: token, operator: 'reviewer', evidence: 'reaped', shutdownAcknowledged: true }),
    statements, gate, heldClaims, state: () => ({ owner, audits }) };
}
const originalEnv = { ...process.env };
const connect = net.Socket.prototype.connect, fetch = globalThis.fetch;
test.beforeEach(() => { Object.assign(process.env, env); delete process.env.INSW_RECOVER_PRODUCTION;
  net.Socket.prototype.connect = (() => { throw new Error('NO_NETWORK'); }) as typeof connect;
  globalThis.fetch = async () => { throw new Error('NO_PROVIDER'); };
});
test.afterEach(() => { for (const k of Object.keys(process.env)) if (!(k in originalEnv)) delete process.env[k];
  Object.assign(process.env, originalEnv); net.Socket.prototype.connect = connect; globalThis.fetch = fetch; });

test('cross-host standard PostgreSQL dry-run is read-only, apply audits and preserves pacing without HTTP', async () => {
  const h = harness();
  const before = { ...h.gate };
  const plan = await h.run();
  expect(plan.applied).toBe(false); expect(plan.review.target).not.toHaveProperty('backend_pid');
  expect(h.state()).toEqual({ owner: token, audits: [] });
  expect(h.statements[0]).toBe('SET TRANSACTION READ ONLY');
  expect(h.statements.some(s => s.includes('FOR UPDATE'))).toBe(false);
  const start = h.statements.length;
  expect(await h.run(plan.reviewSha256)).toEqual({ held: 0 });
  expect(h.statements[start]).toContain('SHARE ROW EXCLUSIVE MODE NOWAIT');
  expect(h.state().owner).toBeNull(); expect(h.state().audits).toHaveLength(1);
  expect(h.state().audits[0]).toMatchObject({ old_owner_token: token, process_identity: oldIdentity });
  expect(h.state().audits[0].evidence).toContain('post-restore clone; manifest-sha256=');
  expect(h.gate).toEqual(before);
  const release = h.statements.find(s => s.includes('UPDATE insw_dispatch_gate'))!;
  expect(release).not.toMatch(/last_started_at\s*=|prior_interval_ms\s*=/);
  expect(release).toContain('ELSE recovery_barrier_at END');
  expect(release).toContain('WHERE id = 1 AND owner_token =');
});
test('normal recovery still rejects cross-host with clone opt-in set', async () => {
  process.env.INSW_RECOVER_PRODUCTION = 'true';
  const h = harness(); await expect(h.normal()).rejects.toThrow('UNVERIFIABLE_OWNER_HOST');
  expect(h.state().owner).toBe(token); expect(h.state().audits).toEqual([]);
});
test('ordinary same-host reaping still holds uncertain delivery without retry', async () => {
  const h = harness({ busy: true, identity: { ...identity.processIdentity(), boot: 'prior-boot' } });
  expect(await h.normal()).toEqual({ held: 1 });
  expect(h.heldClaims).toEqual([{ status: 'HELD', owner_token: null, lease_until: null, hold_reason: 'DELIVERY_UNKNOWN' }]);
  expect(h.state().audits).toHaveLength(1);
});
for (const [label, options, code] of [
  ['wrong token', { wrongToken: true }, 'STREAM_OWNER_LOST'],
  ['missing identity', { identity: null }, 'LEGACY_OWNER'],
  ['malformed identity', { identity: { host: 'legacy' } }, 'CLONE_STORED_IDENTITY_MISMATCH'],
  ['active owner lease', { activeLease: true }, 'CLONE_OWNER_LEASE'],
  ['busy gate', { busy: true }, 'CLONE_BUSY'],
  ['active claim or unfinished attempt', { unfinished: true }, 'CLONE_ACTIVE_OR_UNKNOWN'],
  ['other connection', { target: { other_sessions: 1 } }, 'CLONE_OTHER_CONNECTIONS'],
  ['prepared transaction', { target: { prepared_transactions: 1 } }, 'CLONE_OTHER_CONNECTIONS'],
  ['enabled subscription', { target: { unsafe_configuration: true } }, 'CLONE_UNSAFE_TARGET'],
  ['invalid pacing', { priorInterval: 3599 }, 'CLONE_BUSY_OR_INCONSISTENT'],
] as const) test(`refuses ${label} without mutations`, async () => {
  for (const review of [undefined, '0'.repeat(64)]) {
    const h = harness(options); await expect(h.run(review)).rejects.toThrow(code);
    expect(h.state()).toEqual({ owner: token, audits: [] });
  }
});
for (const field of ['database_oid', 'schema_oid', 'schema_name', 'database', 'role', 'session_role', 'port', 'server_address', 'recovery']) {
  test(`exact verified target mismatch: ${field}`, () => expect(() => assertCloneTarget(m, { ...target, [field]: 'unexpected' })).toThrow('CLONE_UNSAFE_TARGET_MISMATCH'));
}
for (const delta of [{ INSW_POST_RESTORE_ENABLED: undefined }, { NEXT_PUBLIC_ENVIRONMENT_PHASE: 'production' },
  { DATABASE_PHASE: 'production' }, { DATABASE_PHASE: undefined }, { DATABASE_PHASE: 'unknown' }, { INSW_RECOVER_PRODUCTION: 'true' },
  { INSW_POST_RESTORE_DATABASE_URL: env.INSW_POST_RESTORE_DATABASE_URL.replace('127.0.0.1', 'localhost') },
  { INSW_POST_RESTORE_DATABASE_URL: env.INSW_POST_RESTORE_DATABASE_URL.replace('imaps_db_vps', 'production') },
  { INSW_POST_RESTORE_DATABASE_URL: env.INSW_POST_RESTORE_DATABASE_URL + '&schema=other' },
  { INSW_POST_RESTORE_DATABASE_URL: env.INSW_POST_RESTORE_DATABASE_URL + '&host=production' },
  { INSW_POST_RESTORE_DATABASE_URL: env.INSW_POST_RESTORE_DATABASE_URL + '&connection_limit=1' }]) {
  test(`forged/insufficient environment refused: ${JSON.stringify(delta, (_key, value) => value === undefined ? 'missing' : value)}`, () => {
    expect(() => cloneDatabaseUrl({ ...env, ...delta, NODE_ENV: 'production', INSW_1370_USE_TEST_MODE: 'true' }, m)).toThrow();
  });
}
test('standard local TCP application role and production Next.js build mode accepted', async () => {
  expect(cloneDatabaseUrl({ ...env, NODE_ENV: 'production' }, m)).toContain('127.0.0.1:5432/imaps_db_vps');
  const h = harness(); const plan = await h.run(); await h.run(plan.reviewSha256);
  expect(h.state().owner).toBeNull();
  // No privileged physical/server configuration queries are needed.
  expect(h.statements.join(' ')).not.toMatch(/pg_control|data_directory|rolsuper|listen_addresses/);
  expect(h.statements.join(' ')).toContain('datname = current_database()');
});
test('standard VPS Test endpoint supported with exact server address and normal role', async () => {
  const vps = { ...m, host: 'test-db.internal', serverAddress: '10.0.0.5' };
  expect(cloneDatabaseUrl({ ...env, INSW_POST_RESTORE_DATABASE_URL:
    'postgresql://imapsuser@test-db.internal:5432/imaps_db_vps?connection_limit=1&sslmode=require' }, vps)).toContain('test-db.internal');
  expect(() => assertCloneTarget(vps, { ...target, server_address: vps.serverAddress })).not.toThrow();
  process.env.INSW_POST_RESTORE_DATABASE_URL = 'postgresql://imapsuser@test-db.internal:5432/imaps_db_vps?connection_limit=1&sslmode=require';
  const h = harness({ manifest: vps, target: { server_address: vps.serverAddress } });
  const plan = await h.run(); await h.run(plan.reviewSha256);
  expect(h.state().owner).toBeNull();
});
test('operator input errors are distinct from unsafe deployment and target errors', () => {
  expect(() => cloneDatabaseUrl(env, { ...m, host: 'db.production.internal' })).toThrow('CLONE_UNSAFE_PRODUCTION_TARGET');
  expect(() => cloneDatabaseUrl(env, { ...m, expectedToken: '' })).toThrow('CLONE_EXPECTED_OWNER_REQUIRED');
  expect(() => cloneDatabaseUrl(env, { ...m, acknowledgement: '' })).toThrow('CLONE_ACKNOWLEDGEMENT_REQUIRED');
  expect(() => cloneDatabaseUrl(env, { ...m, provenance: '' })).toThrow('CLONE_OPERATOR_EVIDENCE_REQUIRED');
  expect(() => cloneDatabaseUrl({ ...env, DATABASE_PHASE: 'production' }, m)).toThrow('CLONE_UNSAFE_DEPLOYMENT_PHASE');
  expect(() => assertCloneTarget(m, { ...target, database: 'other' })).toThrow('CLONE_UNSAFE_TARGET_MISMATCH');
});
test('changed review refuses and transaction failure rolls back audit and ownership', async () => {
  const h = harness(); await expect(h.run('0'.repeat(64))).rejects.toThrow('CLONE_DRY_RUN_REVIEW_MISMATCH');
  for (const options of [{ failAudit: true }, { failRelease: true }]) {
    const failing = harness(options); const plan = await failing.run();
    await expect(failing.run(plan.reviewSha256)).rejects.toThrow('synthetic');
    expect(failing.state()).toEqual({ owner: token, audits: [] });
  }
});
test('cleanup compatibility uses same lock scope and refuses residual claims; no cleanup bypass', () => {
  const cleanup = readFileSync('lib/insw-queue/cleanup.ts', 'utf8');
  expect(cleanup).toContain('gate.owner_token !== null');
  expect(cleanup).toContain('gate.busy_attempt_id !== null');
  expect(cleanup).toContain("status: { in: ['CLAIMED', 'REMOTE_SUCCEEDED'] }");
  expect(cleanup).toContain('completed_at: null');
  const repository = readFileSync('lib/insw-worker/operational.repository.ts', 'utf8');
  expect(repository).toContain('} else verifyReaped(row.process_identity);');
  expect(repository).toContain("'DELIVERY_UNKNOWN'");
});

test('review binds all evidence and observed identity; backend PID alone may change', async () => {
  const plan = await harness().run();
  for (const options of [{ manifest: { provenance: m.provenance + ' changed' } },
    { target: { database_oid: '999' } }, { priorInterval: 6000 }, { identity: { ...oldIdentity, start: '99' } }]) {
    const h = harness(options);
    await expect(h.run(plan.reviewSha256)).rejects.toThrow();
    expect(h.state()).toEqual({ owner: token, audits: [] });
  }
  const h = harness({ target: { backend_pid: 99 } });
  await h.run(plan.reviewSha256); expect(h.state().owner).toBeNull();
});
test('recovery checks ambiguous results and has no deletion/replay operations', async () => {
  const h = harness(); const plan = await h.run(); await h.run(plan.reviewSha256);
  expect(h.statements.join(' ')).toContain("delivery_state = 'POSSIBLY_STARTED'");
  expect(h.statements.join(' ')).toContain("hold_reason = 'DELIVERY_UNKNOWN'");
  expect(h.statements.join(' ')).not.toMatch(/DELETE|TRUNCATE/);
  expect(h.heldClaims).toEqual([]);
});

test('non-superuser is eligible and uncertain server identity is refused', () => {
  const applicationRole = { ...target, superuser: false };
  expect(() => assertCloneTarget(m, applicationRole)).not.toThrow();
  expect(() => assertCloneTarget(m, { ...target, server_address: null })).toThrow('CLONE_UNSAFE_TARGET');
});
test('missing opt-in and missing trusted phase refuse apply before starting a transaction', async () => {
  for (const key of ['INSW_POST_RESTORE_ENABLED', 'DATABASE_PHASE']) {
    const saved = process.env[key]; delete process.env[key];
    const h = harness(); await expect(h.run('0'.repeat(64))).rejects.toThrow();
    expect(h.statements).toEqual([]); expect(h.state()).toEqual({ owner: token, audits: [] });
    process.env[key] = saved;
  }
});
