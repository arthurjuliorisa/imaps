import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function monitor() {
  let cursor = 0;
  const slots: any[] = [];
  let effect: () => () => void;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let timerId = 0;
  let listener: () => void;
  const document = { visibilityState: 'visible', addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: () => {} };
  const pending: { resolve: (value: any) => void; signal: AbortSignal }[] = [];
  const imports: Record<string, unknown> = {
    react: {
      useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (value: any) => { slots[i] = value; }]; },
      useRef: (value: any) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
      useEffect: (fn: () => () => void) => { effect = fn; },
    }, '@mui/material': {}, 'react/jsx-runtime': {},
  };
  const source = readFileSync('app/(authenticated)/insw/queue-settings/QueueMonitoring.tsx', 'utf8')
    .replace('  return <Stack', '  return { observation, loading, error, reload } as any;\n  return <Stack');
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; },
    AbortController, document,
    fetch: (_: string, init: RequestInit) => new Promise(resolve => pending.push({ resolve, signal: init.signal as AbortSignal })),
    setTimeout: (fn: () => void, ms: number) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const render = () => { cursor = 0; return exports.default(); };
  render(); const cleanup = effect!();
  return { render, pending, timers, document, visibility: () => listener!(), cleanup };
}
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('visible polling prevents overlapping reads, retains stale evidence after failure and aborts on unmount', async () => {
  const view = monitor();
  expect(view.pending).toHaveLength(1);
  view.render().reload.current(); expect(view.pending).toHaveLength(1);
  const observation = { observedAt: '2026-11-14T00:00:00Z', companyCode: 1370 };
  view.pending[0].resolve({ ok: true, json: async () => ({ data: observation }) }); await settle();
  expect(view.render().observation).toEqual(observation); expect(view.render().loading).toBe(false);
  expect([...view.timers.values()].map(t => t.ms)).toEqual([30000]);
  view.document.visibilityState = 'hidden'; view.visibility();
  expect(view.timers.size).toBe(0); view.render().reload.current(); expect(view.pending).toHaveLength(1);
  view.document.visibilityState = 'visible'; view.visibility(); expect(view.pending).toHaveLength(2);
  view.pending[1].resolve({ ok: false, json: async () => ({ error: 'Unavailable' }) }); await settle();
  expect(view.render().observation).toEqual(observation); expect(view.render().error).toContain('stale');
  view.render().reload.current(); expect(view.pending).toHaveLength(3);
  view.cleanup(); expect(view.pending[2].signal.aborted).toBe(true); expect(view.timers.size).toBe(0);
  view.pending[2].resolve({ ok: true, json: async () => ({ data: { companyCode: 1380 } }) }); await settle();
  expect(view.render().observation).toEqual(observation);
});
