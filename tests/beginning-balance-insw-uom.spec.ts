import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import * as nextServer from 'next/server';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTheme, ThemeProvider } from '@mui/material/styles';

function load(file: string, dependencies: Record<string, unknown>, logger: unknown = console): any {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', 'console', source)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exports, logger);
  return exports;
}

const balance = (uom = 'KG', id = 1) => ({
  id, company_code: 1310, item_code: `ITEM-${id}`, item_name: 'Material', item_type: 'ROH',
  uom, qty: '12.125', balance_date: new Date('2026-01-01T00:00:00Z'),
  ceisa_insw_uom: null as string | null, remarks: 'fixture', ppkeks: [{ ppkek_number: 'PP-1' }],
});
type Mapping = { wms_uom: string; insw_uom: string; is_active?: boolean };

function harness(rows = [balance()]) {
  const calls: Array<{ name: string; args: any }> = [];
  const warnings: unknown[][] = [];
  const errors: unknown[][] = [];
  let mappings: Mapping[] = [{ wms_uom: 'KG', insw_uom: 'KGM', is_active: true }];
  let authenticated = true;
  let failure = false;
  let statuses = rows.map(row => ({ id: row.id, status: 'OPEN' }));
  const record = (name: string, result: (args: any) => unknown) => async (args: any) => {
    calls.push({ name, args });
    return result(args);
  };
  // No mutation or transmission methods exist on these doubles: unexpected calls fail.
  const prisma = {
    beginning_balances: {
      groupBy: record('balance.groupBy', () => statuses),
      count: record('balance.count', () => 23),
      findMany: record('balance.findMany', args => rows.filter(row => row.company_code === args.where.company_code).map(row => ({ ...row, status: statuses.find(status => status.id === row.id)?.status ?? 'OPEN' }))),
    },
    insw_uom_mapping: { findMany: record('mapping.findMany', args => {
      if (failure) throw new Error('synthetic mapping query failure');
      return mappings.filter(mapping => !args.where.is_active || mapping.is_active !== false)
        .map(({ wms_uom, insw_uom }) => ({ wms_uom, insw_uom }));
    }) },
    $queryRawUnsafe: async (...args: unknown[]) => { calls.push({ name: 'status', args }); return statuses; },
    incoming_good_items: { count: record('incoming.count', () => 0) },
    outgoing_good_items: { count: record('outgoing.count', () => 0) },
  };
  const companyValidation = load('lib/company-validation.ts', { 'next/server': nextServer, '@/lib/prisma': { prisma } });
  const route = load('app/api/customs/beginning-data/route.ts', {
    'next/server': nextServer, '@/lib/prisma': { prisma },
    '@/lib/api-auth': { checkAuth: async () => authenticated
      ? { authenticated: true, session: { user: { companyCode: '1310' } } }
      : { authenticated: false, response: nextServer.NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } },
    '@/lib/company-validation': companyValidation,
    '@/lib/log-activity': {}, '@/lib/api-utils': {}, '@/lib/beginning-data-validation': {},
    '@/lib/services/beginning-balance-snapshot.service': {},
    '@/lib/beginning-balance-state': load('lib/beginning-balance-state.ts', {}),
  }, { warn: (...args: unknown[]) => warnings.push(args), error: (...args: unknown[]) => errors.push(args) });
  return {
    calls, warnings, errors,
    setMappings(value: Mapping[]) { mappings = value; },
    setStatuses(value: typeof statuses) { statuses = value; },
    unauthenticate() { authenticated = false; }, failMapping() { failure = true; },
    async get(query = '') {
      const response = await route.GET(new Request(`http://localhost/api/customs/beginning-data${query}`));
      return { status: response.status, body: await response.json() };
    },
  };
}

