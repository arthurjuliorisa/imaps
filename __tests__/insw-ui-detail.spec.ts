import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as mui from '@mui/material';
import dayjs from 'dayjs';
import * as presentation from '../lib/insw-log-presentation';
import * as operational from '../lib/insw-queue/operational-state';

// Render the actual page JSX with fixture state. This is static component
// verification, not an authenticated browser or CSS/keyboard acceptance test.
function render(overrides: Record<number, unknown> = {}) {
  let slot = 0;
  const hooks = { ...React, useState: (initial: unknown) => {
    const index = slot++; return [index in overrides ? overrides[index] : initial, () => {}];
  }, useRef: (current: unknown) => ({ current }), useEffect: () => {} };
  const Empty = () => null;
  const charts = new Proxy({}, { get: () => Empty });
  const imports: Record<string, unknown> = {
    react: hooks, '@mui/material': { ...mui, useTheme: () => mui.createTheme() },
    '@mui/icons-material': require('@mui/icons-material'), recharts: charts,
    '@/app/components/DataTable': { DataTable: ({ columns, data, loading }: any) => React.createElement('div', null,
      loading ? 'Loading logs' : data.length ? data.map((row: any) => React.createElement('div', { key: row.id }, columns.map((c: any) => React.createElement('div', { key: c.id }, c.format ? c.format(row[c.id], row) : row[c.id])))) : 'No data available') },
    '@/app/components/ToastProvider': { useToast: () => ({}) }, dayjs,
    '@/lib/insw-queue/operational-state': operational, '@/lib/insw-log-presentation': presentation, 'react/jsx-runtime': require('react/jsx-runtime'),
  };
  const source = readFileSync('app/(authenticated)/insw/logs/page.tsx', 'utf8');
  const exports: any = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText,
    { exports, require: (name: string) => imports[name], URLSearchParams });
  // SSR does not render MUI portals. Render Dialog children inline for assertions.
  (imports['@mui/material'] as any).Dialog = ({ open, children }: any) => open ? React.createElement('section', null, children) : null;
  const html = renderToStaticMarkup(exports.default());
  return { html, text: html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, '') };
}
const q = { id: 'q', status: 'FAILED', delivery_state: 'KNOWN_FAILURE', cycle: 1, intent: 'SOURCE_COMMIT',
  retry_index: 10, max_auto_retry_snapshot: 10, attempts_started: 11, queued_at: '2026-11-01T00:00:00Z', next_eligible_at: '2026-11-01T00:00:00Z', latest_log_id: '11' };
const log = { id: '11', transaction_type: 'incoming', insw_status: 'FAILED', retry_count: 10, current_queue: q,
  queue_id: 'q', can_resend: false, metadata: {}, attempt_history: { truncated: false, entries: [0, 1, 2].map(i => ({ id: `a${i}`,
    cycle: 1, retry_index: i, max_auto_retry_snapshot: 2, delivery_state: 'KNOWN_FAILURE', outcome: 'FAILED',
    claimed_at: '2026-11-01T00:00:00Z', started_at: null, completed_at: null, log_id: String(i + 1),
    provenance: i === 0 ? 'SIMULATED_REMOTE_REJECTION' : i === 2 ? 'REAL_INSW_TEST_RESPONSE' : null, http_code: '503' })) } };

test('rendered history shows readable chronology and explicit persisted provenance', () => {
  const view = render({ 1: false, 15: true, 16: '11', 17: log });
  expect(view.text).not.toContain('retry index');
  expect(view.text).not.toContain('SOURCE_COMMIT');
  expect(view.text.indexOf('Transmission 1')).toBeLessThan(view.text.indexOf('Transmission 2'));
  expect(view.text.indexOf('Transmission 2')).toBeLessThan(view.text.indexOf('Transmission 3'));
  expect(view.text).not.toContain('Policy snapshot');
  expect(view.text.match(/Simulated remote rejection/g)).toHaveLength(1);
  expect(view.text).toContain('Actual INSW TEST response');
  expect(view.text).toContain('HTTP 503');
  expect(view.text).toContain('November-26');
});

for (const status of ['READY', 'CLAIMED', 'FAILED', 'SUCCEEDED', 'HELD']) {
  test(`rendered ${status} state remains separate from historical FAILED; server flag controls RESEND`, () => {
    const row = { ...log, current_queue: { ...q, status, hold_reason: status === 'HELD' ? 'DELIVERY_UNKNOWN' : null } };
    const view = render({ 0: [row], 1: false });
    expect(view.text).toContain(({ READY: 'Queued', CLAIMED: 'Sending', FAILED: 'Failed', SUCCEEDED: 'Sent Successfully', HELD: 'Delivery Uncertain' } as Record<string, string>)[status]);
    expect(view.text).toContain('Failed');
    expect(view.html).toContain('aria-label="View details for log 11"');
    expect(view.html).toContain('aria-label="Refresh INSW logs"');
    expect(view.html).not.toContain('aria-label="Kirim Ulang"');
    if (status === 'HELD') expect(view.text).toContain('confirm receipt before sending again');
  });
}

test('server-eligible row offers RESEND with concise failure guidance', () => {
  const view = render({ 0: [{ ...log, can_resend: true, current_queue: { ...q, retry_index: 0, max_auto_retry_snapshot: 0, attempts_started: 1 } }], 1: false });
  expect(view.html).toContain('aria-label="Kirim Ulang"');
  expect(view.text).toContain('Review the error before using Resend');
});

test('detail loading, failure/retry and empty history have visible feedback', () => {
  expect(render({ 15: true, 18: true }).html).toContain('role="progressbar"');
  // Last useState slot is the newly appended detail error state.
  const error = render({ 15: true, 32: 'Fixture detail unavailable' });
  expect(error.text).toContain('Fixture detail unavailable');
  expect(error.text).toContain('Retry');
  expect(render({ 15: true, 16: '11', 17: { ...log, attempt_history: { entries: [], truncated: false } } }).text).toContain('No transmissions recorded yet');
  expect(render({ 1: false }).text).toContain('No data available');
});
