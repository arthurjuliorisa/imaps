import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { intervalSettingsAccess } from '../lib/insw-queue/interval-settings-http';
import { workerRecoveryAllowed } from '../lib/insw-queue/worker-recovery';

function moduleAt(path: string, imports: Record<string, unknown>, globals: Record<string, unknown> = {}) {
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports, process: { env: {} }, ...globals,
    require: (name: string) => { if (!(name in imports)) throw new Error(`UNMOCKED:${name}`); return imports[name]; } });
  return exports;
}
const config = { uid: 1000, root: '/app', home: '/home', pm2Home: '/pm2', pm2: '/trusted/bin/pm2', node: '/node' };
function host(mode: string) {
  const commands: any[] = [], logs: string[][] = [];
  const env = { pm_cwd: '/app', pm_exec_path: '/app/scripts/insw-worker.ts', status: mode };
  const app = { name: 'imaps-insw-worker', pm2_env: env, pid: 123, privateToken: 'secret' };
  const imports = {
    './recovery-installation': { recoveryInstallation: (options: unknown) => { expect(options).toEqual({ readOnly: true }); if (mode === 'installation') throw new Error('private /secret/path token'); return config; } },
    'node:path': { join: (...args: string[]) => args.join('/') },
    'node:fs': {
      readFileSync: (path: string) => { if (mode === 'unavailable') throw new Error('private'); return path.endsWith('pm2.pid') ? mode === 'invalid-pid' ? 'NaN' : '123' : mode === 'foreign-daemon' ? 'node' : 'God Daemon'; },
      statSync: () => ({ uid: mode === 'foreign-account' ? 999 : 1000 }),
      lstatSync: () => { if (mode === 'missing-socket') throw new Error('secret socket path'); return { uid: 1000, isSocket: () => mode !== 'bad-socket' }; },
      readlinkSync: (path: string) => mode === 'namespace' && path.includes('/123/') ? 'pid:[2]' : 'pid:[1]',
    },
    'node:util': { promisify: (fn: unknown) => fn },
    'node:child_process': { execFile: async (...args: any[]) => {
      commands.push(args);
      if (mode.startsWith('rpc-')) throw Object.assign(new Error('secret /private/path'), { stderr:
        mode === 'rpc-forged' ? 'INSW_STATUS_RPC_METHOD\nsecret' : `INSW_STATUS_RPC_${mode.slice(4).toUpperCase().replaceAll('-', '_')}\n` });
      if (mode === 'query-failed' || mode === 'timeout') throw new Error('raw private output');
      return { stdout: mode === 'malformed' ? '{' : JSON.stringify(mode === 'invalid-list' ? {} : mode === 'missing' ? [] : mode === 'duplicate' ? [app, app]
        : mode === 'wrong-target' ? [{ ...app, pm2_env: { ...env, pm_cwd: '/other' } }] : [app]) };
    } },
  };
  return { commands, logs, run: moduleAt('lib/insw-worker/supervisor-status.ts', imports,
    { console: { error: (...args: string[]) => logs.push(args) } }).workerSupervisorStatus };
}
for (const mode of ['online', 'stopped', 'errored', 'launching', 'waiting restart', 'unavailable', 'missing', 'query-failed', 'timeout', 'malformed', 'invalid-list', 'duplicate', 'wrong-target', 'foreign-account', 'foreign-daemon', 'bad-socket', 'installation', 'invalid-pid', 'missing-socket', 'namespace',
  'rpc-module-load', 'rpc-socket-error', 'rpc-method', 'rpc-timeout', 'rpc-connect', 'rpc-serialize', 'rpc-forged']) {
  test(`fixed PM2 read is bounded and sanitized: ${mode}`, async () => {
    const h = host(mode), result = await h.run();
    const unavailable = ['unavailable', 'foreign-account', 'foreign-daemon', 'bad-socket', 'installation', 'invalid-pid', 'missing-socket', 'namespace'].includes(mode);
    expect(result).toEqual(['online', 'stopped', 'errored'].includes(mode) ? { status: mode, reason: 'observed' }
      : mode === 'launching' ? { status: 'starting', reason: 'observed' }
      : { status: 'unknown', reason: unavailable ? 'unavailable' : mode === 'missing' ? 'missing-target' : mode === 'waiting restart' ? 'unrecognized' : 'query-failed' });
    expect(JSON.stringify(result)).not.toMatch(/secret|pid|private|\/app/);
    const diagnostics: Record<string, string> = {
      unavailable: 'DAEMON_PID_READ', 'foreign-account': 'DAEMON_OWNER', 'foreign-daemon': 'DAEMON_COMMAND',
      'bad-socket': 'DAEMON_SOCKET_IDENTITY', installation: 'INSTALLATION', 'invalid-pid': 'DAEMON_PID_INVALID',
      'missing-socket': 'DAEMON_SOCKET_READ', namespace: 'DAEMON_NAMESPACE', missing: 'TARGET_MISSING',
      'query-failed': 'RPC_QUERY', timeout: 'RPC_QUERY', malformed: 'RPC_RESPONSE_PARSE', 'invalid-list': 'RPC_RESPONSE_SHAPE',
      duplicate: 'TARGET_AMBIGUOUS', 'wrong-target': 'TARGET_IDENTITY', 'waiting restart': 'STATE_UNRECOGNIZED', 'rpc-forged': 'RPC_QUERY',
    };
    const code = diagnostics[mode] || (mode.startsWith('rpc-') ? `RPC_${mode.slice(4).toUpperCase().replaceAll('-', '_')}` : undefined);
    expect(h.logs).toEqual(code ? [['[INSW worker status]', code]] : []);
    expect(JSON.stringify(h.logs)).not.toMatch(/secret|private|token|\/app|\/pm2|\/node/);

    expect(h.commands).toHaveLength(unavailable ? 0 : 1);
    if (!unavailable) {
      const [executable, args, options] = h.commands[0];
      expect(executable).toBe('/node'); expect(args[0]).toBe('-e');
      expect(args.slice(2)).toEqual(['/trusted/bin/pm2', '/pm2/rpc.sock']);
      expect(options.timeout).toBe(5000); expect(options.env.NODE_OPTIONS).toBe('');
      // Execute the actual child script with a fake RPC transport. No PM2 API,
      // daemon startup, DB, network or arbitrary RPC method is available here.
      const calls: string[] = [];
      let connected!: () => void;
      const socket = { once: (name: string, fn: () => void) => { if (name === 'connect') connected = fn; },
        connect: (path: string) => { calls.push(path); connected(); } };
      const output: string[] = [];
      vm.runInNewContext(args[1], {
        require: (name: string) => {
          expect(name).toBe('node:module');
          return { createRequire: (path: string) => {
            expect(path).toBe('/trusted/bin/pm2');
            return (dependency: string) => dependency.endsWith('pm2-axon') ? { socket: (type: string) => { expect(type).toBe('req'); return socket; } }
              : { Client: class { call(method: string, input: unknown, callback: (err: null, data: unknown) => void) { calls.push(method); expect(input).toEqual({}); callback(null, []); } } };
          } };
        }, setTimeout: (_fn: unknown, ms: number) => { expect(ms).toBe(4000); },
        process: { argv: ['node', '/trusted/bin/pm2', '/pm2/rpc.sock'], stdout: { write: (text: string, done: () => void) => { output.push(text); done(); } }, exit: (code: number) => { expect(code).toBe(0); } },
      });
      expect(calls).toEqual(['/pm2/rpc.sock', 'getMonitorData']); expect(output).toEqual(['[]']);
    }
  });
}

