import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as ts from 'typescript';
import * as nextServer from 'next/server';
import ExcelJS from 'exceljs';
import React from 'react';
import { createTheme } from '@mui/material/styles';
import * as validation from '../lib/beginning-balance-upload-validation';
import * as constants from '../lib/constants/beginning-balance-upload';

// Execute actual modules with isolated dependencies. No DB connection, server or browser.
function load(file: string, dependencies: Record<string, unknown>): any {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function('require', 'exports', source)((id: string) => {
    if (!(id in dependencies)) throw new Error(`Unexpected dependency: ${id}`);
    return dependencies[id];
  }, exports);
  return exports;
}
const base = { itemType: 'ROH', itemCode: '001', itemName: 'Material', uom: 'KG', qty: 1, balanceDate: '01/01/2026' };
const headers = ['Item Type', 'Item Code', 'Item Name', 'UOM', 'Qty', 'Balance Date', 'PPKEK Numbers', 'Remarks'];
const auth = { checkAuth: async () => ({ authenticated: true, session: { user: { companyCode: '1310' } } }) };

test('optional text follows remarks normalization and type errors with the database length bound', () => {
  for (const value of [undefined, null, '', '   ', '\u00a0']) expect((validation.normalizeBeginningBalanceText(value) || null)).toBeNull();
  for (const value of [' KgM ', ' 001 ', ' A  B-/ ', 'a'.repeat(20), '😀'.repeat(20), 'é'.repeat(20), '\tKgM\n', 'A\tB', '\u007f']) {
    expect((validation.normalizeBeginningBalanceText(value) || null)).toBe(value.trim());
    expect(validation.validateBeginningBalanceUploadRecord({ ...base, ceisaInswUom: value })).toEqual([]);
  }
  for (const value of [12, false, new Date(), [], {}, { formula: '1', result: 'KgM' }, { richText: [] },
    { text: 'KgM', hyperlink: 'https://example.com' }, { error: '#N/A' }, '😀'.repeat(21), 'a'.repeat(21)]) {
    expect(validation.beginningBalanceUploadErrors([base, { ...base, ceisaInswUom: value }])).toEqual([
      expect.objectContaining({ row: 4, field: 'ceisaInswUom' }),
    ]);
    expect(validation.validateBeginningBalanceUploadRecord({ ...base, ceisaInswUom: value }, false)).toHaveLength(1);
  }
});

test('template preserves sheets, eight columns, sample rows and quantity style; appends Text column I', async () => {
  const route = load('app/api/customs/beginning-data/template/route.ts', {
    'next/server': nextServer, '@/lib/api-auth': auth, exceljs: ExcelJS,
    '@/lib/constants/beginning-balance-upload': constants,
  });
  const response = await route.GET();
  expect(response.status).toBe(200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(await response.arrayBuffer());
  expect(book.worksheets.map(s => s.name)).toEqual(['Beginning Data Template', 'Instructions']);
  const sheet = book.worksheets[0];
  expect((sheet.getRow(1).values as unknown[]).slice(1)).toEqual([...headers, 'UOM CEISA/INSW']);
  expect(sheet.getCell('I2').value).toContain('Optional');
  expect(sheet.getCell('I3').value).toBe('KgM');
  expect(sheet.getCell('D3').value).toBe('KG');
  expect(sheet.getCell('E3').value).toBe(100);
  expect(sheet.getCell('E3').numFmt).toBe('0.00');
  expect(sheet.getColumn(9).numFmt).toBe('@');
  expect(sheet.getCell('I3').numFmt).toBe('@');
  expect(sheet.getCell('I500').numFmt).toBe('@');
  const instructions = JSON.stringify(book.worksheets[1].getSheetValues());
  expect(instructions).toContain('legacy eight-column');
  expect(instructions).toContain('All fields except Remarks are REQUIRED');
  expect(instructions).toContain('4. Make sure the Item Code exists in your Beginning Balances master data');
  expect(instructions).not.toContain('PPKEK Numbers (OPTIONAL)');
  expect(instructions).toContain('SCRAP-001');
});

function hookHarness(initial: Record<number, unknown> = {}) {
  let index = 0;
  const states: unknown[] = [];
  return {
    states,
    react: { ...React, useEffect() {}, useCallback: (fn: unknown) => fn,
      useRef: () => ({ current: null }),
      useState: (value: unknown) => {
        const id = index++;
        states[id] = id in initial ? initial[id] : value;
        return [states[id], (next: unknown) => { states[id] = next; }];
      },
    },
  };
}
function elements(node: any): any[] {
  if (!node || typeof node !== 'object') return [];
  if (Array.isArray(node)) return node.flatMap(elements);
  return [node, ...elements(node.props?.children)];
}
const ui = { ...require('@mui/material'), useTheme: () => createTheme() };
const uiDependencies = {
  'react/jsx-runtime': require('react/jsx-runtime'), '@mui/material': ui,
  '@mui/icons-material': require('@mui/icons-material'), exceljs: ExcelJS,
  '@/lib/beginning-balance-upload-validation': validation,
  '@/lib/constants/beginning-balance-upload': constants,
  '@/lib/utils/format': require('../lib/utils/format'),
  '../ToastProvider': { useToast: () => ({ success() {}, error() {} }) },
};

async function parseUpload(value: any, customHeaders = [...headers, 'UOM CEISA/INSW'], gap = false) {
  const hook = hookHarness({ 6: ['ROH'] });
  const { BeginningStockImport } = load('app/components/customs/BeginningStockImport.tsx', {
    ...uiDependencies, react: hook.react,
  });
  const tree = BeginningStockImport({ open: true, onClose() {}, onSubmit() {} });
  const input = elements(tree).find(node => node.type === 'input');
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Beginning Data Template');
  sheet.addRow(customHeaders);
  sheet.addRow(['hints']);
  sheet.getRow(gap ? 7 : 3).values = ['ROH', '001', 'Material', 'KG', 1, '01/01/2026', '', '', value];
  const buffer = await book.xlsx.writeBuffer();
  const payloads: any[] = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, init) => {
    payloads.push(JSON.parse(init!.body as string));
    return new Response(JSON.stringify({ validationResults: {} }));
  };
  try {
    await input.props.onChange({ target: { files: [{ name: 'test.xlsx', arrayBuffer: async () => buffer }] } });
  } finally { global.fetch = originalFetch; }
  return { records: hook.states[4] as any[], error: hook.states[5], payloads };
}

