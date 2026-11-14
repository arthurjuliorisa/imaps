import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as mui from '@mui/material';
import type { QueueMonitoring } from '../lib/insw-queue/monitoring';

function monitor() {
  let cursor = 0;
  const slots: any[] = [];
  let effect: () => () => void;
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let timerId = 0;
  let listener: () => void;
  const document = { visibilityState: 'visible', addEventListener: (_: string, fn: () => void) => { listener = fn; }, removeEventListener: () => {} };
  const pending: { resolve: (value: any) => void; signal: AbortSignal; url: string; cache: RequestCache | undefined }[] = [];
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
    fetch: (url: string, init: RequestInit) => new Promise(resolve => pending.push({ resolve, signal: init.signal as AbortSignal, url, cache: init.cache })),
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

// Actual JSX + MUI SSR with synthetic state. This does not connect to an app,
// start a browser, run effects, or establish physical visual acceptance.
function renderMonitoring(observation: QueueMonitoring | null, loading = false, error = '') {
  let slot = 0;
  const states = [observation, loading, error];
  const imports: Record<string, unknown> = {
    react: { ...React, useState: () => [states[slot++], () => {}], useRef: () => ({ current: null }), useEffect: () => {} },
    '@mui/material': mui, 'react/jsx-runtime': require('react/jsx-runtime'),
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/(authenticated)/insw/queue-settings/QueueMonitoring.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; } });
  const html = renderToStaticMarkup(exports.default());
  return { html, text: html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '') };
}
const fixture: QueueMonitoring = {
  observedAt: '2026-11-14T00:00:00Z', companyCode: 1370,
  worker: { status: 'Owner recorded — process status unverified', ownershipPresent: true, busy: true, lastTransmissionStartedAt: '2026-11-13T23:59:00Z' },
  counts: { READY: 0, CLAIMED: 2, HELD: 1, FAILED: 0, REMOTE_SUCCEEDED: 3, SUCCEEDED: 98, SUPERSEDED: 4 }, failures: [],
};

test('rendered summary contains seven distinct metric tiles with exact zero/nonzero values and wrapping long labels', () => {
  const view = renderMonitoring(fixture);
  const tiles = [...view.html.matchAll(/data-testid="queue-metric-([A-Z_]+)"([\s\S]*?<dd[^>]*>)([^<]*)<\/dd>/g)];
  expect(tiles).toHaveLength(7);
  expect(tiles.map(tile => [tile[1], tile[3]])).toEqual(Object.entries(fixture.counts).map(([status, count]) => [status, count.toLocaleString()]));
  for (const tile of tiles) expect(tile[2]).toContain(tile[1]);
  expect(view.text).toContain('Remote succeeded / finalization pending');
  expect(view.text).toContain('including historical and superseded cycles');
  // Verify emitted responsive CSS, not visual geometry. minmax + wrapping and
  // bottom-aligned values protect narrow columns and long enum/label content.
  for (const columns of [2, 3, 4]) expect(view.html).toContain(`repeat(${columns}, minmax(0, 1fr))`);
  for (const breakpoint of [600, 900, 1200]) expect(view.html).toContain(`min-width:${breakpoint}px`);
  for (const rule of ['overflow-wrap:anywhere', 'min-width:0', 'margin-top:auto', 'font-variant-numeric:tabular-nums']) expect(view.html).toContain(rule);
  expect(view.html).not.toContain('text-overflow:ellipsis');
});

test('rendered worker observations retain explicit scope/timezone and honest heartbeat/empty evidence limitations', () => {
  const view = renderMonitoring(fixture);
  for (const text of ['Worker Monitoring', 'Queue Summary', 'Recent Recorded Queue/Worker Issues', 'company 1370', '14/11/2026, 07:00:00 WIB', 'Owner recorded — process status unverified', 'Busy marker recorded', 'No verified heartbeat available', 'No recorded local issues in the last 7 days', 'Incomplete local queue-evidence subset', 'transport ambiguity and remote unknown outcomes are excluded']) expect(view.text).toContain(text);
  expect(view.text).not.toMatch(/Running|Stopped|Healthy/);
  const absent = renderMonitoring({ ...fixture, worker: { status: 'Unknown / Stale — no owner recorded', ownershipPresent: false, busy: false, lastTransmissionStartedAt: null } });
  for (const text of ['Unknown / Stale', 'Idle marker', 'Not recorded']) expect(absent.text).toContain(text);
});

test('rendered failures use structured safe fields, evidence time, and queue references for all 20 available records', () => {
  const failures = Array.from({ length: 20 }, (_, i) => ({ queueId: `queue-${i}`, recordedAt: fixture.observedAt, category: 'Local finalization pending', message: 'Remote success recorded; local finalization required.', source: 'insw_queue_cycle' }));
  const view = renderMonitoring({ ...fixture, failures });
  expect(view.html.match(/<li /g)).toHaveLength(20);
  for (const failure of failures) expect(view.text).toContain(`Queue ${failure.queueId} · Source: insw_queue_cycle`);
  for (const text of ['Evidence time (WIB)', 'Category', 'Summary / queue reference', failures[0].message]) expect(view.text).toContain(text);
  expect(view.text).not.toContain('No recorded local issues');
});

test('rendered loading/unavailable/stale states never fabricate zeros and keep previous metric evidence', () => {
  const loading = renderMonitoring(null, true);
  expect(loading.html).toContain('aria-label="Refreshing queue monitoring"');
  expect(loading.html).not.toContain('queue-metric-');
  expect(loading.html).toMatch(/<button[^>]*disabled=""/);
  const unavailable = renderMonitoring(null, false, 'Monitoring refresh failed. Current state is unknown.');
  expect(unavailable.text).toContain('Counts and worker state are unknown');
  expect(unavailable.html).not.toContain('queue-metric-');
  expect(unavailable.html).not.toMatch(/<button[^>]*disabled/);
  const stale = renderMonitoring(fixture, false, 'Monitoring refresh failed. The last observation is stale; current state is unknown.');
  expect(stale.text).toContain('Last observation (stale)');
  expect(stale.html.match(/data-testid="queue-metric-/g)).toHaveLength(7);
  expect(stale.html).toMatch(/<dd[^>]*>98<\/dd>/);
});

test('monitoring requests remain no-store with a 15-second abort bound and a single polling stream', async () => {
  const view = monitor();
  expect(view.pending[0].url).toBe('/api/insw/queue-settings/monitoring');
  expect(view.pending[0].cache).toBe('no-store');
  const timeout = [...view.timers.values()].find(timer => timer.ms === 15000)!;
  timeout.fn(); expect(view.pending[0].signal.aborted).toBe(true);
  view.render().reload.current(); expect(view.pending).toHaveLength(1);
  view.pending[0].resolve({ ok: false, json: async () => ({}) }); await settle();
  expect(view.render().observation).toBeNull();
  expect(view.render().error).toContain('unknown');
  view.cleanup();
});
