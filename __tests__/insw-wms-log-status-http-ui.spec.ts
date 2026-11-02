import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { NextRequest, NextResponse } from 'next/server';
import { buildWmsLogWhere, WmsLogFilterError, wmsLogFilterParams } from '../lib/wms-log-filters';
import { Prisma } from '@prisma/client';
import { bindWmsCsvFilters } from '../lib/wms-log-sql';
import { WMS_INSW_STATUSES } from '../lib/wms-insw-status-options';
import * as regenerationMessages from '../lib/insw-regeneration-messages';
import { serializeBigInt } from '../lib/bigint-serializer';

function moduleFrom(path: string, imports: Record<string, unknown>, globals = {}) {
  imports = { '@/lib/insw-regeneration-messages': regenerationMessages, '@/lib/config/insw-company-config': { resolveInswCompanyConfig: () => ({ useTestMode: true }) }, '@prisma/client': { Prisma }, '@/lib/wms-log-sql': { bindWmsCsvFilters }, '@/lib/wms-insw-status-options': { WMS_INSW_STATUSES }, ...imports };
  const exports: Record<string, any> = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText, { exports, require: (name: string) => {
    if (!(name in imports)) throw new Error(`Unmocked import ${name}`);
    return imports[name];
  }, console, URL, URLSearchParams, ...globals });
  return exports;
}
const status = { label: 'Not queued', explanation: 'Persisted source; no delivery evidence.', workerAuthorized: true,
  canRegenerate: false, regenerationBlock: 'Completed processing and queue-era membership unproven.' };

test('actual list route requires menu VIEW and stops before querying for unauthorized sessions', async () => {
  for (const code of [401, 403]) {
    const route = moduleFrom('app/api/settings/wms-transmission-logs/route.ts', {
      'next/server': { NextResponse }, '@/lib/prisma': { prisma: {} },
      '@/lib/menu-auth': { checkMenuAuth: async (path: string) => { expect(path).toBe('/settings/wms-logs'); return { authenticated: false, response: NextResponse.json({}, { status: code }) }; } },
      '@/lib/insw-queue/wms-log-status': {}, '@/lib/bigint-serializer': { serializeBigInt },
      '@/lib/wms-log-filters': { buildWmsLogWhere, WmsLogFilterError },
    });
    expect((await route.GET(new NextRequest('http://localhost/api/settings/wms-transmission-logs'))).status).toBe(code);
  }
});

test('actual list route batches once, scopes company and gates edit affordance and INSW link independently', async () => {
  for (const canEdit of [false, true]) {
    let batches = 0;
    const route = moduleFrom('app/api/settings/wms-transmission-logs/route.ts', {
      'next/server': { NextResponse }, '@/lib/prisma': { prisma: { wms_transmission_logs: {
        findMany: async ({ where }: any) => { expect(where.company_code).toBe(1370); return [
          { id: BigInt(1), company_code: 1370 }, { id: BigInt(2), company_code: 1370 },
        ]; }, count: async () => 2,
      } } },
      '@/lib/menu-auth': { checkMenuAuth: async () => ({ authenticated: true, grants: { canEdit }, session: { user: { id: 'fixture', role: 'USER', companyCode: 1370 } } }),
        resolveMenuGrants: async () => ({ canView: false }) },
      '@/lib/insw-queue/wms-log-status': { wmsLogInswStatuses: async (_db: any, user: any, ids: bigint[]) => {
        batches++; expect(user.companyCode).toBe(1370); expect(ids).toEqual([BigInt(1), BigInt(2)]);
        // Only applicable SEZ rows receive status; BZ/unsupported rows keep their shape.
        return new Map([['1', status]]);
      } }, '@/lib/bigint-serializer': { serializeBigInt }, '@/lib/wms-log-filters': { buildWmsLogWhere, WmsLogFilterError },
    });
    const response = await route.GET(new NextRequest('http://localhost/api/settings/wms-transmission-logs?include_filters=false'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0].insw).toMatchObject({ canInspectRegeneration: canEdit, canViewInswLogs: false, canRegenerate: false });
    expect(body.data[1].insw).toBeUndefined(); expect(batches).toBe(1);
    expect((await route.GET(new NextRequest('http://localhost/api/settings/wms-transmission-logs?company_code=1380'))).status).toBe(403);
  }
});