test('read-only RPC child emits only fixed failure markers, including module and socket failures', async () => {
  const h = host('stopped'); await h.run();
  const script = h.commands[0][1][1];
  for (const code of ['RPC_MODULE_LOAD', 'RPC_CONNECT', 'RPC_SOCKET_ERROR', 'RPC_METHOD', 'RPC_TIMEOUT', 'RPC_SERIALIZE']) {
    const stderr: string[] = [], exits: number[] = [];
    const callbacks: Record<string, () => void> = {};
    let timeout!: () => void;
    const socket = { once: (event: string, fn: () => void) => { callbacks[event] = fn; }, connect: () => {
      if (code === 'RPC_CONNECT') throw new Error('private socket /secret/path');
      if (code === 'RPC_SOCKET_ERROR') callbacks.error();
      else if (code !== 'RPC_TIMEOUT') callbacks.connect();
    } };
    vm.runInNewContext(script, {
      require: () => ({ createRequire: () => (name: string) => {
        if (code === 'RPC_MODULE_LOAD') throw new Error('private module /secret/path');
        if (name.endsWith('pm2-axon')) return { socket: () => socket };
        return { Client: class { call(_method: string, _input: unknown, done: (err: unknown, data?: unknown) => void) {
          if (code === 'RPC_METHOD') done(new Error('private PM2 data token'));
          else { const circular: any = {}; circular.self = circular; done(null, circular); }
        } } };
      } }),
      setTimeout: (fn: () => void, ms: number) => { expect(ms).toBe(4000); timeout = fn; },
      process: { argv: ['node', '/trusted/bin/pm2', '/pm2/rpc.sock'],
        stderr: { write: (text: string, done: () => void) => { stderr.push(text); done(); } },
        stdout: { write: () => { throw new Error('UNEXPECTED_STDOUT'); } }, exit: (value: number) => exits.push(value) },
    });
    if (code === 'RPC_TIMEOUT') timeout();
    expect(stderr).toEqual([`INSW_STATUS_${code}\n`]); expect(exits).toEqual([1]);
    expect(JSON.stringify(stderr)).not.toMatch(/secret|private|token/);
  }
});

