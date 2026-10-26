import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import dayjs from 'dayjs';

/** Execute actual component closures with hook/import doubles. No renderer,
 * session, database or network: this is deliberately not a browser test. */
function component(source: string, fetcher: (url: string, init?: any) => Promise<any>) {
  const state: any[] = [];
  const successes: string[] = [];
  const errors: string[] = [];
  const react = { useState: (initial: any) => {
    const index = state.length; state.push(initial);
    return [initial, (next: any) => { state[index] = next; }];
  }, useRef: (value: any) => ({ current: value }), useEffect: () => {} };
  const imports: Record<string, any> = {
    react, '@mui/material': { useTheme: () => ({ palette: { mode: 'light' } }) },
    '@mui/icons-material': {}, recharts: {}, '@/app/components/DataTable': {},
    '@/app/components/ToastProvider': { useToast: () => ({ success: (s: string) => successes.push(s), error: (s: string) => errors.push(s) }) },
    dayjs, 'react/jsx-runtime': {}, '@/lib/insw-queue/operational-state': {},
  };
  const instrumented = source.replace('  const totalSuccess =', '  return { fetchLogs, handleRefresh, handleResend } as any;\n  const totalSuccess =');
  const js = ts.transpileModule(instrumented, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports: any = {};
  vm.runInNewContext(js, { exports, require: (name: string) => {
    if (!(name in imports)) throw new Error(`Unmocked import ${name}`);
    return imports[name];
  }, fetch: fetcher, URLSearchParams, console: { error: () => {} } });
  return { handlers: exports.default(), state, successes, errors };
}
const source = readFileSync('app/(authenticated)/insw/logs/page.tsx', 'utf8');
function reply(data: any = [], ok = true) { return { ok, json: async () => ({ success: ok, data, pagination: { total: data.length } }) }; }
function deferred() { let resolve!: (value: any) => void; const promise = new Promise<any>(r => { resolve = r; }); return { promise, resolve }; }

test('failed or rejected refresh never reports success; all three requests are bounded', async () => {
  for (const reject of [false, true]) {
    const calls: string[] = [];
    const view = component(source, async url => { calls.push(url); if (reject) throw new Error('fixture rejection'); return reply([], false); });
    await view.handlers.handleRefresh();
    expect(view.successes).toHaveLength(0);
    expect(view.errors).toHaveLength(1);
    expect(calls).toHaveLength(3);
  }
});

test('refresh waits for all successful requests and suppresses duplicate click fanout', async () => {
  const requests = [deferred(), deferred(), deferred()]; let count = 0;
  const view = component(source, async () => requests[count++].promise);
  const pending = view.handlers.handleRefresh();
  await view.handlers.handleRefresh();
  expect(count).toBe(3);
  expect(view.successes).toHaveLength(0);
  for (const request of requests) request.resolve(reply());
  await pending;
  expect(view.successes).toHaveLength(1);
});

test('newest list wins when responses finish in reverse order or older request rejects', async () => {
  for (const olderFails of [false, true]) {
    const older = deferred(); const newer = deferred(); let count = 0;
    const view = component(source, async () => count++ === 0 ? older.promise : newer.promise);
    const oldResult = view.handlers.fetchLogs(); const newResult = view.handlers.fetchLogs();
    newer.resolve(reply([{ id: 'new' }])); await newResult;
    older.resolve(olderFails ? { ok: false, json: async () => { throw new Error('older failure'); } } : reply([{ id: 'old' }]));
    await oldResult;
    expect(view.state[0]).toEqual([{ id: 'new' }]);
    expect(view.state[1]).toBe(false);
  }
});

test('RESEND closure synchronous latch prevents duplicate admission request', async () => {
  const request = deferred(); let posts = 0;
  const view = component(source, async (_url, init) => { if (init?.method === 'POST') { posts++; return request.promise; } return reply(); });
  const pending = view.handlers.handleResend('synthetic');
  await view.handlers.handleResend('synthetic');
  expect(posts).toBe(1);
  request.resolve({ ok: true, json: async () => ({ status: 'accepted', message: 'Accepted to queue; not delivered' }) });
  await pending;
  expect(view.successes).toEqual(['Accepted to queue; not delivered']);
});
