import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import * as nextServer from 'next/server';
import * as requestOrigin from '../lib/security/request-origin';
import * as diagnostics from '../lib/security/menu-fetch-diagnostics';

const source = ts.transpileModule(readFileSync('proxy.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const marker = '[Auth Debug] menu-fetch';

type Scenario = {
  debug: string;
  role?: string | null;
  path?: string;
  fetch: typeof globalThis.fetch;
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
    'next-auth/jwt': { getToken: async () => {
      tokenCalls++;
      return scenario.role === null ? null : { role: scenario.role || 'CUSTOMS', email: 'synthetic@example.test' };
    } },
    './lib/security/request-origin': requestOrigin,
    './lib/security/menu-fetch-diagnostics': diagnostics,
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
      return timers.length;
    },
    (id: unknown) => cleared.push(id),
  );
  const response = await exports.default!(new nextServer.NextRequest(
    `https://localhost:3000${scenario.path || '/customs/raw-material'}?private=synthetic-query`,
    { headers: { host: 'localhost', cookie: 'synthetic-cookie=private', 'x-forwarded-proto': 'https' } },
  ));
  return { response, calls, timers, cleared, tokenCalls, logs,
    events: logs.filter(args => args[0] === marker).map(args => args[1]) };
}

function thrown(error: unknown): typeof fetch {
  return async () => { throw error; };
}
function menus(paths: Array<string | null>): typeof fetch {
  return async () => Response.json(paths.map(menuPath => ({ menuPath })));
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
    // Existing thrown-fetch timers are deliberately unchanged by instrumentation.
    expect(result.cleared).toHaveLength(0);
    for (const [target, options] of result.calls) {
      expect(String(target)).toBe('https://localhost:3000/api/settings/access-menu/current-user-menus');
      expect(options?.headers).toEqual({ cookie: 'synthetic-cookie=private' });
      expect(options?.signal).toBeInstanceOf(AbortSignal);
    }
    expect(result.events).toHaveLength(debug === 'true' ? 1 : 0);
    if (debug === 'false') expect(result.logs.some(args => String(args[0]).startsWith('[Auth Debug]'))).toBe(false);
    else {
      expect(result.events[0]).toEqual({
        route: 'customs', attempt: 3, elapsedMs: expect.any(Number),
        protocol: 'https', hostClass: 'loopback', port: '3000',
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
    return Response.json([{ menuPath: '/customs/raw-material' }]);
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