test('adds mapped code while preserving response fields, filters, pagination and tenant scope', async () => {
  const h = harness([balance('kG'), { ...balance('KG', 2), company_code: 9999 }]);
  h.setStatuses([{ id: 1, status: 'TRANSMITTED_TO_INSW' }]);
  const { status, body } = await h.get('?page=2&limit=10&itemType=ROH&itemCode=ITEM&itemName=Material&startDate=2026-01-01&endDate=2026-01-02');
  expect(status).toBe(200);
  expect(body.data).toEqual([{
    id: '1', item: { code: 'ITEM-1', name: 'Material' }, uom: { code: 'kG' },
    beginningBalance: 12.125, beginningDate: '2026-01-01T00:00:00.000Z', remarks: 'fixture',
    ppkek_numbers: ['PP-1'], itemId: 'ITEM-1', uomId: 'kG', itemType: 'ROH',
    status: 'TRANSMITTED_TO_INSW', hasTransactions: false, inswUom: 'KGM', ceisaInswUom: null,
  }]);
  expect(body.overallStatus).toBe('TRANSMITTED_TO_INSW');
  expect(body.pagination).toEqual({ page: 2, limit: 10, total: 23, totalPages: 3, hasNextPage: true, hasPrevPage: true });
  const where = { company_code: 1310, deleted_at: null, item_type: 'ROH',
    OR: [{ item_code: { contains: 'ITEM', mode: 'insensitive' } }, { item_name: { contains: 'Material', mode: 'insensitive' } }],
    balance_date: { gte: new Date('2026-01-01'), lte: new Date('2026-01-02') } };
  expect(h.calls.find(c => c.name === 'balance.count')?.args).toEqual({ where });
  expect(h.calls.find(c => c.name === 'balance.findMany')?.args).toMatchObject({
    where, skip: 10, take: 10, orderBy: [{ balance_date: 'desc' }, { item_code: 'asc' }],
  });
  expect(h.calls.filter(c => c.name === 'mapping.findMany')).toEqual([{
    name: 'mapping.findMany', args: { where: { is_active: true }, select: { wms_uom: true, insw_uom: true } },
  }]);
  expect(h.calls.find(c => c.name === 'balance.groupBy')?.args.where).toEqual({ company_code: 1310, deleted_at: null });
});

test('missing, inactive, deleted and blank targets are non-fatal and never fall back', async () => {
  const h = harness(['MISSING', 'INACTIVE', 'DELETED', 'BLANK', 'EMPTY', 'KG'].map((uom, i) => balance(uom, i + 1)));
  h.setMappings([
    { wms_uom: 'INACTIVE', insw_uom: 'XXX', is_active: false },
    { wms_uom: 'BLANK', insw_uom: ' \t ' }, { wms_uom: 'EMPTY', insw_uom: '' },
    { wms_uom: 'KG', insw_uom: 'KGM' }, { wms_uom: 'kg', insw_uom: 'XXX', is_active: false },
  ]);
  const { status, body } = await h.get();
  expect(status).toBe(200);
  expect(body.data.map((r: any) => r.inswUom)).toEqual([null, null, null, null, null, 'KGM']);
  expect(h.calls.filter(c => c.name === 'mapping.findMany')).toHaveLength(1);
  expect(h.warnings).toEqual([]);
});

test('JS uppercase matches legacy Unicode without trimming; collisions emit one redacted diagnostic', async () => {
  const h = harness(['kg', 'KG', ' Kg ', ' kg', 'straße', 'ı', '__proto__'].map((uom, i) => balance(uom, i + 1)));
  const mappings = [
    { wms_uom: 'kg', insw_uom: 'KGM' }, { wms_uom: 'KG', insw_uom: 'KGM' },
    { wms_uom: ' kg ', insw_uom: 'SPC' }, { wms_uom: 'STRASSE', insw_uom: 'UNI' },
    { wms_uom: 'I', insw_uom: 'LTR' }, { wms_uom: '__PROTO__', insw_uom: 'OBJ' },
    { wms_uom: 'unused', insw_uom: 'A' }, { wms_uom: 'UNUSED', insw_uom: 'B' },
  ];
  for (const order of [mappings, [...mappings].reverse()]) {
    h.setMappings(order);
    const { body } = await h.get();
    expect(body.data.map((r: any) => r.inswUom)).toEqual([null, null, 'SPC', null, 'UNI', 'LTR', 'OBJ']);
    expect(body.data).toHaveLength(7);
  }
  expect(h.warnings).toEqual(Array(2).fill(['[Beginning Balance UoM]', {
    event: 'ambiguous_active_uom_mapping', ambiguousKeyCount: 1,
  }]));
});