test('actual Excel UI parser passes normalized metadata to preview and retains legacy nulls', async () => {
  for (const [value, expected, columns] of [
    [' KgM ', 'KgM', [...headers, 'UOM CEISA/INSW']],
    ['001', '001', [...headers, 'UOM CEISA/INSW']],
    ['\tKgM\n', 'KgM', [...headers, 'UOM CEISA/INSW']],
    ['A\tB', 'A\tB', [...headers, 'UOM CEISA/INSW']],
    [null, null, headers], ['  ', null, [...headers, 'UOM CEISA/INSW']],
  ] as const) {
    const result = await parseUpload(value, [...columns]);
    expect(result.error).toBeNull();
    expect(result.records[0]).toMatchObject({ isValid: true, uom: 'KG', ceisaInswUom: expected });
    expect(result.payloads[0].records[0].ceisaInswUom).toBe(expected);
  }
});

test('actual Excel UI retains existing optional-text errors and rejects overlong metadata', async () => {
  for (const value of [12, false, new Date(), { formula: '1', result: 'KgM' }, { richText: [{ text: 'KgM' }] },
    { text: 'KgM', hyperlink: 'https://example.com' }, { error: '#N/A' }, 'a'.repeat(21)]) {
    const result = await parseUpload(value, undefined, true);
    expect(result.records[0].isValid).toBe(false);
    expect(result.records[0].errors.join()).toContain('ceisaInswUom must be');
    expect(result.payloads[0].records).toEqual([]);
  }
});

test('actual page submit and list projection retain independent metadata', async () => {
  const hooks = hookHarness();
  const Import = () => null;
  const dependencies = {
    ...uiDependencies, react: hooks.react, 'next-auth/react': { useSession: () => ({ data: null }) },
    '@/app/components/customs/ReportLayout': { ReportLayout: 'layout' },
    '@/app/components/customs/BeginningStockTable': { BeginningStockTable: 'table' },
    '@/app/components/customs/BeginningStockForm': { BeginningStockForm: 'form' },
    '@/app/components/customs/BeginningStockImport': { BeginningStockImport: Import },
    '@/app/components/ConfirmDialog': { ConfirmDialog: 'confirm' },
    '@/app/components/ToastProvider': { useToast: () => ({ success() {}, error() {} }) },
    dayjs: require('dayjs'),
  };
  const Page = load('app/(authenticated)/customs/beginning-data/page.tsx', dependencies).default;
  const tree = Page();
  const importDialog = elements(tree).find(node => node.type === Import);
  const payloads: any[] = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    if (String(url).endsWith('/import')) {
      payloads.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ message: 'ok' }));
    }
    return new Response(JSON.stringify({ data: [{ id: '1', item: { code: '001', name: 'Material' },
      uom: { code: 'KG' }, inswUom: 'MAPPED', ceisaInswUom: 'KgM' }] }));
  };
  try { await importDialog.props.onSubmit([{ ...base, ceisaInswUom: 'KgM', ppkekNumbers: [] }]); }
  finally { global.fetch = originalFetch; }
  expect(payloads[0].records[0].ceisaInswUom).toBe('KgM');
  expect(hooks.states[0]).toEqual([expect.objectContaining({ ceisaInswUom: 'KgM', inswUom: 'MAPPED', uom: 'KG' })]);
});