type Node = { type?: string; props?: Record<string, any> };
function nodes(value: any): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...nodes(value.props?.children)];
}

test('actual page keeps BZ status unchanged and renders separate SEZ status plus disabled regeneration explanation', async () => {
  let cursor = 0;
  const slots: any[] = [];
  const hooks = { useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = initial;
    return [slots[i], (value: any) => { slots[i] = value; }]; }, useEffect: () => {} };
  const mui = require('@mui/material');
  const requests: string[] = [];
  const posted: RequestInit[] = [];
  const successes: string[] = [];
  let failureCode: string | undefined;
  let networkFailure = false;
  const pageModule = moduleFrom('app/(authenticated)/settings/wms-logs/page.tsx', {
    react: hooks,
    '@mui/material': new Proxy({ useTheme: () => mui.createTheme(), alpha: mui.alpha }, { get: (o, k) => (o as any)[k] ?? k }),
    '@mui/icons-material': new Proxy({}, { get: (_o, k) => k }),
    '@/app/components/DataTable': { DataTable: 'DataTable' },
    '@/app/components/ToastProvider': { useToast: () => ({ success: (message: string) => successes.push(message), error: () => {} }) },
    'next-auth/react': { useSession: () => ({ data: { user: { role: 'ADMIN', companyCode: '1370' } } }) },
    dayjs: require('dayjs'), '@/lib/wms-log-filters': { wmsLogFilterParams },
    'react/jsx-runtime': { jsx: (type: string, props: any) => ({ type, props }), jsxs: (type: string, props: any) => ({ type, props }) },
  }, { fetch: async (url: string, init?: RequestInit) => { requests.push(url); if (init?.method === 'POST') { posted.push(init); if (networkFailure) throw new Error('raw network detail');
    if (failureCode) return { ok: false, json: async () => ({ code: failureCode, message: 'raw VERIFICATION_INCONCLUSIVE detail' }) }; } return { ok: true, blob: async () => new Blob(['fixture']),
    json: async () => ({ success: true, data: [], pagination: { total: 0 } }) }; },
    URL: class extends URL { static createObjectURL() { return 'blob:fixture'; } static revokeObjectURL() {} },
    document: { createElement: () => ({ click() {}, remove() {} }), body: { appendChild() {} } }, setTimeout() {},
  });
  const render = () => { cursor = 0; return pageModule.default(); };
  let tree = render();
  const table = nodes(tree).find(n => n.type === 'DataTable')!;
  const format = table.props!.columns.find((c: any) => c.id === 'transmission_status').format;
  expect(nodes(format('SUCCESS', {})).filter(n => n.type === 'Chip').map(n => n.props!.label)).toEqual(['SUCCESS']);
  expect(nodes(format('SUCCESS', { insw: status })).filter(n => n.type === 'Chip').map(n => n.props!.label)).toEqual(['SUCCESS']);
  const insw = table.props!.columns.find((c: any) => c.id === 'insw');
  expect(insw.label).toBe('INSW Status');
  expect(table.props!.columns.find((c: any) => c.id === 'transmission_status').label).toBe('WMS Status');
  expect(insw.format(undefined, {})).toBe('—');
  expect(nodes(insw.format(status, { insw: status })).find(n => n.type === 'Chip')!.props!.label).toBe('Not queued');
  const filter = nodes(tree).find(n => n.type === 'TextField' && n.props!.label === 'INSW Status')!;
  expect(filter.props!.value).toBe('ALL');
  table.props!.pagination.onPageChange(3);
  filter.props!.onChange({ target: { value: 'Queued' } });
  tree = render();
  expect(nodes(tree).find(n => n.type === 'DataTable')!.props!.pagination.page).toBe(0);
  expect(nodes(tree).find(n => n.type === 'TextField' && n.props!.label === 'INSW Status')!.props!.value).toBe('Queued');
  const refresh = () => nodes(tree).find(n => n.type === 'Tooltip' && n.props!.title === 'Refresh')!.props!.children.props.onClick();
  refresh();
  expect(new URL(requests.at(-1)!, 'http://localhost').searchParams.get('insw_status')).toBe('Queued');
  nodes(tree).find(n => n.type === 'TextField' && n.props!.label === 'Search WMS ID')!.props!.onChange({ target: { value: 'TARGET' } });
  tree = render();
  nodes(tree).find(n => n.type === 'TextField' && n.props!.label === 'Search WMS ID')!.props!.onKeyDown({ key: 'Enter', preventDefault() {} });
  tree = render(); refresh();
  const searched = new URL(requests.at(-1)!, 'http://localhost').searchParams;
  expect(searched.get('insw_status')).toBe('Queued'); expect(searched.get('wms_id')).toBe('TARGET');
  await nodes(tree).find(n => n.type === 'Button' && n.props!['aria-label'] === 'Export CSV (max 100,000 rows)')!.props!.onClick();
  const exported = new URL(requests.at(-1)!, 'http://localhost');
  expect(exported.pathname).toBe('/api/settings/wms-transmission-logs/export/csv');
  expect(exported.searchParams.get('insw_status')).toBe('Queued');
  expect(exported.searchParams.get('wms_id')).toBe('TARGET');
  nodes(tree).find(n => n.type === 'TextField' && n.props!.label === 'INSW Status')!.props!.onChange({ target: { value: 'ALL' } });
  tree = render(); refresh();
  const reset = new URL(requests.at(-1)!, 'http://localhost').searchParams;
  expect(reset.has('insw_status')).toBe(false); expect(reset.get('wms_id')).toBe('TARGET');
  const actions = table.props!.columns.find((c: any) => c.id === 'actions').format;
  for (const canInspectRegeneration of [false, true]) {
    const detail = { id: '1', transmission_status: 'SUCCESS', insw: { ...status, canInspectRegeneration, canViewInswLogs: false } };
    const viewButton = nodes(actions(null, detail)).find(n => n.type === 'IconButton')!;
    viewButton.props!.onClick(); tree = render();
    const buttons = nodes(tree).filter(n => n.type === 'Button' && n.props!.children === 'Regenerate INSW Transmission');
    expect(buttons).toHaveLength(canInspectRegeneration ? 1 : 0);
    if (canInspectRegeneration) {
      expect(buttons[0].props!.disabled).toBe(true);
      expect(typeof buttons[0].props!.onClick).toBe('function');
      expect(nodes(tree).some(n => n.type === 'Tooltip' && n.props!.title === status.regenerationBlock)).toBe(true);
    }
    expect(nodes(tree).some(n => n.props?.href === '/insw/logs')).toBe(false);
  }
  const candidate = { id: '9', wms_id: 'LEGACY-EXACT', company_code: 1370, action: 'WMS_PROCESS_INCOMING_GOODS', transmission_status: 'SUCCESS',
    insw: { ...status, canInspectRegeneration: true, canRegenerate: true, regenerationDestination: 'TEST' } };
  nodes(actions(null, candidate)).find(n => n.type === 'IconButton')!.props!.onClick(); tree = render();
  const regenerate = nodes(tree).find(n => n.type === 'Button' && n.props!.children === 'Regenerate INSW Transmission')!;
  expect(regenerate.props!.disabled).toBe(false); regenerate.props!.onClick(); tree = render();
  expect(nodes(tree).some(n => n.type === 'Dialog' && n.props!.open)).toBe(true);
  const confirmEmpty = nodes(tree).find(n => n.type === 'Button' && n.props!.children === 'Confirm Regeneration')!;
  expect(confirmEmpty.props!.disabled).toBe(true);
  const dialog = nodes(tree).find(n => n.type === 'Dialog' && n.props!['aria-labelledby'] === 'regenerate-insw-title')!;
  expect(dialog.props).toMatchObject({ fullWidth: true, maxWidth: 'sm', 'aria-describedby': 'regenerate-insw-confirmation' });
  expect(JSON.stringify(dialog)).not.toMatch(/fresh INSW duplicate check|Verifying/);
  expect(nodes(dialog).some(n => n.props?.children === 'Have you checked this transaction on the official INSW website and confirmed that it has not already been transmitted?')).toBe(true);
  const reviewField = nodes(tree).find(n => n.type === 'TextField' && n.props!.label === 'Reason')!;
  expect(reviewField.props).toMatchObject({ required: true, autoFocus: true, placeholder: 'Enter the reason for regeneration', inputProps: { maxLength: 500 } });
  reviewField.props!.onChange({ target: { value: 'Recover missing queue' } }); tree = render();
  const confirm = nodes(tree).find(n => n.type === 'Button' && n.props!.children === 'Confirm Regeneration')!;
  expect(confirm.props!.disabled).toBe(false);
  const pending = confirm.props!.onClick(); tree = render();
  expect(nodes(tree).some(n => n.type === 'Button' && n.props!.children === 'Queuing…' && n.props!.disabled)).toBe(true);
  const pendingDialog = nodes(tree).find(n => n.type === 'Dialog' && n.props!['aria-labelledby'] === 'regenerate-insw-title')!;
  expect(nodes(pendingDialog).find(n => n.type === 'TextField')!.props!.disabled).toBe(true);
  expect(nodes(pendingDialog).find(n => n.type === 'Button' && n.props!.children === 'Cancel')!.props!.disabled).toBe(true);
  pendingDialog.props!.onClose();
  expect(nodes(render()).find(n => n.type === 'Dialog' && n.props!['aria-labelledby'] === 'regenerate-insw-title')!.props!.open).toBe(true);
  await pending;
  expect(requests.some(url => url.endsWith('/9/regenerate-insw'))).toBe(true);
  const body = JSON.parse(posted[0].body as string);
  expect(body).toEqual({ reason: 'Recover missing queue' });
  expect(successes).toContain(regenerationMessages.REGENERATION_SUCCESS);
  expect(requests.at(-1)).toContain('/api/settings/wms-transmission-logs?');
  for (const code of ['VERIFICATION_INCONCLUSIVE', 'TRANSMISSION_HISTORY_EXISTS', 'NETWORK']) {
    failureCode = code; networkFailure = code === 'NETWORK';
    nodes(actions(null, candidate)).find(n => n.type === 'IconButton')!.props!.onClick(); tree = render();
    nodes(tree).find(n => n.type === 'Button' && n.props!.children === 'Regenerate INSW Transmission')!.props!.onClick(); tree = render();
    nodes(tree).find(n => n.type === 'TextField' && n.props!.label === 'Reason')!.props!.onChange({ target: { value: 'Retry missing queue' } }); tree = render();
    await nodes(tree).find(n => n.type === 'Button' && n.props!.children === 'Confirm Regeneration')!.props!.onClick(); tree = render();
    const dialog = nodes(tree).find(n => n.type === 'Dialog' && n.props!['aria-labelledby'] === 'regenerate-insw-title')!;
    expect(dialog.props!.open).toBe(true);
    const alert = nodes(dialog).find(n => n.type === 'Alert')!;
    expect(alert.props!.children).toBe(regenerationMessages.regenerationMessage(code));
    expect(alert.props!.children).not.toMatch(/VERIFICATION_INCONCLUSIVE|raw/);
    expect(nodes(dialog).filter(n => n.type === 'TextField')).toHaveLength(1);
    expect(nodes(dialog).some(n => n.type === 'Checkbox')).toBe(false);
    expect(nodes(dialog).find(n => n.type === 'Button' && n.props!.children === 'Cancel')!.props!.disabled).toBe(false);
  }

});


test('CSV route requires the same WMS VIEW grant before any export/filter access', async () => {
  for (const code of [401, 403]) {
    const route = moduleFrom('app/api/settings/wms-transmission-logs/export/csv/route.ts', {
      '@/lib/menu-auth': { checkMenuAuth: async (path: string) => {
        expect(path).toBe('/settings/wms-logs'); return { authenticated: false, response: NextResponse.json({}, { status: code }) };
      } }, '@/lib/wms-log-filters': { buildWmsLogWhere, WmsLogFilterError },
      '@/lib/logs-csv': {}, '@/lib/insw-logs-csv-spool': {}, '@/lib/wms-logs-csv': {}, '@/lib/wms-logs-csv-postgresql': {},
    });
    expect((await route.GET(new Request('http://localhost/api/settings/wms-transmission-logs/export/csv?insw_status=Not+queued'))).status).toBe(code);
  }
});
