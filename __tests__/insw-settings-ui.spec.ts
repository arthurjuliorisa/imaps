import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as mui from '@mui/material';

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
    'react/jsx-runtime': {}, './QueueMonitoring': {},
  };
  const source = readFileSync('app/(authenticated)/insw/queue-settings/QueueSettings.tsx', 'utf8').replace('  return (\n    <Box',
    '  return { load, save, setInterval, setMaxAutoRetry, setReason, policy, interval, reason, loading, saving, error, canSave, recoverWorker, recoveryStatus, recoveryBusy, recoveryConfirmation, setShutdownEvidence } as any;\n  return (\n    <Box');
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText,
    { exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; }, fetch: fetcher, TextDecoder });
  return { render: () => { cursor = 0; return exports.default({ showWorkerRecovery: true, workerRecoveryAvailable: true }); }, messages };
}
const policy = { intervalMs: 3600, maxAutoRetry: 3, version: 3, updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'admin', reason: 'Initial' };
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
  expect(saved).toEqual({ intervalMs: 5000, maxAutoRetry: 3, expectedVersion: 3, reason: 'Planned cadence' });
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


test('retry-only changes require integer bounds and audited review and submit exact numeric retry', async () => {
  let saved: any;
  const view = editor(async (_url, init) => {
    if (!init?.method) return response(200, { data: policy });
    saved = JSON.parse(String(init.body));
    return response(200, { data: { ...policy, maxAutoRetry: 0, version: 4 } });
  });
  await view.render().load();
  let page = view.render(); page.setReason('Disable automatic retries');
  for (const value of ['', '-1', '1.5', '11', 'NaN']) {
    page.setMaxAutoRetry(value); expect(view.render().canSave).toBe(false);
  }
  page.setMaxAutoRetry('0'); page = view.render(); expect(page.canSave).toBe(true);
  await page.save(); expect(saved).toEqual({ intervalMs: 3600, maxAutoRetry: 0, expectedVersion: 3, reason: 'Disable automatic retries' });
  expect(view.render().policy.maxAutoRetry).toBe(0);
});

