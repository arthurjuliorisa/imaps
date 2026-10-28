import { expect, test } from '@playwright/test';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { encode, getToken } from 'next-auth/jwt';
import { getServerSession, type NextAuthOptions } from 'next-auth';
import type { NextApiRequest, NextApiResponse } from 'next';
import { createRequire } from 'node:module';
import { Agent, setGlobalDispatcher, getGlobalDispatcher } from 'undici';
import * as ts from 'typescript';
import * as nextServer from 'next/server';
import * as requestOrigin from '../lib/security/request-origin';
import * as diagnostics from '../lib/security/menu-fetch-diagnostics';
import * as transport from '../lib/security/menu-fetch-transport';

const source = ts.transpileModule(readFileSync('proxy.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const marker = '[Auth Debug] menu-fetch';

type Scenario = {
  debug: string;
  role?: string | null;
  path?: string;
  fetch: typeof globalThis.fetch;
  headers?: Record<string, string>;
  scheme?: string;
  port?: string;
  expireTimer?: boolean;
  jwtSecret?: string;
};

// Execute the actual Proxy with synthetic auth/fetch/timers. No server or cookies needed.
async function runScenario(scenario: Scenario) {
  const logs: unknown[][] = [];
  const calls: Parameters<typeof fetch>[] = [];
  const timers: number[] = [];
  const cleared: unknown[] = [];
  let tokenCalls = 0;
  const exports: { default?: (request: nextServer.NextRequest) => Promise<Response> } = {};
  const dependencies: Record<string, unknown> = {
    'next/server': nextServer,
    'next-auth/jwt': { getToken: async (options: Parameters<typeof getToken>[0]) => {
      tokenCalls++;
      if (scenario.jwtSecret) return getToken({ ...options, secret: scenario.jwtSecret });
      return scenario.role === null ? null : { role: scenario.role || 'CUSTOMS', email: 'synthetic@example.test' };
    } },
    './lib/security/request-origin': requestOrigin,
    './lib/security/menu-fetch-diagnostics': diagnostics,
    './lib/security/menu-fetch-transport': {
      ...transport,
      getMenuFetchTarget: () => transport.getMenuFetchTarget(scenario.port),
      fetchInternalMenus: async (...args: Parameters<typeof fetch>) => { calls.push(args); return scenario.fetch(...args); },
    },
  };
  new Function('require', 'exports', 'process', 'console', 'fetch', 'setTimeout', 'clearTimeout', source)(
    (id: string) => {
      if (!(id in dependencies)) throw new Error('Unexpected dependency');
      return dependencies[id];
    },
    exports,
    { env: { AUTH_DEBUG: scenario.debug } },
    { log: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) },
    async (...args: Parameters<typeof fetch>) => { calls.push(args); return scenario.fetch(...args); },
    (callback: () => void, delay: number) => {
      timers.push(delay);
      if (delay === 500) callback();
      if (delay === 5000 && scenario.expireTimer) queueMicrotask(callback);
      return timers.length;
    },
    (id: unknown) => cleared.push(id),
  );
  const response = await exports.default!(new nextServer.NextRequest(
    `${scenario.scheme || 'https'}://localhost:3000${scenario.path || '/customs/raw-material'}?private=synthetic-query`,
    { headers: { host: 'localhost', cookie: 'synthetic-cookie=private', 'x-forwarded-proto': scenario.scheme || 'https', ...scenario.headers } },
  ));
  return { response, calls, timers, cleared, tokenCalls, logs,
    events: logs.filter(args => args[0] === marker).map(args => args[1]) };
}

function thrown(error: unknown): typeof fetch {
  return async () => { throw error; };
}
function menus(paths: Array<string | null>): typeof fetch {
  return async () => Response.json(paths.map(menuPath => ({ menuPath, canView: true })));
}

for (const debug of ['false', 'true']) {
  test(`terminal transport error preserves denial and retries (debug=${debug})`, async () => {
    const error = new TypeError('private https://user:password@unexpected.test/?secret=value', {
      cause: new AggregateError([
        Object.assign(new Error('private child'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('private TLS'), { cause: { code: 'ERR_SSL_WRONG_VERSION_NUMBER' } }),
        { code: 'SECRET_CODE' },
      ]),
    });
    const result = await runScenario({ debug, fetch: thrown(error) });
    expect(new URL(result.response.headers.get('location')!).pathname).toBe('/access-denied');
    expect(result.calls).toHaveLength(3);
    expect(result.timers).toEqual([5000, 500, 5000, 500, 5000]);
    // Every failed attempt releases its timeout.
    expect(result.cleared).toHaveLength(3);
    for (const [target, options] of result.calls) {
      expect(String(target)).toBe('http://127.0.0.1:3000/api/settings/access-menu/current-user-menus');
      expect(options?.headers).toEqual({ cookie: 'synthetic-cookie=private', 'x-forwarded-host': 'localhost', 'x-forwarded-proto': 'https' });
      expect(options).toMatchObject({ redirect: 'error', dispatcher: transport.directDispatcher });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(result.events).toHaveLength(debug === 'true' ? 1 : 0);
    if (debug === 'false') expect(result.logs.some(args => String(args[0]).startsWith('[Auth Debug]'))).toBe(false);
    else {
      expect(result.events[0]).toEqual({
        route: 'customs', attempt: 3, elapsedMs: expect.any(Number),
        protocol: 'http', hostClass: 'loopback', port: '3000',
        outcome: 'transport_error', status: null, exception: 'TypeError',
        codes: ['ECONNREFUSED', 'ERR_SSL_WRONG_VERSION_NUMBER'], category: 'protocol',
      });
      expect(JSON.stringify(result.events)).not.toMatch(/private|password|unexpected|SECRET_CODE|synthetic|\/customs/);
    }
  });

  for (const status of [401, 403, 500]) {
    test(`terminal HTTP ${status} preserves denial and retries (debug=${debug})`, async () => {
      const result = await runScenario({ debug, fetch: async () => new Response(null, { status }) });
      expect(new URL(result.response.headers.get('location')!).pathname).toBe('/access-denied');
      expect(result.calls).toHaveLength(3);
      expect(result.timers).toEqual([5000, 500, 5000, 500, 5000]);
      expect(result.cleared).toHaveLength(3);
      expect(result.events).toHaveLength(debug === 'true' ? 1 : 0);
      if (debug === 'true') expect(result.events[0]).toMatchObject({ outcome: 'http_error', status, codes: [], exception: null, category: 'http' });
    });
  }

  test(`authorization matrix stays unchanged (debug=${debug})`, async () => {
    for (const scenario of [
      { role: 'ADMIN', paths: [], path: '/customs/raw-material', allowed: true, count: 0 },
      { role: null, paths: [], path: '/customs/raw-material', allowed: false, count: 0 },
      { role: 'CUSTOMS', paths: ['/customs/raw-material'], path: '/customs/raw-material', allowed: true, count: 1 },
      { role: 'CUSTOMS', paths: ['/customs/raw-material'], path: '/customs/raw-material/123', allowed: true, count: 1 },
      { role: 'CUSTOMS', paths: ['/customs/raw-material'], path: '/customs/outgoing', allowed: false, count: 1 },
      { role: 'USER', paths: [], path: '/customs/raw-material', allowed: false, count: 1 },
      { role: 'USER', paths: [null], path: '/customs/raw-material', allowed: false, count: 1 },
      { role: null, paths: [], path: '/login', allowed: true, count: 0 },
    ]) {
      const result = await runScenario({ debug, role: scenario.role, path: scenario.path, fetch: menus(scenario.paths) });
      expect(result.calls).toHaveLength(scenario.count);
      expect(result.events).toHaveLength(0);
      if (scenario.allowed) expect(result.response.headers.get('x-middleware-next')).toBe('1');
      else expect(new URL(result.response.headers.get('location')!).pathname).toBe(scenario.role === null ? '/login' : '/access-denied');
      expect(result.tokenCalls).toBe(scenario.path === '/login' ? 0 : 1);
    }
  });
}

test('response processing errors retain evidence of an HTTP response', async () => {
  const result = await runScenario({ debug: 'true', fetch: async () => new Response('invalid-json') });
  expect(result.calls).toHaveLength(3);
  expect(result.cleared).toHaveLength(3);
  expect(result.events).toEqual([expect.objectContaining({ outcome: 'response_error', status: 200, exception: 'SyntaxError' })]);
  expect(new URL(result.response.headers.get('location')!).pathname).toBe('/access-denied');
});

test('transient failures that recover emit no terminal event', async () => {
  let count = 0;
  const result = await runScenario({ debug: 'true', fetch: async () => {
    if (++count === 1) throw new Error('transient');
    if (count === 2) return new Response(null, { status: 500 });
    return Response.json([{ menuPath: '/customs/raw-material', canView: true }]);
  } });
  expect(result.calls).toHaveLength(3);
  expect(result.events).toHaveLength(0);
  expect(result.response.headers.get('x-middleware-next')).toBe('1');
});

test('destination classification masks userinfo, arbitrary hosts and queries', () => {
  for (const [url, hostClass, protocol, port] of [
    ['https://user:secret@arbitrary.example.test:3000/private?q=secret', 'public', 'https', '3000'],
    ['http://127.0.0.2', 'loopback', 'http', '80'],
    ['https://[::1]', 'loopback', 'https', '443'],
    ['http://10.2.3.4:3000', 'internal', 'http', '3000'],
    ['http://172.16.1.2', 'internal', 'http', '80'],
    ['http://192.168.1.2', 'internal', 'http', '80'],
    ['http://[fd00::1]', 'internal', 'http', '80'],
    ['http://service.internal', 'internal', 'http', '80'],
    ['http://service', 'internal', 'http', '80'],
    ['file:///private', 'other', 'unknown', 'unknown'],
  ]) {
    const event = diagnostics.formatMenuFetchDiagnostic({ pathname: '/customs/private-id', target: new URL(url), attempt: 3, elapsedMs: 12, outcome: 'transport_error' });
    expect(event).toMatchObject({ hostClass, protocol, port });
    expect(JSON.stringify(event)).not.toMatch(/secret|arbitrary|private|service/);
  }
  expect(diagnostics.formatMenuFetchDiagnostic({ pathname: '', attempt: 3, elapsedMs: 0, outcome: 'transport_error' }))
    .toMatchObject({ route: 'other', protocol: 'unknown', port: 'unknown', hostClass: 'other' });
});

test('error normalization is bounded, cycle-safe and excludes arbitrary properties', () => {
  const error: { name: string; cause?: unknown; errors: unknown[] } = {
    name: 'secret-custom-error',
    errors: Array.from({ length: 1000 }, () => ({ code: 'ECONNRESET', message: 'private' })),
  };
  error.cause = error;
  error.errors.unshift({ code: 'token-secret' }, { code: 'X'.repeat(10000) }, { code: 'CERT_HAS_EXPIRED' });
  const event = diagnostics.formatMenuFetchDiagnostic({ pathname: '/settings/users', attempt: 3, elapsedMs: 1, outcome: 'transport_error', error });
  expect(event).toMatchObject({ exception: 'unknown', category: 'tls', codes: ['CERT_HAS_EXPIRED', 'ECONNRESET'] });
  expect(JSON.stringify(event).length).toBeLessThan(400);
  const accessor = Object.defineProperty({}, 'cause', { get() { throw new Error('private'); } });
  expect(() => diagnostics.formatMenuFetchDiagnostic({ pathname: '/', attempt: 3, elapsedMs: 0, outcome: 'transport_error', error: accessor })).not.toThrow();
});

for (const scheme of ['https', 'http']) {
  test(`${scheme} public context never selects the transport destination`, async () => {
    const host = `phci-erp.polytree.com.cn:${scheme === 'https' ? '13443' : '13080'}`;
    const result = await runScenario({ debug: 'true', scheme, port: '32123',
      headers: { host, 'x-forwarded-host': host, 'x-forwarded-port': '65534' },
      fetch: menus(['/customs/raw-material']),
    });
    expect(result.response.headers.get('x-middleware-next')).toBe('1');
    expect(result.calls).toHaveLength(1);
    expect(String(result.calls[0][0])).toBe('http://127.0.0.1:32123/api/settings/access-menu/current-user-menus');
    expect(result.calls[0][1]?.headers).toEqual({ cookie: 'synthetic-cookie=private',
      'x-forwarded-host': host, 'x-forwarded-proto': scheme });
  });
}

for (const payload of [{}, null, [null], [{ menuPath: 42, canView: true }],
  [{ menuPath: '/customs/raw-material', canView: false }],
  [{ menuPath: '//evil.test', canView: true }],
  [{ menuPath: '/customs/raw-material?x=1', canView: true }],
  [{ menuPath: '/customs/raw-material', canView: true }, {}]]) {
  test(`invalid menu payload fails closed: ${JSON.stringify(payload)}`, async () => {
    const result = await runScenario({ debug: 'true', fetch: async () => Response.json(payload) });
    expect(result.calls).toHaveLength(3);
    expect(result.cleared).toHaveLength(3);
    expect(new URL(result.response.headers.get('location')!).pathname).toBe('/access-denied');
    expect(result.events[0]).toMatchObject({ outcome: 'response_error', status: 200 });
  });
}

test('invalid listener port and poisoned session headers cannot send cookies', async () => {
  for (const port of ['', '0', '65536', '3000/path', 'https://evil.test', '-1']) {
    expect(() => transport.getMenuFetchTarget(port)).toThrow();
    const result = await runScenario({ debug: 'false', port, fetch: menus(['/customs/raw-material']) });
    expect(result.calls).toHaveLength(0);
    expect(new URL(result.response.headers.get('location')!).pathname).toBe('/access-denied');
  }
  for (const headers of [
    { 'x-forwarded-host': 'user:secret@localhost' },
    { 'x-forwarded-host': 'localhost/path' },
    { 'x-forwarded-host': 'localhost?secret=value' },
    { 'x-forwarded-proto': 'ftp' },
  ] as Array<Record<string, string>>) {
    const result = await runScenario({ debug: 'false', headers, fetch: menus(['/customs/raw-material']) });
    expect(result.calls).toHaveLength(0);
    expect(result.response.headers.get('x-middleware-next')).toBeNull();
  }
});

test('allowlist rejects hostile hosts before auth or fetch', async () => {
  const previous = process.env.ALLOWED_HOSTS;
  process.env.ALLOWED_HOSTS = 'phci-erp.polytree.com.cn,other.example.test';
  try {
    const result = await runScenario({ debug: 'false', headers: { 'x-forwarded-host': 'evil.test' }, fetch: menus(['/customs/raw-material']) });
    expect(result.response.status).toBe(400);
    expect(result.tokenCalls).toBe(0);
    expect(result.calls).toHaveLength(0);
  } finally {
    if (previous === undefined) delete process.env.ALLOWED_HOSTS;
    else process.env.ALLOWED_HOSTS = previous;
  }
});

test('segment-boundary matching denies an unrelated route prefix', async () => {
  const result = await runScenario({ debug: 'false', path: '/customs/raw-material-other', fetch: menus(['/customs/raw-material']) });
  expect(new URL(result.response.headers.get('location')!).pathname).toBe('/access-denied');
});

for (const phase of ['headers', 'body']) {
  test(`timeout covers ${phase} and clears each attempt`, async () => {
    const result = await runScenario({ debug: 'true', expireTimer: true,
      fetch: async (_url, options) => {
        const aborted = () => new DOMException('Aborted', 'AbortError');
        const hang = () => new Promise<never>((_resolve, reject) => {
          if (options!.signal!.aborted) reject(aborted());
          else options!.signal!.addEventListener('abort', () => reject(aborted()), { once: true });
        });
        if (phase === 'headers') return hang();
        return { status: 200, ok: true, json: hang } as unknown as Response;
      },
    });
    expect(result.calls).toHaveLength(3);
    expect(result.cleared).toHaveLength(3);
    expect(result.events[0]).toMatchObject({ outcome: phase === 'body' ? 'response_error' : 'transport_error', exception: 'AbortError' });
    expect(new URL(result.response.headers.get('location')!).pathname).toBe('/access-denied');
  });
}

// Real Next HTTP listener + actual getServerSession(authOptions), JWT encryption,
// cookies()/headers() request context and actual menu API. Only Prisma/activity
// are synthetic; no application database or external service is contacted.
test('real Next listener preserves HTTPS/HTTP sessions, chunking, grants and direct transport', async () => {
  test.setTimeout(120_000);
  const root = mkdtempSync(join(tmpdir(), 'imaps-menu-session-'));
  const secret = 'local-test-only-menu-session-secret-0123456789';
  const servers: Server[] = [];
  const listen = async (server: Server) => {
    servers.push(server);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return (server.address() as { port: number }).port;
  };
  let child: ReturnType<typeof spawn> | undefined;
  const globalDispatcher = getGlobalDispatcher();
  const hostileDispatcher = new Agent({ connect: (_options, callback) => callback(new Error('Global dispatcher must not be used'), null) });
  const environment = Object.fromEntries(['PORT', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'NODE_USE_ENV_PROXY'].map(key => [key, process.env[key]]));
  try {
    const reservation = createServer();
    const port = await listen(reservation);
    await new Promise<void>(resolve => reservation.close(() => resolve()));
    let leaked = 0;
    const hostilePort = await listen(createServer((_req, res) => { leaked++; res.end('untrusted'); }));
    const compile = (path: string) => ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
    writeFileSync(join(root, 'next.config.js'), 'module.exports = { devIndicators: false };');
    writeFileSync(join(root, 'request-origin.cjs'), compile('lib/security/request-origin.ts'));
    writeFileSync(join(root, 'auth.cjs'), compile('lib/auth.ts')
      .replace('require("./prisma")', 'require("./fake-prisma.cjs")')
      .replace('require("./log-activity")', '({ logActivity: async () => {} })')
      .replace('require("./security/request-origin")', 'require("./request-origin.cjs")'));
    writeFileSync(join(root, 'menu-route.cjs'), compile('app/api/settings/access-menu/current-user-menus/route.ts')
      .replace('require("@/lib/prisma")', 'require("./fake-prisma.cjs")')
      .replace('require("@/lib/auth")', 'require("./auth.cjs")'));
    writeFileSync(join(root, 'fake-prisma.cjs'), `
      const assert = require('node:assert/strict');
      exports.prisma = { menus: { findMany: async (query) => {
        assert.deepEqual(query.where, { is_active: true });
        assert.deepEqual(query.orderBy, { menu_order: 'asc' });
        const grant = query.include.user_access_menus.where;
        assert.equal(grant.can_view, true);
        assert.ok(['entitled', 'unentitled'].includes(grant.user_id));
        return [
          ['root', null, null], ['incoming', '/customs/incoming', 'root'],
          ['orphan', '/customs/outgoing', 'missing'],
          ['grandchild', '/customs/wip', 'orphan'],
        ].map(([id, menu_path, parent_id]) => ({ id, menu_path, parent_id,
          menu_name: id, menu_icon: null, menu_order: 1,
          user_access_menus: grant.user_id === 'entitled'
            ? [{ can_view: true, can_create: false, can_edit: false, can_delete: false }] : [],
        }));
      } } };
    `);
    const apiDir = join(root, 'app/api/settings/access-menu/current-user-menus');
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, 'route.js'), `import { GET as menuGET } from '../../../../../menu-route.cjs'; export const dynamic = 'force-dynamic'; export const GET = menuGET;`);
    writeFileSync(join(root, 'app/layout.js'), 'export default function Layout({children}) { return <html><body>{children}</body></html> }');
    child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'dev', '--webpack', '-p', String(port)], {
      cwd: root, env: { ...process.env, NEXTAUTH_SECRET: secret, NEXTAUTH_URL: `http://localhost:${port}`,
        AUTH_TRUST_HOST: 'true', ALLOWED_HOSTS: 'phci-erp.polytree.com.cn,other.example.test',
        NEXT_TELEMETRY_DISABLED: '1', NODE_ENV: 'development' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout!.on('data', chunk => { output = (output + chunk).slice(-12000); });
    child.stderr!.on('data', chunk => { output = (output + chunk).slice(-12000); });
    process.env.PORT = String(port);
    const target = transport.getMenuFetchTarget();
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (child.exitCode !== null) throw new Error(`Local Next exited: ${output}`);
      try {
        const response = await transport.fetchInternalMenus(target, { dispatcher: transport.directDispatcher, signal: AbortSignal.timeout(1000) });
        await response.text();
        if (response.status === 401) { ready = true; break; }
        if (response.status === 500) throw new Error('Local fixture route failed');
      } catch { /* listener/compilation not ready */ }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    expect(ready, output).toBe(true);
    process.env.HTTP_PROXY = process.env.HTTPS_PROXY = `http://127.0.0.1:${hostilePort}`;
    process.env.NO_PROXY = '';
    process.env.NODE_USE_ENV_PROXY = '1';
    setGlobalDispatcher(hostileDispatcher);

    const requests = [];
    for (const scheme of ['https', 'http']) {
      for (const chunked of [false, true]) {
        for (const id of ['entitled', 'unentitled']) {
          const jwt = await encode({ secret, token: { id, role: 'CUSTOMS', email: 'local@example.test' } });
          const name = `${scheme === 'https' ? '__Secure-' : ''}next-auth.session-token`;
          const midpoint = Math.floor(jwt.length / 2);
          const cookie = chunked ? `${name}.0=${jwt.slice(0, midpoint)}; ${name}.1=${jwt.slice(midpoint)}` : `${name}=${jwt}`;
          const host = scheme === 'https' ? 'phci-erp.polytree.com.cn:13443' : 'other.example.test:13080';
          const request = new nextServer.NextRequest(`${scheme}://localhost:3000/customs/incoming`, {
            headers: { host, 'x-forwarded-host': host, 'x-forwarded-proto': scheme, cookie },
          });
          // Real Proxy token decoder also accepts the exact forwarded cookie.
          expect((await getToken({ req: request, secret, secureCookie: scheme === 'https' }))?.id).toBe(id);
          requests.push((async () => {
            const response = await transport.fetchInternalMenus(target, { headers: transport.getMenuSessionHeaders(request),
              dispatcher: transport.directDispatcher, redirect: 'error', signal: AbortSignal.timeout(5000) });
            expect(response.status).toBe(200);
            const body = await response.json() as Array<{ id: string; menuPath: string | null }>;
            // Immediate-parent semantics remain exact: orphan excluded, grandchild
            // retained because its immediate parent was in the granted ID set.
            expect(body.map(menu => menu.id)).toEqual(id === 'entitled' ? ['root', 'incoming', 'grandchild'] : []);
            for (const path of ['/customs/incoming', '/customs/incoming/123', '/customs/outgoing']) {
              const result = await runScenario({ debug: 'false', scheme, port: String(port), path, jwtSecret: secret,
                headers: Object.fromEntries(request.headers),
                fetch: async (input, init) => await transport.fetchInternalMenus(String(input),
                  init as Parameters<typeof transport.fetchInternalMenus>[1]) as unknown as Response,
              });
              expect(result.calls).toHaveLength(1);
              if (id === 'entitled' && path !== '/customs/outgoing') expect(result.response.headers.get('x-middleware-next')).toBe('1');
              else expect(new URL(result.response.headers.get('location')!).pathname).toBe('/access-denied');
            }
          })());
        }
      }
    }
    await Promise.all(requests);
    const redirectPort = await listen(createServer((_req, res) => { res.writeHead(302, { location: `http://127.0.0.1:${hostilePort}/steal` }); res.end(); }));
    await expect(transport.fetchInternalMenus(`http://127.0.0.1:${redirectPort}`, { dispatcher: transport.directDispatcher,
      redirect: 'error', headers: { cookie: 'synthetic-private-cookie' } })).rejects.toThrow();
    expect(leaked).toBe(0);
  } finally {
    setGlobalDispatcher(globalDispatcher);
    await hostileDispatcher.close();
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 5000))]);
      if (child.exitCode === null) child.kill('SIGKILL');
    }
    await Promise.all(servers.filter(server => server.listening).map(server => new Promise<void>(resolve => {
      server.closeAllConnections(); server.close(() => resolve());
    })));
    rmSync(root, { recursive: true, force: true });
  }
});

