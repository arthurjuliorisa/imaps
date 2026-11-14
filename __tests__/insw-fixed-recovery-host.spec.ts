import { test, expect } from '@playwright/test';
import { recoverFixedWorker, type GateSnapshot, type RecoveryFacts } from '../lib/insw-worker/fixed-recovery-engine';
import type { ProcessIdentity } from '../lib/insw-worker/process-identity';
import { readFileSync } from 'node:fs';
const identity: ProcessIdentity = { host: 'fixture', machine: 'fixture', boot: 'boot', pid: 123, uid: 1000, start: '20', pidNamespace: 'pid:[1]' };
function harness(overrides: Partial<RecoveryFacts> = {}, initial: Partial<GateSnapshot> = {}) {
  let gate: GateSnapshot = { owner_token: 'old', process_identity: identity, busy_attempt_id: null, coherent: true, ...initial };
  const calls: string[] = [];
  const facts: RecoveryFacts = {
    gate: async () => ({ ...gate }), supervisor: async () => ({ stopped: !calls.includes('start'), pid: calls.includes('start') ? 124 : 0 }),
    ready: async (g, pid) => g.owner_token === 'new' && pid === 124,
    proveReaped: async () => { calls.push('prove'); return 'actual-fixture-evidence'; },
    recover: async (token, actor, evidence) => {
      expect(token).toBe('old'); expect(actor).toBe('service:fixture'); expect(evidence).toBe('actual-fixture-evidence');
      calls.push('recover'); gate = { ...gate, owner_token: null, process_identity: null };
    },
    start: async () => { calls.push('start'); gate = { ...gate, owner_token: 'new', process_identity: { ...identity, pid: 124 } }; },
    pause: async () => { calls.push('pause'); }, ...overrides,
  };
  return { calls, run: () => recoverFixedWorker(facts, 'service:fixture', value => calls.push(value)) };
}
test('healthy matching worker is a nondestructive no-op', async () => {
  const h = harness({ ready: async () => true, supervisor: async () => ({ stopped: false, pid: 123 }) });
  expect(await h.run()).toBe('already-running'); expect(h.calls).toEqual(['Checking']);
});
test('stopped reaped owner reuses expected token recovery before new readiness', async () => {
  const h = harness(); expect(await h.run()).toBe('running');
  expect(h.calls).toEqual(['Checking', 'prove', 'Recovering', 'recover', 'Starting', 'start']);
});
test('absent coherent owner starts without manufacturing audit recovery', async () => {
  const h = harness({}, { owner_token: null, process_identity: null });
  expect(await h.run()).toBe('running'); expect(h.calls).not.toContain('recover'); expect(h.calls).not.toContain('Recovering');
});
for (const reason of ['LIVE', 'FOREIGN_HOST', 'PID_REUSE', 'UNKNOWN_NAMESPACE', 'DESCENDANTS_PRESENT']) {
  test(`host proof refuses ${reason} without recovery or restart`, async () => {
    const h = harness({ proveReaped: async () => { throw new Error(reason); } });
    await expect(h.run()).rejects.toThrow(reason); expect(h.calls).toEqual(['Checking']);
  });
}
for (const initial of [{ busy_attempt_id: 'pending' }, { coherent: false }, { process_identity: null }]) {
  test(`unsafe gate refuses ${JSON.stringify(initial)}`, async () => {
    const h = harness({}, initial); expect(await h.run()).toBe('refused'); expect(h.calls).not.toContain('recover'); expect(h.calls).not.toContain('start');
  });
}
test('online but unready worker is refused without restart', async () => {
  const h = harness({ supervisor: async () => ({ stopped: false, pid: 123 }) });
  expect(await h.run()).toBe('refused'); expect(h.calls).toEqual(['Checking']);
});
test('stale owner exception prevents startup', async () => {
  const h = harness({ recover: async () => { throw new Error('STREAM_OWNER_LOST'); } });
  await expect(h.run()).rejects.toThrow('STREAM_OWNER_LOST'); expect(h.calls).not.toContain('start');
});
test('PM2 failure never reports running', async () => {
  const h = harness({ start: async () => { throw new Error('private PM2 output'); } });
  await expect(h.run()).rejects.toThrow(); expect(h.calls).not.toContain('pause');
});
test('readiness is bounded and PM2 online alone never succeeds', async () => {
  const h = harness({ ready: async () => false }); expect(await h.run()).toBe('refused');
  expect(h.calls.filter(x => x === 'pause')).toHaveLength(20);
});
// Execute the concrete host adapter with every OS, supervisor and DB dependency
// injected. No Prisma client, /proc probe, PM2 invocation or network can escape.
import vm from 'node:vm';
import * as crypto from 'node:crypto';
import ts from 'typescript';
import { recoverFixedWorker as engine } from '../lib/insw-worker/fixed-recovery-engine';
function concreteHost(options: { proofError?: string; descendants?: boolean; sameBoot?: boolean; ready?: boolean;
  pm2Failure?: boolean; unowned?: boolean; online?: boolean; account?: boolean; namespace?: boolean; dbFailure?: boolean;
  duplicate?: boolean; missingDaemon?: boolean; foreign?: boolean; wrongDatabase?: boolean; gate?: Partial<GateSnapshot> } = {}) {
  let started = !!options.online;
  const local = { ...identity, boot: 'current-boot', pid: 900 };
  const old = { ...identity, boot: options.sameBoot ? local.boot : 'previous-boot' };
  const running = { ...local, pid: 124, start: '21' };
  let gate: GateSnapshot = { owner_token: options.unowned ? null : options.online ? 'new' : 'old',
    process_identity: options.unowned ? null : options.online ? running : old,
    coherent: true, busy_attempt_id: null, ...options.gate };
  const calls: string[] = [], diagnostics: string[] = [];
  const config = { root: '/fixture', runtime: '/pm2/imaps-worker-recovery', pm2Home: '/pm2', home: '/home', uid: 1000, node: '/node', pm2: '/pm2-cli' };
  const fs = {
    readFileSync: (path: string) => {
      if (path.endsWith('pm2.pid')) { if (options.missingDaemon) throw new Error('absent'); return '42'; }
      if (path.endsWith('ready.json')) return JSON.stringify({ token: options.ready === false ? 'stale' : 'new', identity: running });
      if (path.endsWith('cmdline')) return path.includes('/125/') ? 'node\0/fixture/scripts/insw-worker.ts\0' : 'PM2 God Daemon';
      if (path.endsWith('stat')) { const fields = Array(20).fill('0'); fields[19] = path.includes('/124/') ? '21' : '20'; return '124 (node) ' + fields.join(' '); }
      throw new Error(`UNMOCKED_FS:${path}`);
    }, readdirSync: () => options.descendants ? ['42', '125'] : ['42'],
    readlinkSync: () => options.namespace ? 'foreign' : identity.pidNamespace,
    statSync: () => ({ uid: options.account ? 999 : 1000 }),
  };
  const imports: Record<string, unknown> = {
    'node:child_process': { execFile: async (file: string, args: string[], execOptions: any) => {
      expect(file).toBe('/node'); expect(args[0]).toBe('/pm2-cli'); expect(execOptions.cwd).toBe('/fixture');
      expect(execOptions.shell).toBeUndefined();
      const action = args[1]; calls.push(action);
      if (action === 'restart') {
        expect(args).toEqual(['/pm2-cli', 'restart', '/fixture/ecosystem.insw-worker.config.js', '--only', 'imaps-insw-worker', '--update-env']);
        if (options.pm2Failure) throw new Error('private PM2 failure');
        started = true; gate = { ...gate, owner_token: 'new', process_identity: running };
        return { stdout: '' };
      }
      if (action !== 'jlist') throw new Error('UNALLOWLISTED_COMMAND');
      const app = { name: 'imaps-insw-worker', pid: started ? 124 : 0,
        pm2_env: { pm_cwd: '/fixture', pm_exec_path: '/fixture/scripts/insw-worker.ts', autorestart: false,
          watch: false, exec_mode: 'fork_mode', exec_interpreter: 'node', node_args: ['--import', 'tsx'],
          DATABASE_URL: options.wrongDatabase ? 'other-private-url' : 'private-fixture-db', NEXT_PUBLIC_ENVIRONMENT_PHASE: 'development', status: started ? 'online' : 'stopped' } };
      return { stdout: JSON.stringify([{ name: 'imaps' }, app, ...(options.duplicate ? [app] : [])]) };
    } },
    'node:crypto': crypto,
    'node:util': { promisify: (fn: unknown) => fn }, 'node:fs': fs, 'node:path': { join: (...s: string[]) => s.join('/') },
    './operational.repository': { recoverOperationalOwnership: async (_db: unknown, input: any) => {
      expect(input.expectedToken).toBe('old'); expect(input.shutdownAcknowledged).toBe(true);
      expect(input.evidence).toContain('Fixture operator verified supervisor shutdown and descendant reap');
      const repository = manualRecoveryFixture();
      await repository.run(input.shutdownAcknowledged);
      expect(repository.calls).toContain('audit');
      expect(repository.historical).toEqual({ status: 'HELD', delivery_state: 'POSSIBLY_STARTED', owner_token: null });
      calls.push('recover'); gate = { ...gate, owner_token: null, process_identity: null };
    } },
    './process-identity': { processIdentity: () => local, verifyReaped: () => {
      calls.push('verifyReaped'); if (options.proofError || options.foreign) throw new Error(options.proofError || 'UNVERIFIABLE_OWNER_HOST');
    } },
    './fixed-recovery-engine': { recoverFixedWorker: engine },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/insw-worker/fixed-recovery-host.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, Buffer, process: { env: { DATABASE_URL: 'private-fixture-db', NEXT_PUBLIC_ENVIRONMENT_PHASE: 'development', NEXTAUTH_SECRET: 'fixture-only-signing-secret' }, stderr: { write: (value: string) => diagnostics.push(value) } }, setTimeout: (fn: () => void) => fn(), require: (name: string) => {
    if (!(name in imports)) throw new Error(`UNMOCKED_IMPORT:${name}`); return imports[name];
  } });
  const historical = { status: 'HELD', delivery_state: 'POSSIBLY_STARTED' };
  const queries: string[] = [];
  const run = (acknowledgement?: unknown, actor = 'admin') => exports.fixedRecoveryHost({ $queryRaw: async (parts: TemplateStringsArray) => {
    queries.push(parts.join('?'));
    if (options.dbFailure) throw new Error('private DB URL');
    return [{ ...gate, last_started_at: new Date('2026-11-14T00:00:00Z'), prior_interval_ms: 3600,
      recovery_barrier_at: null, lease_until: gate.owner_token ? new Date('2026-11-14T00:00:00Z') : null }];
  } }, config, actor, () => {}, acknowledgement);
  const acknowledge = (confirmation: string) => ({ confirmation, shutdownAcknowledged: true,
    evidence: 'Fixture operator verified supervisor shutdown and descendant reap' });
  return { calls, diagnostics, queries, historical, run, acknowledge,
    changeOwner: () => { gate = { ...gate, owner_token: 'changed' }; },
    confirm: async () => { const challenge = await run(); expect(challenge.result).toBe('confirmation-required'); return run(acknowledge(challenge.confirmation)); } };

}
test('shared PM2 daemon supports healthy no-op with matching application ownership', async () => {
  const h = concreteHost({ online: true }); expect(await h.run()).toBe('already-running');
  expect(h.calls).toEqual(['jlist']);
});
test('prior boot retains explicit manual acknowledgement before audited recovery and readiness', async () => {
  const h = concreteHost(); expect(await h.confirm()).toBe('running');
  expect(h.calls.indexOf('verifyReaped')).toBeLessThan(h.calls.indexOf('recover'));
  expect(h.calls.filter(x => x === 'restart')).toHaveLength(1);
});
test('coherent unowned stopped worker starts without recovery audit', async () => {
  const h = concreteHost({ unowned: true }); expect(await h.run()).toBe('running');
  expect(h.calls).not.toContain('recover'); expect(h.calls).not.toContain('verifyReaped');
});
for (const option of [{ descendants: true }, { proofError: 'OWNER_PROCESS_NOT_REAPED' },
  { account: true }, { namespace: true }, { dbFailure: true }, { duplicate: true }, { missingDaemon: true }, { foreign: true }, { wrongDatabase: true }]) {
  test(`concrete host refuses unproven facts ${JSON.stringify(option)}`, async () => {
    const h = concreteHost(option); await expect(h.run()).rejects.toThrow(); expect(h.calls).not.toContain('recover'); expect(h.calls).not.toContain('restart');
  });
}
test('concrete host rejects stale readiness and PM2 restart failure', async () => {
  expect(await concreteHost({ ready: false }).confirm()).toBe('refused');
  await expect(concreteHost({ pm2Failure: true }).confirm()).rejects.toThrow();
});