test('master GET/POST select every prior field and exclude metadata from outward responses', async () => {
  const stored: any = { id: 1, company_code: 1310, item_code: '001', item_name: 'Material', item_type: 'ROH',
    uom: 'KG', qty: 1, balance_date: new Date('2026-01-01'), remarks: null, status: 'OPEN',
    created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-01'), deleted_at: null,
    ceisa_insw_uom: 'SECRET', ppkeks: [{ ppkek_number: '001' }] };
  const selects: any[] = [];
  const project = ({ select }: any) => {
    selects.push(select);
    return Object.fromEntries(Object.keys(select).map(key => [key, stored[key]]));
  };
  const route = load('app/api/master/beginning-balances/route.ts', {
    'next/server': nextServer, 'next-auth': { getServerSession: async () => ({ user: { id: '1' } }) },
    '@/lib/auth': { authOptions: {} }, '@/lib/log-activity': { logActivity: async () => {} },
    '@/lib/prisma': { prisma: { beginning_balances: {
      count: async () => 1, findMany: async (args: any) => [project(args)],
      findFirst: async () => null, aggregate: async () => ({ _max: { id: 0 } }),
      create: async (args: any) => { expect(args.data).not.toHaveProperty('ceisa_insw_uom'); return project(args); },
    } } },
  });
  const get = await route.GET(new Request('http://localhost/api/master/beginning-balances'));
  const getRow = (await get.json()).data.data[0];
  const priorKeys = Object.keys(stored).filter(key => key !== 'ceisa_insw_uom').sort();
  expect(Object.keys(getRow).sort()).toEqual(priorKeys);
  const post = await route.POST(new Request('http://localhost', { method: 'POST', body: JSON.stringify(stored) }));
  expect(post.status).toBe(201);
  const postRow = (await post.json()).data;
  expect(Object.keys(postRow).sort()).toEqual([...priorKeys, 'ppkek_numbers'].sort());
  expect(postRow.ppkek_numbers).toEqual(['001']);
  expect(selects).toHaveLength(2);
  expect(JSON.stringify([getRow, postRow])).not.toContain('SECRET');
});

test('legacy manual PUT retains stored metadata and per-ID output remains unchanged', async () => {
  let stored: any = { id: 1, company_code: 1310, item_type: 'ROH', item_code: '001', item_name: 'Material',
    uom: 'KG', qty: 1, balance_date: new Date('2026-01-01'), ceisa_insw_uom: 'KgM', ppkeks: [] };
  const utils = require('../lib/api-utils');
  const route = load('app/api/customs/beginning-data/[id]/route.ts', {
    'next/server': nextServer, '@/lib/api-auth': auth, '@/lib/api-utils': utils,
    '@/lib/log-activity': { logActivity: async () => {} },
    '@/lib/prisma': { prisma: {
      beginning_balances: { findUnique: async () => stored, update: async ({ data }: any) => {
        expect(data).not.toHaveProperty('ceisa_insw_uom');
        stored = { ...stored, ...data }; return stored;
      } }, item_types: { findUnique: async () => ({ item_type_code: 'ROH' }) },
    } },
  });
  const response = await route.PUT(new Request('http://localhost', { method: 'PUT',
    body: JSON.stringify({ ...base, itemName: 'Edited' }) }), { params: Promise.resolve({ id: '1' }) });
  expect(response.status).toBe(200);
  expect(stored.ceisa_insw_uom).toBe('KgM');
  const body = await response.json();
  expect(body).not.toHaveProperty('ceisaInswUom');
  expect(body).not.toHaveProperty('ceisa_insw_uom');
});

test('actual INSW conversion payload is identical across metadata values; stock mapping and fallback retained', async () => {
  let metadata: string | null = null;
  let mapped = true;
  const repository = { getBeginningBalances: async () => [{
    id: 1, company_code: 1310, item_type: 'ROH', item_code: '001', item_name: 'Material',
    uom: 'KG', qty: 1, balance_date: new Date('2026-01-01'), ceisa_insw_uom: metadata,
  }] };
  const { INSWIntegrationService } = load('lib/services/insw-integration.service.ts', {
    'date-fns': require('date-fns'), '@/lib/utils/logger': { logger: { child: () => ({}) } },
    '@/lib/prisma': { prisma: { insw_uom_mapping: { findMany: async () => mapped ? [{ wms_uom: 'KG', insw_uom: 'KGM' }] : [] } } },
    '@/lib/types/insw-api.types': require('../lib/types/insw-api.types'),
    '@/lib/repositories/insw-integration.repository': { INSWIntegrationRepository: class { getBeginningBalances = repository.getBeginningBalances; } },
  });
  const service = new INSWIntegrationService('fixture', 'fixture');
  for (const useMapping of [true, false]) {
    mapped = useMapping;
    const payloads: unknown[] = [];
    for (const value of [null, 'KgM', '001', 'OTHER']) {
      metadata = value;
      const payload = await service.convertSaldoAwalToINSW(1310, new Date('2026-01-01'));
      expect(payload.data.barangSaldo[0].satuan).toBe(mapped ? 'KGM' : 'KG');
      expect(JSON.stringify(payload)).not.toContain('ceisa');
      payloads.push(payload);
    }
    expect(payloads.every(payload => JSON.stringify(payload) === JSON.stringify(payloads[0]))).toBe(true);
  }
});