function renderSettings(overrides: Record<number, unknown> = {}, showWorkerRecovery = false) {
  let slot = 0;
  const defaults: Record<number, unknown> = { 0: policy, 1: '3600', 2: '3', 3: '', 4: false, 5: false, 6: false, 7: '' };
  const imports: Record<string, unknown> = {
    react: { ...React, useState: (initial: unknown) => { const index = slot++; return [index in overrides ? overrides[index] : index in defaults ? defaults[index] : initial, () => {}]; }, useEffect: () => {}, useCallback: (fn: unknown) => fn },
    '@mui/material': mui, 'react/jsx-runtime': require('react/jsx-runtime'),
    '@/app/components/ConfirmDialog': { ConfirmDialog: () => null },
    '@/app/components/ToastProvider': { useToast: () => ({}) }, './QueueMonitoring': { default: () => null },
  };
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(readFileSync('app/(authenticated)/insw/queue-settings/QueueSettings.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; } });
  const html = renderToStaticMarkup(exports.default({ showWorkerRecovery }));
  return { html, text: html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '') };
}

test('worker recovery is hidden by default and explicitly unavailable when permitted by the server', () => {
  expect(renderSettings().text).not.toContain('Recover &amp; Restart Worker');
  const view = renderSettings({}, true);
  expect(view.html).toMatch(/<button[^>]*disabled=""[^>]*>Recover &amp; Restart Worker/);
  expect(view.text).toContain('Worker recovery is unavailable. Contact your system administrator.');
});

test('rendered policy uses full available width and responsive grouped inputs while preserving review/audit copy', () => {
  const view = renderSettings();
  for (const text of ['Transmission Policy', 'Processing interval (milliseconds)', 'Maximum Automatic Retries', 'Reason for change', 'Policy version 3', 'existing cycles retain their retry snapshot', 'Review change', 'Reload settings']) expect(view.text).toContain(text);
  expect(view.html).toContain('max-width:1280px');
  expect(view.html).toContain('repeat(2, minmax(0, 1fr))');
  expect(view.html).toContain('grid-template-columns:minmax(0, 1fr)');
  expect(view.html).toMatch(/<button[^>]*disabled=""[^>]*>Review change/);
  const draft = renderSettings({ 1: '5000', 3: 'Audited change' });
  expect(draft.html).not.toMatch(/<button[^>]*disabled=""[^>]*>Review change/);
  for (const state of [{ 5: true }, { 6: true }]) {
    const locked = renderSettings(state);
    expect(locked.html.match(/<input[^>]*disabled=""/g)).toHaveLength(3);
    expect(locked.html).toMatch(/<button[^>]*disabled=""[^>]*>Reload settings/);
  }
});

test('rendered policy loading, unavailable and conflict states keep controls honest', () => {
  const loading = renderSettings({ 0: null, 4: true });
  expect(loading.html).toContain('aria-label="Loading queue settings"');
  expect(loading.html).not.toContain('<form');
  const unavailable = renderSettings({ 0: null, 7: 'Unable to load queue settings' });
  expect(unavailable.text).toContain('Unable to load queue settings');
  expect(unavailable.text).toContain('Reload settings');
  expect(unavailable.html).not.toContain('<form');
  const conflict = renderSettings({ 7: 'Another administrator changed the policy. Current settings have been reloaded; review and enter your change again.' });
  expect(conflict.html).toContain('role="alert"');
  expect(conflict.text).toContain('Another administrator changed the policy');
});

test('page permits only Admin settings access and redirects unauthenticated/forbidden sessions before rendering', async () => {
  for (const access of [401, 403, 200]) {
    const redirects: string[] = [];
    const imports: Record<string, unknown> = {
      'next-auth': { getServerSession: async () => ({ user: { role: access === 200 ? 'ADMIN' : 'USER' } }) },
      'next/navigation': { redirect: (url: string) => { redirects.push(url); throw new Error('REDIRECT'); } },
      '@/lib/auth': { authOptions: {} }, '@/lib/insw-queue/interval-settings-http': { intervalSettingsAccess: () => access },
      '@/lib/insw-queue/worker-recovery': { workerRecoveryAllowed: () => false, fixedWorkerRecoveryHost: { available: () => false } },
      './QueueSettings': { default: () => null }, 'react/jsx-runtime': require('react/jsx-runtime'),
    };
    const exports: any = {};
    vm.runInNewContext(ts.transpileModule(readFileSync('app/(authenticated)/insw/queue-settings/page.tsx', 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    }).outputText, { exports, require: (name: string) => { if (!(name in imports)) throw new Error(`Unmocked ${name}`); return imports[name]; } });
    if (access === 200) { expect(await exports.default()).toBeTruthy(); expect(redirects).toEqual([]); }
    else { await expect(exports.default()).rejects.toThrow('REDIRECT'); expect(redirects).toEqual([access === 401 ? '/login' : '/access-denied']); }
  }
});


test('recovery UI renders only server stages and verified running/already-running outcomes', async () => {
  for (const result of ['running', 'already-running', 'refused']) {
    let submitted: RequestInit | undefined;
    const body = [{ stage: 'Checking' }, { stage: 'Recovering' }, { stage: 'Starting' }, { result }].map(x => JSON.stringify(x)).join('\n') + '\n';
    const view = editor(async (_url, init) => { submitted = init; return new Response(body); });
    const task = view.render().recoverWorker();
    expect(view.render().recoveryBusy).toBe(true);
    await task;
    expect(submitted?.body).toBe('{}');
    expect(view.render().recoveryStatus).toBe(result === 'running' ? 'Running' : result === 'already-running' ? 'Already running' : 'Unable to recover');
    expect(view.render().recoveryBusy).toBe(false);
  }
});
test('recovery UI treats truncated streams and HTTP errors as unable to recover', async () => {
  for (const response of [new Response('{"stage":"Starting"}\n'), new Response('private OS output', { status: 503 })]) {
    const view = editor(async () => response);
    await view.render().recoverWorker();
    expect(view.render().recoveryStatus).toBe('Unable to recover');
    expect(view.messages).toEqual(['Unable to recover']);
  }
});


test('recovery UI waits for genuine shutdown evidence and explicit confirmation before resubmitting', async () => {
  const confirmation = '1999999999999.' + 'a'.repeat(64);
  const bodies: string[] = [];
  const view = editor(async (_url, init) => {
    bodies.push(String(init?.body));
    return new Response(JSON.stringify(bodies.length === 1 ? { result: 'confirmation-required', confirmation } : { result: 'running' }) + '\n');
  });
  await view.render().recoverWorker();
  expect(view.render().recoveryStatus).toBe('Shutdown verification required');
  expect(view.render().recoveryConfirmation).toBe(confirmation);
  expect(view.messages).toEqual([]);
  await view.render().recoverWorker(true); expect(bodies).toEqual(['{}']);
  view.render().setShutdownEvidence('Verified supervisor stopped and all descendants reaped');
  await view.render().recoverWorker(true);
  expect(JSON.parse(bodies[1])).toEqual({ confirmation, shutdownAcknowledged: true, evidence: 'Verified supervisor stopped and all descendants reaped' });
  expect(view.render().recoveryStatus).toBe('Running');
  expect(view.render().recoveryConfirmation).toBe('');
});
