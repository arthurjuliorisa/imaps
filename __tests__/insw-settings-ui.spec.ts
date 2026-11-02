import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the actual component closures using the same hook harness convention
// as the existing access-menu tests. No fabricated browser session is required.
function editor(fetcher: (url: string, init?: RequestInit) => Promise<unknown>) {
  let cursor = 0;
  const slots: any[] = [];
  const hooks = {
    useState: (initial: unknown) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = initial;
      return [slots[i], (next: any) => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useEffect: () => {}, useCallback: (fn: unknown) => fn,
  };
  const messages: string[] = [];
  const imports: Record<string, unknown> = {
    react: hooks, '@mui/material': {}, '@/app/components/ConfirmDialog': {},
    '@/app/components/ToastProvider': { useToast: () => ({ success: (s: string) => messages.push(s), error: (s: string) => messages.push(s) }) },
    'react/jsx-runtime': {},
  };
  const source = readFileSync('app/(authenticated)/insw/queue-settings/QueueSettings.tsx', 'utf8').replace('  return (\n    <Box',
    '  return { load, save, setInterval, setReason, policy, interval, reason, loading, saving, error, canSave } as any;\n  return (\n    <Box');
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; }, fetch: fetcher });
  return { render: () => { cursor = 0; return exports.default(); }, messages };
}
const policy = { intervalMs: 3600, version: 3, updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'admin', reason: 'Initial' };
const response = (status: number, data: unknown) => ({ status, ok: status < 400, json: async () => data });

test('UI submits only reviewed interval/version/reason and uses authoritative success state', async () => {
  let saved: unknown;
  const view = editor(async (_url, init) => {
    if (!init?.method) return response(200, { data: policy });
    saved = JSON.parse(String(init.body));
    return response(200, { data: { ...policy, intervalMs: 5000, version: 4 } });
  });
  await view.render().load();
  let page = view.render(); page.setInterval('5000'); page.setReason(' Planned cadence ');
  page = view.render(); expect(page.canSave).toBe(true); await page.save();
  expect(saved).toEqual({ intervalMs: 5000, expectedVersion: 3, reason: 'Planned cadence' });
  page = view.render(); expect(page.policy.version).toBe(4); expect(page.interval).toBe('5000'); expect(page.reason).toBe(''); expect(page.canSave).toBe(false);
});

test('409 reloads authoritative state, clears draft and requires a fresh review without resubmission', async () => {
  let reads = 0; let writes = 0;
  const view = editor(async (_url, init) => {
    if (init?.method) { writes++; return response(409, { error: 'stale' }); }
    reads++; return response(200, { data: reads === 1 ? policy : { ...policy, intervalMs: 8000, version: 4 } });
  });
  await view.render().load(); let page = view.render(); page.setInterval('5000'); page.setReason('Draft');
  await view.render().save(); page = view.render();
  expect(page.policy.version).toBe(4); expect(page.interval).toBe('8000'); expect(page.reason).toBe('');
  expect(page.error).toContain('Another administrator'); expect(page.canSave).toBe(false); expect(writes).toBe(1); expect(reads).toBe(2);
});

test('validation failure keeps draft and version; failed reload disables further writes', async () => {
  let reads = 0;
  const view = editor(async (_url, init) => {
    if (init?.method) return response(400, { error: 'Invalid processing interval' });
    reads++; return reads === 1 ? response(200, { data: policy }) : response(500, { error: 'Unavailable' });
  });
  await view.render().load(); let page = view.render();
  page.setInterval('3599'); page.setReason('Draft'); expect(view.render().canSave).toBe(false);
  page.setInterval('5000'); await view.render().save(); page = view.render();
  expect(page.policy.version).toBe(3); expect(page.interval).toBe('5000'); expect(page.reason).toBe('Draft'); expect(page.error).toBe('Invalid processing interval');
  await page.load(); page = view.render(); expect(page.policy).toBeNull(); expect(page.canSave).toBe(false); expect(page.loading).toBe(false);
});