test('without host trust getServerSession selects cookies from NEXTAUTH_URL', async () => {
  const secret = 'local-test-only-menu-session-secret-0123456789';
  const requireModule = createRequire(resolve('package.json'));
  const auth: { authOptions?: NextAuthOptions } = {};
  const authSource = ts.transpileModule(readFileSync('lib/auth.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function('require', 'exports', 'process', authSource)(
    (id: string) => {
      if (id === './prisma') return { prisma: {} };
      if (id === './log-activity') return { logActivity: async () => {} };
      if (id === './security/request-origin') return requestOrigin;
      return requireModule(id);
    }, auth, { env: { NEXTAUTH_SECRET: secret } },
  );
  const previous = Object.fromEntries(['AUTH_TRUST_HOST', 'VERCEL', 'NEXTAUTH_URL'].map(key => [key, process.env[key]]));
  delete process.env.AUTH_TRUST_HOST;
  delete process.env.VERCEL;
  try {
    for (const scheme of ['https', 'http']) {
      process.env.NEXTAUTH_URL = `${scheme}://configured.example.test`;
      const jwt = await encode({ secret, token: { id: 'entitled', role: 'CUSTOMS' } });
      const cookieName = `${scheme === 'https' ? '__Secure-' : ''}next-auth.session-token`;
      const request = { headers: { 'x-forwarded-host': 'other.example.test', 'x-forwarded-proto': scheme === 'https' ? 'http' : 'https' },
        cookies: { [cookieName]: jwt } } as unknown as NextApiRequest;
      const response = { getHeader: () => [], setHeader: () => {} } as unknown as NextApiResponse;
      const session = await getServerSession(request, response, auth.authOptions!);
      expect(session?.user.id).toBe('entitled');
      const mismatched = { ...request, cookies: { [scheme === 'https' ? 'next-auth.session-token' : '__Secure-next-auth.session-token']: jwt } } as unknown as NextApiRequest;
      expect(await getServerSession(mismatched, response, auth.authOptions!)).toBeNull();
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
