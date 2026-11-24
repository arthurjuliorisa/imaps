/** Offline tests: real report/export code, in-memory repositories, no DB/browser/provider. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { jsPDF } from 'jspdf';
import { createRequire } from 'node:module';
import net from 'node:net';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextResponse } from 'next/server';

const require = createRequire(import.meta.url);
const compiled = new Map<string, string>();
const paths = ['incoming', 'outgoing', 'wip', 'raw-material', 'scrap', 'capital-goods', 'production',
  'internal-transaction/incoming', 'internal-transaction/outgoing'];
const date = '2025-01-10';
const mutations = ['raw-material', 'scrap', 'capital-goods', 'production'];
const mappingFixtures = [
  { wms_uom: 'kg', insw_uom: 'KGM' }, { wms_uom: 'box', insw_uom: 'KGM' },
  { wms_uom: 'N/A', insw_uom: 'MUST_NOT_MAP_FALLBACK' },
  { wms_uom: 'pc', insw_uom: 'PCE' }, { wms_uom: 'PC', insw_uom: 'PCE' },
  { wms_uom: 'blank', insw_uom: ' \t' }, { wms_uom: 'μA', insw_uom: ' µ target ' },
  { wms_uom: ' spaced ', insw_uom: ' preserved ' }, { wms_uom: ' ', insw_uom: 'NO' },
  { wms_uom: 'inactive', insw_uom: 'NO', is_active: false },
];
function fixture(unit: unknown = 'kg', index = 0, company = 1370) {
  return { id: index + 1, no: index + 1, company_code: company, company_name: `Company ${company}`,
    company_type: 'SEZ', wms_id: index + 10, item_code: `ITEM-${index}`, item_name: 'Item',
    type_code: 'ROH', item_type: 'ROH', unit, unit_quantity: unit, quantity_in: '1.250', quantity_out: '0.125', quantity: '1.250', qty: '1.250',
    value_amount: '12.375', currency: 'USD', beginning: '2.500', in: '1.250', out: '0.125',
    adjustment: '-0.500', ending: '3.125', stockOpname: '0', variant: '-0.125',
    doc_date: date, reg_date: date, transaction_date: date, stock_date: date, snapshot_date: date,
    customs_document_type: 'BC40', ppkek_number: null, remarks: null, created_at: date,
    shipper_name: null, recipient_name: null, section: null, source_type: 'MU' };
}
function harness(options: { rows?: any[]; role?: string; company?: number; authenticated?: boolean;
  mappings?: any[]; mappingError?: boolean; total?: number; uiRows?: any[]; capturePdf?: boolean; baseline?: boolean } = {}) {
  let mappings = options.mappings ?? mappingFixtures;
  const rows = options.rows ?? [fixture()];
  const calls: { query: string; params: any[] }[] = [];
  const mappingCalls: any[] = [];
  const pdfCalls: any[][] = [];
  const actions: any = {};
  const company = options.company ?? 1370;
  const session = { user: { companyCode: company, role: options.role ?? 'CUSTOMS' } };
  const db = {
    companies: { findUnique: async () => ({ company_type: 'SEZ' }) },
    $queryRawUnsafe: async (query: string, ...params: any[]) => {
      calls.push({ query, params });
      assert.match(query, /SELECT/i);
      assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
      assert.equal(params[0], company, 'all report SQL uses trusted session company');
      return /^\s*SELECT\s+COUNT\(/i.test(query) ? [{ count: options.total ?? rows.length, total: options.total ?? rows.length }]
        : rows.filter(row => row.company_code === company);
    },
    insw_uom_mapping: { findMany: async (args: any) => {
      mappingCalls.push(args);
      assert.deepEqual(JSON.parse(JSON.stringify(args)), {
        where: { is_active: true }, select: { wms_uom: true, insw_uom: true },
      });
      if (options.mappingError) throw new Error('MAPPING_DB_FAILURE');
      return mappings.filter(row => row.is_active !== false);
    } },
  };
  const modules = new Map<string, any>();
  function load(file: string): any {
    const absolute = path.resolve(file);
    if (modules.has(absolute)) return modules.get(absolute);
    const result: any = {};
    modules.set(absolute, result);
    const cacheKey = absolute + (options.baseline ? ":HEAD" : "");
    let code = compiled.get(cacheKey);
    if (!code) {
      const baselineFile = process.env.CUSTOMS_UOM_BASELINE_DIR
        ? path.join(process.env.CUSTOMS_UOM_BASELINE_DIR, path.relative(process.cwd(), absolute)) : undefined;
      if (options.baseline) assert.ok(process.env.CUSTOMS_UOM_BASELINE_DIR, 'Set CUSTOMS_UOM_BASELINE_DIR to a read-only HEAD source snapshot for differential checks');
      const source = readFileSync(options.baseline && baselineFile && existsSync(baselineFile) ? baselineFile : absolute, 'utf8');
      code = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
        jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
      } }).outputText;
      compiled.set(cacheKey, code);
    }
    vm.runInNewContext(code, { exports: result, Buffer, URL, Date, Response, Uint8Array, console: { ...console, error() {}, log() {} }, process,
      require: (name: string) => {
        if (options.capturePdf && name === '@/lib/exportUtils') return { ...load('lib/exportUtils.ts'), exportToPDF: (...args: any[]) => pdfCalls.push(args) };
        if (options.capturePdf && name === '@/app/components/customs/ExportButtons') return { ExportButtons: (props: any) => { Object.assign(actions, props); return null; } };
        if (name === '@/lib/prisma') return { prisma: db };
        if (name === '@/lib/api-auth') return { checkAuth: async () => options.authenticated === false
          ? { authenticated: false, response: NextResponse.json({}, { status: 401 }) }
          : { authenticated: true, session } };
        if (name === 'next/navigation') return { useRouter: () => ({ push() {} }) };
        if (name === 'next-auth/react') return { useSession: () => ({ data: session, status: 'authenticated' }) };
        if (options.uiRows && name === 'react' && absolute.includes('/app/(authenticated)/')) {
          return { ...React, useState: (initial: any) => Array.isArray(initial)
            ? [options.uiRows, () => {}] : React.useState(initial) };
        }
        if (options.uiRows && name === '@/app/components/ToastProvider') return { useToast: () => ({}) };
        if (options.uiRows && name === '@/app/components/customs/ReportLayout') {
          return { ReportLayout: ({ children, actions: pageActions }: any) => React.createElement('div', null, options.capturePdf ? pageActions : null, children) };
        }
        // PDF callback tests need the real page hooks/actions, not a full MUI table tree.
        if (options.capturePdf && name === '@mui/material') {
          const mui = require(name);
          return Object.fromEntries(Object.keys(mui).map(key => [key,
            /^[A-Z]/.test(key) ? ({ children }: any) => React.createElement('div', null, children) : mui[key]]));
        }
        if (options.capturePdf && (name === '@mui/x-data-grid' || name === '@mui/icons-material'
          || name.startsWith('@/app/components/'))) {
          return new Proxy({ __esModule: true }, { get: (_target, key) => key === '__esModule' ? true : () => null });
        }
        if (name.startsWith('@/') || name.startsWith('.')) {
          const base = name.startsWith('@/') ? name.slice(2) : path.resolve(path.dirname(absolute), name);
          const source = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext => base + ext).find(existsSync);
          if (source) return load(source);
        }
        return require(name);
      },
    }, { filename: absolute });
    return result;
  }
  return { load, calls, mappingCalls, pdfCalls, actions, setMappings(value: any[]) { mappings = value; } };
}
function request(report: string, extra = '') {
  return new Request(`http://localhost/api/customs/${report}?startDate=${date}&endDate=${date}&stockDate=${date}&companyCode=9999&role=ADMIN&${extra}`);
}
async function workbook(response: Response) {
  assert.equal(response.status, 200);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(Buffer.from(await response.arrayBuffer()) as any);
  return book.worksheets[0];
}
function headers(sheet: ExcelJS.Worksheet): string[] {
  return (sheet.getRow(1).values as any[]).slice(1);
}

// Any accidental repository or provider connection fails immediately.
const connect = net.Socket.prototype.connect;
const fetch = globalThis.fetch;
net.Socket.prototype.connect = (() => { throw new Error('OFFLINE_TEST_NO_NETWORK'); }) as typeof connect;
globalThis.fetch = async () => { throw new Error('OFFLINE_TEST_NO_NETWORK'); };
test.after(() => { net.Socket.prototype.connect = connect; globalThis.fetch = fetch; });

test('normalization: ambiguity, Unicode uppercase, no trimming, target preservation, blank/missing/inactive', async () => {
  const h = harness();
  const lookup = await h.load('lib/customs/reporting-uom.ts').loadReportingUomLookup([{}]);
  for (const [source, expected] of [
    ['KG', 'KGM'], ['kG', 'KGM'], ['PC', null], ['blank', null], ['missing', null],
    ['inactive', null], ['μa', ' µ target '], ['ΜA', ' µ target '],
    [' kg ', null], [' spaced ', ' preserved '], ['spaced', null],
    [null, null], [undefined, null], ['', null], [' \t\n', null],
  ]) assert.equal(lookup(source), expected, String(source));
  const create = h.load('lib/customs/reporting-uom.ts').createReportingUomLookup;
  for (const targets of [['X', 'X'], ['X', 'Y'], ['X', 'Y', 'Z'], ['', 'Y']]) {
    assert.equal(create(targets.map((target, i) => ({ wms_uom: i ? 'pc' : 'PC', insw_uom: target })))('pc'), null);
  }
  assert.equal(h.mappingCalls.length, 1);
});

for (const report of paths) {
  for (const size of [0, 10, 500]) test(`${report} GET: ${size} rows, bounded query count and unchanged raw units/quantities`, async () => {
    const units = ['kg', 'box', 'PC', 'blank', null, 'missing', ' kg ', 'μa', 'inactive', ''];
    const rows = Array.from({ length: size }, (_, i) => fixture(units[i % units.length], i));
    const h = harness({ rows });
    const get = h.load(`app/api/customs/${report}/route.ts`).GET;
    const response = await get(request(report, `page=1&limit=${size || 10}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.data.length, size);
    assert.equal(body.pagination.total, size);
    assert.equal(h.calls.length, 2);
    assert.equal(h.mappingCalls.length, size ? 1 : 0);
    const expected = ['KGM', 'KGM', null, null, null, null, null, ' µ target ', null, null];
    body.data.forEach((row: any, i: number) => {
      assert.equal(row.inswUom, expected[i % units.length]);
      const raw = report === 'wip' ? row.unitQuantity : row.unit;
      assert.equal(raw, mutations.includes(report) ? units[i % 10] || 'N/A' : units[i % 10]);
      assert.equal(Number(report === 'wip' ? row.quantity : mutations.includes(report) ? row.in : row.qty), 1.25);
      if (mutations.includes(report)) {
        assert.equal(row.adjustment, '-0.500');
        assert.equal(row.ending, '3.125');
      }
    });
    const pageQuery = h.calls.find(call => !/COUNT\(/i.test(call.query))!;
    assert.match(pageQuery.query, /LIMIT[\s\S]*OFFSET/);
    assert.match(pageQuery.query, /ORDER BY/);
  });
  test(`${report} GET: mapping failure remains HTTP 500; auth/company rejection reads no mapping`, async () => {
    const h = harness({ mappingError: true });
    assert.equal((await h.load(`app/api/customs/${report}/route.ts`).GET(request(report))).status, 500);
    const denied = harness({ authenticated: false });
    assert.equal((await denied.load(`app/api/customs/${report}/route.ts`).GET(request(report))).status, 401);
    assert.equal(denied.calls.length + denied.mappingCalls.length, 0);
    const invalid = harness({ company: -1 });
    assert.equal((await invalid.load(`app/api/customs/${report}/route.ts`).GET(request(report))).status, 400);
    assert.equal(invalid.calls.length + invalid.mappingCalls.length, 0);
  });
  test(`${report} GET: current mapping refreshes history without changing rows; shared global code across companies`, async () => {
    for (const company of [1370, 2000]) {
      const h = harness({ company, role: company === 1370 ? 'CUSTOMS' : 'ADMIN', rows: [fixture('kg', 0, company), fixture('box', 1, company), fixture('kg', 2, 9999)] });
      const get = h.load(`app/api/customs/${report}/route.ts`).GET;
      const first = await (await get(request(report))).json();
      assert.deepEqual(first.data.map((row: any) => row.inswUom), ['KGM', 'KGM']);
      h.setMappings([{ wms_uom: 'kg', insw_uom: 'NEW' }]);
      const second = await (await get(request(report))).json();
      assert.deepEqual(second.data.map((row: any) => row.inswUom), ['NEW', null]);
      h.setMappings([{ wms_uom: 'kg', insw_uom: 'NEW', is_active: false }]);
      const third = await (await get(request(report))).json();
      assert.deepEqual(third.data.map((row: any) => row.inswUom), [null, null]);
      const raw = (data: any[]) => data.map(({ inswUom, ...row }) => row);
      assert.deepEqual(raw(first.data), raw(second.data));
      assert.deepEqual(raw(first.data), raw(third.data));
      assert.equal(h.mappingCalls.length, 3);
    }
  });
  for (const role of ['CUSTOMS', 'ADMIN', 'USER']) test(`${report} Excel endpoint: ${role} columns, real null, decimals, full filtered scope`, async () => {
    const rows = [fixture('kg'), fixture('box', 1), fixture('missing', 2)];
    const h = harness({ rows, role });
    const sheet = await workbook(await h.load(`app/api/customs/${report}/export/route.ts`).GET(request(report, 'page=2&limit=1&isCustomsUser=false')));
    const names = headers(sheet);
    const mapped = names.indexOf('UoM CEISA/INSW');
    assert.ok(mapped >= 0);
    const originalLabel = report === 'wip' || mutations.includes(report) ? 'Satuan Barang' : 'UOM';
    assert.equal(names[mapped - 1], originalLabel);
    for (const [index, unit] of ['kg', 'box', 'missing'].entries()) {
      assert.equal(sheet.getRow(index + 2).getCell(mapped).value, unit);
    }
    assert.equal(sheet.rowCount, 4);
    assert.equal(sheet.getRow(2).getCell(mapped + 1).value, 'KGM');
    assert.equal(sheet.getRow(3).getCell(mapped + 1).value, 'KGM');
    assert.equal(sheet.getRow(4).getCell(mapped + 1).value, null);
    assert.equal(sheet.getRow(4).getCell(mapped + 1).type, ExcelJS.ValueType.Null);
    const numeric = names.indexOf(mutations.includes(report) ? 'Penyesuaian' : report === 'wip' ? 'jumlah' : 'Quantity');
    const numberCell = sheet.getRow(2).getCell(numeric + 1);
    assert.equal(numberCell.type, ExcelJS.ValueType.Number);
    assert.equal(numberCell.value, mutations.includes(report) ? -0.5 : 1.25);
    assert.equal(numberCell.numFmt, '#,##0.000');
    const unrelated = names.indexOf(report === 'wip' ? 'catatan' : mutations.includes(report) ? 'Keterangan'
      : report.startsWith('internal') ? 'Section / Source' : 'Nama ' + (report === 'incoming' ? 'Pengirim' : 'Penerima') + ' Barang');
    assert.equal(sheet.getRow(2).getCell(unrelated + 1).value, '-');
    assert.equal(h.calls.length, 2);
    assert.equal(h.mappingCalls.length, 1);
    assert.doesNotMatch(h.calls[1].query, /\bLIMIT\b|\bOFFSET\b/);
  });
  test(`${report} export: empty, rejected, failure and historic request refresh`, async () => {
    const file = `app/api/customs/${report}/export/route.ts`;
    const empty = harness({ rows: [] });
    assert.equal((await workbook(await empty.load(file).GET(request(report)))).rowCount, 1);
    assert.equal(empty.mappingCalls.length, 0);
    const denied = harness({ authenticated: false });
    assert.equal((await denied.load(file).GET(request(report))).status, 401);
    assert.equal(denied.calls.length + denied.mappingCalls.length, 0);
    const tooLarge = harness({ total: 1000001 });
    assert.equal((await tooLarge.load(file).GET(request(report))).status, 413);
    assert.equal(tooLarge.calls.length, 1);
    assert.equal(tooLarge.mappingCalls.length, 0);
    const invalid = harness();
    assert.equal((await invalid.load(file).GET(new Request('http://localhost/?startDate=bad&endDate=bad&stockDate=bad'))).status, 400);
    assert.equal(invalid.calls.length + invalid.mappingCalls.length, 0);
    const failure = harness({ mappingError: true });
    assert.equal((await failure.load(file).GET(request(report))).status, 500);
    const h = harness();
    const get = h.load(file).GET;
    for (const target of ['KGM', 'CHANGED', null]) {
      h.setMappings(target ? [{ wms_uom: 'KG', insw_uom: target }] : []);
      const sheet = await workbook(await get(request(report)));
      assert.equal(sheet.getRow(2).getCell(headers(sheet).indexOf('UoM CEISA/INSW') + 1).value, target);
    }
    assert.equal(h.mappingCalls.length, 3);
  });
}

for (const report of paths) test(`${report} export lookup scaling: 10 and 500 rows`, async () => {
  const capKey = mutations.includes(report) || report === 'wip' ? 'LPJ_MUTASI_MAX_EXPORT_ROWS' : 'TRANSACTION_EXPORT_MAX_ROWS';
  const previousCap = process.env[capKey];
  // Exercise an accepted configured cap without allocating default-cap workbooks.
  process.env[capKey] = '500';
  try {
    for (const size of [10, 500]) {
      const h = harness({ company: 2000, rows: Array.from({ length: size }, (_, i) => fixture('kg', i, 2000)) });
      const response = await h.load(`app/api/customs/${report}/export/route.ts`).GET(request(report));
      assert.equal(response.headers.get('X-Max-Export-Rows'), '500');
      const sheet = await workbook(response);
      assert.equal(sheet.rowCount, size + 1);
      assert.equal(h.calls.length, 2);
      assert.equal(h.mappingCalls.length, 1);
    }
  } finally {
    if (previousCap === undefined) delete process.env[capKey];
    else process.env[capKey] = previousCap;
  }
});

function cells(html: string, tag: string): string[] {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))]
    .map(match => match[1].replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ''));
}
for (const report of paths) for (const role of ['CUSTOMS', 'ADMIN', 'USER']) test(`${report} rendered table: ${role} headers/body, null and empty colspan`, () => {
  for (const companyType of ['BZ', 'SEZ']) for (const empty of [false, true]) for (const mapped of [null, 'MAPPED-ONLY']) {
    const uiRow = { ...fixture(), id: 'row', unit: 'RAW-ONLY', unitQuantity: 'RAW-ONLY', inswUom: mapped,
      companyType, qty: '1.250', companyName: 'Company', itemCode: 'Item', itemName: 'Name',
      itemType: 'ROH', beginning: '1', in: '1', out: '0', adjustment: '0', ending: '2',
      stockOpname: '0', variant: '0', stockDate: date, createdAt: date };
    const h = harness({ role, uiRows: empty ? [] : [uiRow] });
    const Page = h.load(`app/(authenticated)/customs/${report}/page.tsx`).default;
    const html = renderToStaticMarkup(React.createElement(Page));
    const names = cells(html, 'th');
    assert.equal(names.filter(name => name === 'UoM CEISA/INSW').length, 1);
    assert.equal(names[names.indexOf('UoM CEISA/INSW') - 1], 'Satuan Barang');
    if (!empty) {
      const body = cells(html, 'td');
      // Pagination contributes extra cells after the data row.
      assert.equal(body[names.indexOf('UoM CEISA/INSW')], mapped ?? '');
      assert.equal(body.slice(0, names.length).length, names.length);
      assert.equal(body[names.indexOf('Satuan Barang')], 'RAW-ONLY');
    } else {
      const span = html.match(/colSpan="(\d+)"/i);
      assert.equal(Number(span?.[1]), names.length);
    }
  }
});

for (const component of ['MutationReportTable', 'WIPReportTable']) test(`${component}: default caller retains original columns`, () => {
  const h = harness();
  const Table = h.load(`app/components/customs/${component}.tsx`)[component];
  const html = renderToStaticMarkup(React.createElement(Table, {
    data: [], page: 0, rowsPerPage: 10, onPageChange() {}, onRowsPerPageChange() {},
  }));
  const names = cells(html, 'th');
  assert.ok(names.includes('Satuan Barang'));
  assert.ok(!names.includes('UoM CEISA/INSW'));
});

const extraPdfReports = ['stock-count/opname', 'stock-count/adjustment', 'stock-count/sto-control',
  'capital-goods-transactions', 'scrap-transactions'];
const pdfReports = [...paths, ...extraPdfReports, 'dashboard/wip'];
function pdfUiRow(unit: string, mapped: string | null, index: number) {
  return { ...fixture(unit, index), id: `pdf-${index}`, companyName: 'Fixture company',
    companyType: 'SEZ', unit, unitQuantity: unit, uom: unit, inswUom: mapped,
    itemCode: `ITEM-${index}`, itemName: 'Long item name for wrapping across multiple lines',
    itemType: 'ROH', typeCode: 'ROH', qty: '1.250', quantity: 1.25,
    amount: '12.375', valueAmount: 12.375, beginning: '2.500', in: '1.250', out: '0.125',
    adjustment: '-0.500', ending: '3.125', stockDate: date, date, docDate: date, regDate: date,
    activationDate: date, createdAt: date, transactionDate: date, status: 'Confirmed',
    originalBeginningQty: 2.5, adjustedBeginningQty: 2.5, inQty: 1.25, outQty: 0.125,
    originalEndingQty: 3.625, adjustedEndingQty: 3.625, wmsEndingQty: 3.625,
    varianceAdjustedEnding: 0, varianceOriginalEnding: 0, stoCountQty: 3.625,
    adjustmentQty: 0, finalQty: 3.625, systemQty: 3.625, actualQty: 3.625,
    beginningQty: 2.5, incomingQty: 1.25, outgoingQty: 0.125, varianceQty: 0,
    documentType: 'BC40', docType: 'BC40', documentNumber: 'DOC-1', docNumber: 'DOC-1',
    stoWmsId: 'STO-1', internalDocument: 'INTERNAL-1', shipperName: 'Shipper',
    recipientName: 'Recipient', transactionType: 'IN', currency: 'USD' };
}
function capturePdf(report: string, rows: any[], role = 'CUSTOMS', baseline = false) {
  const h = harness({ role, uiRows: rows, capturePdf: true, baseline });
  const pagePath = report === 'dashboard/wip' ? 'app/(authenticated)/dashboard/customs/wip/page.tsx'
    : `app/(authenticated)/customs/${report}/page.tsx`;
  const Page = h.load(pagePath).default;
  renderToStaticMarkup(React.createElement(Page));
  assert.equal(typeof h.actions.onExportPDF, 'function', report);
  h.actions.onExportPDF();
  assert.equal(h.pdfCalls.length, 1);
  assert.equal(h.mappingCalls.length, 0, 'PDF reuses enriched rows without I/O');
  return h.pdfCalls[0];
}
for (const report of pdfReports) for (const role of ['CUSTOMS', 'ADMIN', 'USER']) {
  test(`${report} PDF callback ${role}: adjacent units, blank, unchanged existing cells and scope`, () => {
    const rows = [pdfUiRow('kg', 'KGM', 0), pdfUiRow('box', 'KGM', 1), pdfUiRow('missing', null, 2)];
    const [data, columns, ...meta] = capturePdf(report, rows, role);
    const [oldData, oldColumns, ...oldMeta] = capturePdf(report, rows, role, Boolean(process.env.CUSTOMS_UOM_BASELINE_DIR));
    const mappedIndex = columns.findIndex((column: any) => column.dataKey === 'inswUom');
    assert.ok(mappedIndex > 0);
    assert.equal(columns[mappedIndex].header, 'UoM CEISA/INSW');
    const rawKey = columns[mappedIndex - 1].dataKey;
    assert.ok(['unit', 'uom'].includes(rawKey));
    assert.equal(data.length, oldData.length);
    assert.equal(data.length, 3);
    assert.deepEqual(JSON.parse(JSON.stringify(meta)), JSON.parse(JSON.stringify(oldMeta)));
    data.forEach((row: any, i: number) => {
      assert.equal(row[rawKey], rows[i].unit);
      assert.equal(row.inswUom, rows[i].inswUom);
      // Every preexisting PDF cell, including all amounts and document fields.
      oldColumns.forEach((column: any) => assert.equal(row[column.dataKey], oldData[i][column.dataKey]));
    });
    assert.deepEqual(JSON.parse(JSON.stringify(columns.filter((col: any) => oldColumns.some((old: any) => old.dataKey === col.dataKey)))), JSON.parse(JSON.stringify(oldColumns)));
  });
}
for (const report of extraPdfReports) {
  test(`${report} PDF source: global mapping refresh, exact baseline rows/SQL, role/company scope and bounded reads`, async () => {
    for (const role of ['CUSTOMS', 'ADMIN', 'USER']) for (const company of [1370, 2000]) {
      const rows = ['kg', 'box', 'PC', 'blank', 'missing', 'inactive', '', ' kg ']
        .map((unit, i) => ({ ...fixture(unit, i, company), uom: unit, activation_date: date }));
      const h = harness({ rows, role, company });
      const old = harness({ rows, role, company, baseline: Boolean(process.env.CUSTOMS_UOM_BASELINE_DIR) });
      const file = `app/api/customs/${report}/route.ts`;
      const get = h.load(file).GET;
      const response = await get(request(report));
      assert.equal(response.status, 200);
      const body = await response.json();
      const oldBody = await (await old.load(file).GET(request(report))).json();
      const data = Array.isArray(body) ? body : body.data;
      const oldData = Array.isArray(oldBody) ? oldBody : oldBody.data;
      assert.equal(data.length, rows.length);
      assert.deepEqual(data.map((row: any) => row.inswUom), ['KGM', 'KGM', null, null, null, null, null, null]);
      const unmapped = data.map(({ inswUom, ...row }: any) => row);
      const oldUnmapped = oldData.map(({ inswUom, ...row }: any) => row);
      assert.deepEqual(unmapped, oldUnmapped);
      assert.deepEqual(h.calls, old.calls, 'source SQL, filters, sort and pagination unchanged');
      assert.equal(h.mappingCalls.length, 1);
      h.setMappings([{ wms_uom: 'kg', insw_uom: 'CURRENT' }]);
      const refreshedBody = await (await get(request(report))).json();
      const refreshed = Array.isArray(refreshedBody) ? refreshedBody : refreshedBody.data;
      assert.equal(refreshed[0].inswUom, 'CURRENT');
      assert.deepEqual(refreshed.map(({ inswUom, ...row }: any) => row), oldUnmapped);
      assert.equal(h.mappingCalls.length, 2);
    }
    for (const size of [0, 500]) {
      const rows = Array.from({ length: size }, (_, i) => ({ ...fixture('kg', i), uom: 'kg', activation_date: date }));
      const h = harness({ rows });
      assert.equal((await h.load(`app/api/customs/${report}/route.ts`).GET(request(report))).status, 200);
      assert.equal(h.mappingCalls.length, size ? 1 : 0);
    }
    for (const options of [{ authenticated: false }, { company: -1 }]) {
      const h = harness(options);
      assert.ok((await h.load(`app/api/customs/${report}/route.ts`).GET(request(report))).status >= 400);
      assert.equal(h.calls.length + h.mappingCalls.length, 0);
    }
    const failure = harness({ mappingError: true, rows: [{ ...fixture(), activation_date: date }] });
    assert.equal((await failure.load(`app/api/customs/${report}/route.ts`).GET(request(report))).status, 500);
  });
}
test('STO dates-only request never reads mappings', async () => {
  const h = harness({ rows: [{ ...fixture(), activation_date: date }] });
  assert.equal((await h.load('app/api/customs/stock-count/sto-control/route.ts').GET(request('stock-count/sto-control', 'type=dates'))).status, 200);
  assert.equal(h.mappingCalls.length, 0);
});

for (const report of pdfReports) test(`${report} real jsPDF: multi-page repeated headers, mapped blanks, bounded cells`, () => {
  const rows = Array.from({ length: 150 }, (_, i) => pdfUiRow(i % 2 ? 'missing' : 'kg', i % 2 ? null : 'KGM', i));
  const [data, columns, fileName, title, subtitle] = capturePdf(report, rows);
  const rawIndex = columns.findIndex((col: any) => col.dataKey === 'inswUom') - 1;
  data[2][columns[rawIndex].dataKey] = 'Original-WMS-unit-with-a-long-value';
  data[2].inswUom = 'CEISA-target-with-a-long-value';
  // Invoke the real shared renderer and real AutoTable, replacing only the download sink.
  let saved: any;
  let table: any;
  const h = harness();
  const originalSave = (jsPDF.API as any).save;
  (jsPDF.API as any).save = function(this: any) { saved = this; return this; };
  try {
    h.load('lib/exportUtils.ts').exportToPDF(data, columns, fileName, title, subtitle);
    assert.ok(saved);
    table = saved.lastAutoTable;
    assert.ok(saved.getNumberOfPages() > 1);
    assert.equal(saved.internal.pageSize.getWidth() > saved.internal.pageSize.getHeight(),
      columns.filter((col: any) => col.dataKey !== 'inswUom').length > 6, 'existing orientation retained');
    assert.equal(table.body.length, rows.length);
    const unitIndex = columns.findIndex((col: any) => col.dataKey === 'inswUom');
    assert.equal(table.head[0].cells[unitIndex].raw, 'UoM CEISA/INSW');
    assert.equal(table.body[0].cells[unitIndex - 1].raw, 'kg');
    assert.equal(table.body[0].cells[unitIndex].raw, 'KGM');
    assert.equal(table.body[1].cells[unitIndex].raw, '');
    assert.equal(table.body[2].cells[unitIndex - 1].raw, data[2][columns[rawIndex].dataKey]);
    assert.equal(table.body[2].cells[unitIndex].raw, data[2].inswUom);
    for (const index of [unitIndex - 1, unitIndex]) {
      const cell = table.body[2].cells[index];
      saved.setFont(cell.styles.font, cell.styles.fontStyle);
      saved.setFontSize(cell.styles.fontSize);
      const availableWidth = cell.width - cell.padding('left') - cell.padding('right');
      for (const line of cell.text) assert.ok(saved.getTextWidth(line) <= availableWidth + 0.5,
        'long unit text fits or wraps within its own cell');
    }
    for (const row of table.body) for (const cell of Object.values(row.cells) as any[]) {
      assert.ok(cell.x >= 0 && cell.x + cell.width <= saved.internal.pageSize.getWidth() + 0.1, `${report} cell x=${cell.x} width=${cell.width}`);
      assert.ok(cell.y >= 0 && cell.y + cell.height <= saved.internal.pageSize.getHeight() + 0.1);
    }
    const bytes = saved.output('arraybuffer');
    assert.ok(bytes.byteLength > 10000);
    // Uncompressed jsPDF content retains ASCII text; headers repeat on each page.
    const text = Buffer.from(bytes).toString('latin1');
    assert.ok(text.includes(title));
    assert.ok(text.includes('Generated:'));
    assert.ok((text.match(/CEISA\/INSW/g) ?? []).length >= saved.getNumberOfPages());
  } finally {
    (jsPDF.API as any).save = originalSave;
  }
});