import { EventEmitter } from 'node:events';
test('competing web callers use one nonblocking OS lock; the loser cannot report success', async () => {
  let held = false, starts = 0, fail = false;
  const config = { runtime: '/private', root: '/fixture', node: '/node', home: '/home/fixture', pm2Home: '/pm2' };
  const imports: Record<string, unknown> = {
    '../insw-worker/recovery-installation': { recoveryInstallation: () => config },
    'node:path': { dirname: () => '/fixture/bin' },
    'node:child_process': { spawn: (file: string, args: string[], options: any) => {
      expect(file).toBe('/usr/bin/flock'); expect(args.slice(0, 4)).toEqual(['--nonblock', '--conflict-exit-code', '75', '/private/recovery.lock']);
      expect(options.env.NODE_OPTIONS).toBe('');
      const child: any = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      const input: any = new EventEmitter(); input.end = () => {};
      child.stdin = input; child.kill = () => {};
      if (held) queueMicrotask(() => child.emit('close', 75));
      else {
        held = true; starts++;
        setTimeout(() => { child.stdout.emit('data', Buffer.from(fail ? '{"result":"refused"}\n' : '{"stage":"Checking"}\n{"result":"running"}\n')); held = false; child.emit('close', fail ? 1 : 0); }, 5);
      }
      return child;
    } },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/insw-queue/worker-recovery.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, process: { env: { NEXT_PUBLIC_ENVIRONMENT_PHASE: 'development' } }, setTimeout, clearTimeout,
    console: { error: () => {} }, require: (name: string) => { if (!(name in imports)) throw new Error(`UNMOCKED_IMPORT:${name}`); return imports[name]; } });
  const host = exports.fixedWorkerRecoveryHost;
  expect(await Promise.all([host.recoverAndRestart({ requestedBy: 'admin' }), host.recoverAndRestart({ requestedBy: 'admin' })])).toEqual(['running', 'refused']);
  expect(starts).toBe(1);
  fail = true; expect(await host.recoverAndRestart({ requestedBy: 'admin' })).toBe('refused');
  fail = false; expect(await host.recoverAndRestart({ requestedBy: 'admin' })).toBe('running');
  expect(starts).toBe(3);
  expect(await host.recoverAndRestart({ requestedBy: 'admin;restart all' })).toBe('refused'); expect(starts).toBe(3);
});