test('status API authorizes Admin and deployment phase before its single read', async () => {
  for (const access of [401, 403, 200]) for (const allowed of [false, true]) {
    let reads = 0;
    const api = moduleAt('lib/insw-queue/worker-status-http.ts', {
      './interval-settings-http': { intervalSettingsAccess: () => access }, './worker-recovery': { workerRecoveryAllowed: () => allowed },
      '../insw-worker/supervisor-status': { workerSupervisorStatus: async () => { reads++; return { status: 'unknown', reason: 'missing-target' }; } },
    }, { Response });
    const response = await api.workerStatusRequest(new Request('http://localhost/status'), null);
    expect(response.status).toBe(access !== 200 ? access : !allowed ? 403 : 200);
    expect(reads).toBe(access === 200 && allowed ? 1 : 0);
    expect(response.headers.get('cache-control')).toBe('no-store');
    if (reads) expect(await response.json()).toEqual({ data: { status: 'unknown', reason: 'missing-target' } });
  }
});

test('status route uses real canonical Admin access and phase rules, including production Node on staging', async () => {
  const sessions = [null, { user: { role: 'ADMIN' } }, { user: { id: 'user', role: 'USER' } }, { user: { id: 'user', role: 'SUPER_ADMIN' } }, { user: { id: 'admin', role: 'ADMIN' } }];
  for (const phase of ['staging', 'development', 'production']) for (const session of sessions) {
    let reads = 0;
    const api = moduleAt('lib/insw-queue/worker-status-http.ts', {
      './interval-settings-http': { intervalSettingsAccess },
      './worker-recovery': { workerRecoveryAllowed: () => workerRecoveryAllowed({ NODE_ENV: 'production', NEXT_PUBLIC_ENVIRONMENT_PHASE: phase, DATABASE_PHASE: phase }) },
      '../insw-worker/supervisor-status': { workerSupervisorStatus: async () => { reads++; return { status: 'online', reason: 'observed' }; } },
    }, { Response });
    const response = await api.workerStatusRequest(new Request('http://localhost/status'), session);
    const authorized = session?.user?.id === 'admin' && phase !== 'production';
    expect(response.status).toBe(authorized ? 200 : !session?.user?.id ? 401 : 403);
    expect(reads).toBe(authorized ? 1 : 0);
    if (authorized) {
      const rejected = await api.workerStatusRequest(new Request('http://localhost/status', { method: 'POST' }), session);
      expect(rejected.status).toBe(405); expect(reads).toBe(1);
    }
  }
  const route = readFileSync('app/api/insw/queue-settings/worker-status/route.ts', 'utf8');
  expect(route).toContain('workerStatusRequest(request, await getServerSession(authOptions))');
});