test('each fetch reflects changes, deactivation and deletion for OPEN and LOCKED balances', async () => {
  const h = harness([{ ...balance(), ceisa_insw_uom: 'KgM' }, balance('KG', 2)]);
  h.setStatuses([{ id: 1, status: 'OPEN' }, { id: 2, status: 'LOCKED' }]);
  for (const [mappings, expected] of [
    [[{ wms_uom: 'KG', insw_uom: 'KGM' }], 'KGM'],
    [[{ wms_uom: 'KG', insw_uom: 'NEW' }], 'NEW'],
    [[{ wms_uom: 'KG', insw_uom: 'NEW', is_active: false }], null],
    [[], null],
  ] as Array<[Mapping[], string | null]>) {
    h.setMappings(mappings);
    const { body } = await h.get();
    expect(body.data.map((r: any) => r.inswUom)).toEqual([expected, expected]);
    expect(body.data.map((r: any) => r.ceisaInswUom)).toEqual(['KgM', null]);
    expect(body.data.map((r: any) => [r.status, r.beginningBalance, r.uom.code])).toEqual([
      ['OPEN', 12.125, 'KG'], ['LOCKED', 12.125, 'KG'],
    ]);
    expect(body.overallStatus).toBe('LOCKED');
  }
  expect(h.calls.filter(c => c.name === 'mapping.findMany')).toHaveLength(4);
});

test('empty page skips mapping query; unauthenticated requests skip all database access', async () => {
  const h = harness([]);
  expect((await h.get()).body.data).toEqual([]);
  expect(h.calls.filter(c => c.name === 'mapping.findMany')).toEqual([]);
  h.calls.length = 0;
  h.unauthenticate();
  expect(await h.get('?companyCode=9999')).toEqual({ status: 401, body: { error: 'Unauthorized' } });
  expect(h.calls).toEqual([]);
});

test('mapping query failure follows the existing 500 error path', async () => {
  const h = harness();
  h.failMapping();
  expect(await h.get()).toEqual({ status: 500, body: { message: 'Error fetching beginning data' } });
  expect(h.errors).toHaveLength(2);
});

const tableDependencies = Object.fromEntries([
  'react/jsx-runtime', 'react', '@mui/material', '@mui/icons-material',
  '@mui/x-date-pickers/DatePicker', '@mui/x-date-pickers/LocalizationProvider',
  '@mui/x-date-pickers/AdapterDayjs', 'dayjs',
].map(id => [id, require(id)]));
const { BeginningStockTable } = load('app/components/customs/BeginningStockTable.tsx', {
  ...tableDependencies, '@/lib/utils/format': require('../lib/utils/format'),
});

test('table renders saved metadata and neutral missing values independently of mappings in both themes', () => {
  for (const mode of ['light', 'dark'] as const) {
    const data = ['KgM', null, undefined].map((ceisaInswUom, i) => ({
      id: String(i), itemCode: `ITEM-${i}`, itemName: 'Material', uom: 'KG', inswUom: 'MAPPED', ceisaInswUom,
      beginningBalance: 12.125, beginningDate: '2026-01-01', status: 'LOCKED',
    }));
    const render = (rows: typeof data, loading = false) => renderToStaticMarkup(
      React.createElement(ThemeProvider, { theme: createTheme({ palette: { mode } }) },
        React.createElement(BeginningStockTable, { data: rows, loading, onEdit() {}, onDelete() {} })),
    );
    const html = render(data);
    const headers = [...html.matchAll(/<th\b[^>]*>(.*?)<\/th>/g)].map(match => match[1]);
    expect(headers).toHaveLength(11);
    expect(headers.slice(4, 6)).toEqual(['WMS UoM', 'INSW / CEISA UoM']);
    expect(html).toContain('>KgM</td>');
    expect(html).not.toContain('MAPPED');
    expect(html.match(/aria-label="No saved INSW \/ CEISA UoM"/g)).toHaveLength(2);
    expect(html).toContain('overflow-x:auto');
    expect(render([])).toContain('colSpan="11"');
    expect(render([])).toContain('No beginning stock data found');
    expect(render(data, true)).toContain('role="progressbar"');
    expect(render(data, true)).not.toContain('<table');
  }
});


test('company LOCKED status survives empty filtered and paginated pages', async () => {
  const h = harness([]);
  h.setStatuses([{ id: 99, status: 'LOCKED' }]);
  for (const query of ['', '?page=999&itemType=FERT', '?itemCode=missing&startDate=2026-01-01']) {
    const { status, body } = await h.get(query);
    expect(status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.overallStatus).toBe('LOCKED');
  }
});