test('deployment resolves existing same-account PM2 and creates a stable private lock without root installation', async () => {
  for (const failure of ['', 'pm2-775', 'uid', 'cwd', 'writable', 'symlink', 'lock-owner', 'pm2-account', 'pm2-foreign-group', 'pm2-world-write', 'malicious-cli', 'root']) {
    const exports: any = {}, opened: string[] = [];
    const uid = failure === 'root' ? 0 : 1000;
    const fs = {
      readFileSync: () => JSON.stringify({ name: 'pm2' }),
      constants: { O_CREAT: 1, O_RDWR: 2, O_NOFOLLOW: 4 },
      mkdirSync: () => {}, closeSync: () => {}, openSync: (path: string, flags: number, mode: number) => {
        expect(flags).toBe(7); expect(mode).toBe(0o600); opened.push(path); return 1;
      },
      lstatSync: (path: string) => ({ isFile: () => true, isDirectory: () => failure !== 'symlink', nlink: 1,
        uid: failure === 'lock-owner' ? 999 : 1000, mode: 0o700 }),
      statSync: (path: string) => ({ uid: failure === 'pm2-account' && path === '/pm2' ? 999 : 1000,
        gid: failure === 'pm2-foreign-group' ? 999 : 1000, isDirectory: () => true,
        mode: path === '/pm2' && ['pm2-775', 'pm2-foreign-group'].includes(failure) ? 0o775
          : failure === 'writable' || (failure === 'pm2-world-write' && path === '/pm2')
            || (failure === 'malicious-cli' && path === '/global/lib/node_modules/pm2/bin/pm2') ? 0o777 : 0o700 }),
      realpathSync: (path: string) => failure === 'cwd' && path.includes('/scripts/') ? '/foreign'
        : path === '/bin/pm2' ? '/global/lib/node_modules/pm2/bin/pm2' : path,
    };
    const imports: Record<string, unknown> = { 'node:fs': fs, 'node:os': { homedir: () => '/home' },
      'node:path': { basename: (path: string) => path.split('/').pop(), dirname: (path: string) => path.slice(0, path.lastIndexOf('/')), isAbsolute: (path: string) => path.startsWith('/'), join: (...s: string[]) => s.join('/'), delimiter: ':' } };
    vm.runInNewContext(ts.transpileModule(readFileSync('lib/insw-worker/recovery-installation.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, process: { platform: 'linux', execPath: '/node', getuid: () => failure === 'uid' ? undefined : uid, getgid: () => 1000,
      cwd: () => '/fixture', env: { PM2_HOME: '/pm2', PATH: '/bin' } },
      require: (name: string) => { if (!(name in imports)) throw new Error(`UNMOCKED_IMPORT:${name}`); return imports[name]; } });
    if (failure && failure !== 'pm2-775') expect(() => exports.recoveryInstallation()).toThrow();
    else {
      exports.recoveryInstallation({ readOnly: true }); expect(opened).toEqual([]);
      expect(exports.recoveryInstallation()).toEqual({ uid: 1000, root: '/fixture', home: '/home', pm2Home: '/pm2',
        pm2: '/global/lib/node_modules/pm2/bin/pm2', node: '/node', runtime: '/pm2/imaps-worker-recovery' });
      exports.recoveryInstallation(); expect(opened).toEqual(['/pm2/imaps-worker-recovery/recovery.lock', '/pm2/imaps-worker-recovery/recovery.lock']);
    }
    const adapter: any = {};
    vm.runInNewContext(ts.transpileModule(readFileSync('lib/insw-queue/worker-recovery.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports: adapter, process: { env: { NEXT_PUBLIC_ENVIRONMENT_PHASE: 'staging', DATABASE_PHASE: 'staging' } },
      console: { error() {} }, require: (name: string) => {
        if (name === '../insw-worker/recovery-installation') return exports;
        if (name === 'node:path') return imports[name];
        if (name === 'node:child_process') return { spawn: () => { throw new Error('RECOVERY_EXECUTION_FORBIDDEN'); } };
        throw new Error(`UNMOCKED_IMPORT:${name}`);
      } });
    expect(adapter.fixedWorkerRecoveryHost.available()).toBe(!failure || failure === 'pm2-775');
    if (failure === 'pm2-775') {
      const status: any = {}, reads: unknown[] = [];
      vm.runInNewContext(ts.transpileModule(readFileSync('lib/insw-worker/supervisor-status.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
      }).outputText, { exports: status, process: { env: {} }, require: (name: string) => {
        if (name === './recovery-installation') return exports;
        if (name === 'node:path') return imports[name];
        if (name === 'node:util') return { promisify: (fn: unknown) => fn };
        if (name === 'node:fs') return { ...fs, readFileSync: (path: string) => path.endsWith('pm2.pid') ? '1614' : 'PM2 God Daemon',
          readlinkSync: () => 'pid:[1]', lstatSync: () => ({ uid: 1000, isSocket: () => true }) };
        if (name === 'node:child_process') return { execFile: async (...args: unknown[]) => {
          reads.push(args);
          return { stdout: JSON.stringify([{ name: 'imaps-insw-worker', pm2_env: {
            pm_cwd: '/fixture', pm_exec_path: '/fixture/scripts/insw-worker.ts', status: 'stopped',
          } }]) };
        } };
        throw new Error(`UNMOCKED_IMPORT:${name}`);
      } });
      expect(await status.workerSupervisorStatus()).toEqual({ status: 'stopped', reason: 'observed' });
      expect(reads).toHaveLength(1);
    }
  }
});

test('existing verifyReaped validates full host identity and refuses live or reused PID', () => {
  for (const mode of ['reaped', 'live', 'reused', 'foreign', 'uid', 'namespace', 'missing-start']) {
    const exports: any = {};
    const fs = { readFileSync: (path: string) => path === '/etc/machine-id' ? 'fixture' : path.includes('boot_id') ? 'boot'
      : '900 (node) ' + [...Array(19).fill('0'), '30'].join(' '), existsSync: () => ['live', 'reused'].includes(mode), readlinkSync: () => 'pid:[1]' };
    vm.runInNewContext(ts.transpileModule(readFileSync('lib/insw-worker/process-identity.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, process: { pid: 900, platform: 'linux', getuid: () => 1000 }, require: (name: string) => {
      if (name === 'node:fs') return fs; if (name === 'node:os') return { hostname: () => 'fixture' }; throw new Error(`UNMOCKED_IMPORT:${name}`);
    } });
    const old = { ...identity, ...(mode === 'foreign' ? { machine: 'other' } : mode === 'uid' ? { uid: 999 } : mode === 'namespace' ? { pidNamespace: 'foreign' } : mode === 'missing-start' ? { start: '' } : {}) };
    if (mode === 'reaped') expect(() => exports.verifyReaped(old)).not.toThrow();
    else expect(() => exports.verifyReaped(old)).toThrow();
  }
});

test('worker readiness follows successful first admission and is absent on initialization failure', async () => {
  for (const fail of [false, true]) {
    const calls: string[] = [], exports: any = {}, stop = new AbortController();
    const imports: Record<string, unknown> = {
      '../insw-queue/contracts': { integer: () => {} },
      '../config/insw-worker-config': { validateWorkerAllowedCompanies: (value: unknown) => value },
      './transport': { executeFrozenRequest: () => { throw new Error('PROVIDER_FORBIDDEN'); } },
      './operational.repository': {
        acquireOperationalOwnership: async () => { calls.push('owner'); return 'private-token'; },
        admitNext: async () => { calls.push('admission'); if (fail) throw new Error('DB_UNREADY'); return { job: null, waitMs: 0 }; },
      }, './elapsed-pacing': { ElapsedPacing: class {} },
    };
    vm.runInNewContext(ts.transpileModule(readFileSync('lib/insw-worker/isolated-worker.ts', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, setTimeout, clearTimeout, require: (name: string) => {
      if (!(name in imports)) throw new Error(`UNMOCKED_IMPORT:${name}`); return imports[name];
    } });
    const task = exports.runIsolatedWorker({ db: {}, signal: stop.signal, allowedCompanies: [1370], timeoutMs: 100,
      onReady: (token: string) => { expect(token).toBe('private-token'); calls.push('ready'); stop.abort(); } });
    if (fail) { await expect(task).rejects.toThrow('DB_UNREADY'); expect(calls).toEqual(['owner', 'admission']); }
    else { await task; expect(calls).toEqual(['owner', 'admission', 'ready']); }
  }
});

test('fixed entrypoint rejects untrusted stdin/arguments and only forwards the authenticated actor', async () => {
  for (const variant of ['valid', 'acknowledged', 'invalid-ack', 'command', 'owner', 'injection', 'oversized', 'arguments', 'unlocked']) {
    const exports: any = {}, calls: string[] = [];
    const body = variant === 'acknowledged' ? JSON.stringify({ requestedBy: 'admin', acknowledgement: { confirmation: '1999999999999.' + 'a'.repeat(64), shutdownAcknowledged: true, evidence: 'Verified fixture shutdown' } })
      : variant === 'invalid-ack' ? '{"requestedBy":"admin","acknowledgement":{"shutdownAcknowledged":true}}'
      : variant === 'command' ? '{"requestedBy":"admin","command":"restart all"}'
      : variant === 'owner' ? '{"requestedBy":"admin","ownerToken":"secret"}'
      : variant === 'injection' ? '{"requestedBy":"admin; pm2 restart all"}'
      : variant === 'oversized' ? 'x'.repeat(4097) : '{"requestedBy":"admin"}';
    const env = { IMAPS_RECOVERY_LOCKED: variant === 'unlocked' ? '' : '1', DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/fixture' };
    const imports: Record<string, unknown> = {
      '../../lib/insw-worker/recovery-installation': { recoveryInstallation: () => ({ root: '/fixture' }) },
      '../../lib/insw-queue/worker-recovery': { workerRecoveryAllowed: () => true },
      '../../lib/insw-worker/fixed-recovery-host': { fixedRecoveryHost: async (_db: unknown, _config: unknown, actor: string, _stage: unknown, acknowledgement: any) => {
        expect(acknowledgement).toEqual(variant === 'acknowledged' ? { confirmation: '1999999999999.' + 'a'.repeat(64), shutdownAcknowledged: true, evidence: 'Verified fixture shutdown' } : undefined);
        calls.push(actor); return 'running'; } },
      dotenv: { config: () => {} },
      '@prisma/client': { PrismaClient: class { async $disconnect() {} } },
    };
    let source = readFileSync('scripts/host/insw-worker-recovery.ts', 'utf8');
    source = source.slice(0, source.indexOf('main().catch')).replace('async function main()', 'export async function main()');
    vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, {
      exports, URL, Buffer, process: { argv: variant === 'arguments' ? ['node', 'helper', 'restart-all'] : ['node', 'helper'], env,
        stdin: { async *[Symbol.asyncIterator]() { yield Buffer.from(body); } }, stdout: { write() {} }, stderr: { write() {} } },
      setTimeout: () => ({ unref() {} }), clearTimeout: () => {}, require: (name: string) => {
        if (!(name in imports)) throw new Error(`UNMOCKED_IMPORT:${name}`); return imports[name];
      },
    });
    if (['valid', 'acknowledged'].includes(variant)) { await exports.main(); expect(calls).toEqual(['admin']); }
    else { await expect(exports.main()).rejects.toThrow(); expect(calls).toEqual([]); }
  }
});


test('worker entrypoint keeps ownership token out of process logs while recording private readiness', async () => {
  const exports: any = {}, output: string[] = [], observed: string[] = [];
  const imports: Record<string, unknown> = {
    '../lib/insw-worker/safety': { startupDecision: () => 'ENABLED' },
    '../lib/config/insw-worker-config': { resolveWorkerAllowedCompanies: () => [1370] },
    '../lib/insw-worker/test-endpoint': { resolveWorkerTestEndpoint: () => null },
    '../lib/insw-worker/recovery-readiness': { recordWorkerRecoveryReadiness: (event: string, data: any) => {
      expect(event).toBe('ready'); observed.push(data.token);
    } },
    '@prisma/client': { PrismaClient: class { async $disconnect() {} } },
    '../lib/insw-worker/production-dispatcher': { runProductionDispatcher: async (input: any) => {
      input.onEvent('owned', { token: 'private-owner-token' }); input.onReady('private-owner-token');
    } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('scripts/insw-worker.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, module: { exports }, AbortController, process: { once() {}, removeListener() {},
    stdout: { write: (text: string) => output.push(text) }, stderr: { write: (text: string) => output.push(text) } },
    require: (name: string) => { if (!(name in imports)) throw new Error(`UNMOCKED_IMPORT:${name}`); return imports[name]; } });
  expect(await exports.main({ DATABASE_URL: 'fixture', NEXT_PUBLIC_ENVIRONMENT_PHASE: 'development' })).toBe(0);
  expect(observed).toEqual(['private-owner-token']); expect(output.join('')).not.toContain('private-owner-token');
  expect(output.join('')).toContain('owned');
});


for (const gate of [{ coherent: false }, { coherent: true, busy_attempt_id: 'active-linked-attempt' }]) {
  test(`retained owner refuses unsafe gate before reap proof: ${JSON.stringify(gate)}`, async () => {
    const h = concreteHost({ sameBoot: true, gate });
    expect(await h.run()).toBe('refused');
    expect(h.diagnostics).toEqual(['INSW_FIXED_RECOVERY_GATE_UNSAFE\n']);
    expect(h.calls).toEqual(['jlist']);
  });
}
test('observed same-boot stopped owner with historical POSSIBLY_STARTED/HELD reaches recovery and fixed restart after attestation', async () => {
  const h = concreteHost({ sameBoot: true });
  const challenge = await h.run();
  expect(challenge.result).toBe('confirmation-required');
  expect(h.calls).toContain('verifyReaped'); expect(h.calls).not.toContain('recover'); expect(h.calls).not.toContain('restart');
  expect(challenge.confirmation).toMatch(/^\d{13}\.[a-f0-9]{64}$/);
  expect(challenge.confirmation).not.toMatch(/old|fixture|pid|boot/);
  expect(await h.run(h.acknowledge(challenge.confirmation))).toBe('running');
  expect(h.calls.filter(x => x === 'recover')).toHaveLength(1);
  expect(h.calls.filter(x => x === 'restart')).toHaveLength(1);
  expect(await h.run(h.acknowledge(challenge.confirmation))).toBe('already-running');
  expect(h.calls.filter(x => x === 'recover')).toHaveLength(1);
  expect(h.calls.filter(x => x === 'restart')).toHaveLength(1);
  expect(h.queries.every(sql => !/insw_queue_cycle|insw_queue_attempt/.test(sql))).toBe(true);
  expect(h.historical).toEqual({ status: 'HELD', delivery_state: 'POSSIBLY_STARTED' });
});
for (const mode of ['changed-owner', 'changed-admin', 'tampered', 'expired', 'missing-ack', 'empty-evidence']) {
  test(`manual acknowledgement fails closed: ${mode}`, async () => {
    const h = concreteHost({ sameBoot: true });
    const challenge = await h.run(); const ack = h.acknowledge(challenge.confirmation);
    if (mode === 'changed-owner') h.changeOwner();
    if (mode === 'tampered') ack.confirmation = ack.confirmation.slice(0, -1) + (ack.confirmation.endsWith('a') ? 'b' : 'a');
    if (mode === 'expired') ack.confirmation = '1000000000000.' + 'a'.repeat(64);
    if (mode === 'missing-ack') (ack as any).shutdownAcknowledged = false;
    if (mode === 'empty-evidence') ack.evidence = '';
    await expect(h.run(ack, mode === 'changed-admin' ? 'other-admin' : 'admin')).rejects.toThrow('SHUTDOWN_ACKNOWLEDGEMENT_REQUIRED');
    expect(h.calls).not.toContain('recover'); expect(h.calls).not.toContain('restart');
  });
}

// Exercise the actual manual repository path with DB/OS dependencies replaced.
// An unrelated historical HELD row is deliberately outside the gate's attempt.
function manualRecoveryFixture(inconsistentTiming = false) {
  const exports: any = {}, calls: string[] = [];
  const historical = { status: 'HELD', delivery_state: 'POSSIBLY_STARTED', owner_token: null };
  const tx = {
    $queryRaw: async (parts: TemplateStringsArray) => {
      const sql = parts.join('?'); calls.push('read');
      if (sql.includes('FOR UPDATE')) return [{ last_started_at: new Date(0),
        prior_interval_ms: inconsistentTiming ? null : 3600, busy_attempt_id: null }];
      if (sql.includes('SELECT process_identity')) return [{ process_identity: identity }];
      throw new Error('UNEXPECTED_QUERY');
    },
    $executeRaw: async () => { calls.push('clear'); return 1; },
    insw_worker_recovery: { create: async ({ data }: any) => {
      expect(data.old_owner_token).toBe('old'); calls.push('audit');
    } },
    insw_queue_cycle: { update: () => { throw new Error('UNRELATED_HELD_MUTATION'); } },
    insw_queue_attempt: { findUnique: () => { throw new Error('NO_LINKED_ATTEMPT'); } },
  };
  const imports: Record<string, unknown> = {
    'node:crypto': {}, '../config/insw-worker-config': {}, '@prisma/client': {},
    '../insw-queue/contracts': { boundedText: (text: string) => expect(text.length).toBeGreaterThan(0) },
    '../insw-queue/policy.repository': {}, '../insw-queue/queue.repository': {}, './retry': {}, './clone-fence': {},
    './process-identity': { verifyReaped: () => { calls.push('verified-fixture-reap'); } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('lib/insw-worker/operational.repository.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, require: (name: string) => {
    if (!(name in imports)) throw new Error(`UNMOCKED_IMPORT:${name}`); return imports[name];
  } });
  return { historical, calls, run: (shutdownAcknowledged = true) => exports.recoverOperationalOwnership({
    $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx),
  }, { expectedToken: 'old', operator: 'fixture-operator', evidence: 'Injected test-only reap proof', shutdownAcknowledged }) };
}
test('manual repository recovery does not globally veto unrelated historical HELD delivery uncertainty', async () => {
  const h = manualRecoveryFixture(); expect(await h.run()).toEqual({ held: 0 });
  expect(h.calls).toEqual(['read', 'read', 'verified-fixture-reap', 'audit', 'clear']);
  expect(h.historical).toEqual({ status: 'HELD', delivery_state: 'POSSIBLY_STARTED', owner_token: null });
});
test('manual repository also refuses inconsistent timing without clearing ownership', async () => {
  const h = manualRecoveryFixture(true); await expect(h.run()).rejects.toThrow('CORRUPT_ADMISSION_EVIDENCE');
  expect(h.calls).toEqual(['read']);
});
test('manual repository requires shutdown acknowledgement even with no linked attempt', async () => {
  const h = manualRecoveryFixture(); await expect(h.run(false)).rejects.toThrow('SHUTDOWN_ACKNOWLEDGEMENT_REQUIRED');
  expect(h.calls).toEqual([]);
});
