// Fully mocked route integration: no database client or connection is created.
require('tsx/cjs');
const assert = require('node:assert/strict');
const Module = require('node:module');
const originalLoad = Module._load;
const ExcelJS = require('exceljs');
const { normalizeBeginningBalanceItemCode } = require('../../lib/beginning-balance-upload-validation.ts');
const sqlError = 'isolated SQL error detail' + 'x'.repeat(1000);
let mode = 'success';
let lookupCalls = [];
let committed;
let batchSizes;
let insertBatchSizes;
let staged;
const key = (row) => JSON.stringify([row.company_code, row.item_type, row.item_code, row.uom, row.snapshot_date.toISOString()]);
const prisma = {
  item_types: { findMany: async () => [{ item_type_code: 'ROH' }] },
  beginning_balances: { findMany: async (args) => { lookupCalls.push(args); return []; } },
  incoming_good_items: { findMany: async (args) => { lookupCalls.push(args); return []; } },
  outgoing_good_items: { findMany: async (args) => { lookupCalls.push(args); return []; } },
  $transaction: async (callback) => {
    insertBatchSizes = [];
    staged = { bb: [], ppkek: [], snapshots: new Map() };
    const tx = {
      beginning_balances: {
        groupBy: async ({ where }) => { assert.deepEqual(where, { company_code: 1310, deleted_at: null }); return []; },
        createMany: async ({ data }) => { insertBatchSizes.push(data.length); staged.bb.push(...data); },
        findMany: async () => staged.bb.map((r, i) => ({ ...r, id: i + 1 })),
      },
      beginning_balance_ppkeks: { createMany: async ({ data }) => { staged.ppkek.push(...data); } },
      $queryRawUnsafe: async (_sql, company, json, date) => {
        assert.equal(company, 1310);
        if (_sql.includes('pg_advisory_xact_lock')) return [{ locked: 1 }];
        const rows = JSON.parse(json);
        batchSizes.push(rows.length);
        return rows.map((r) => {
          const snapshot = { ...r, company_code: company, snapshot_date: date };
          if (mode !== 'error' && !(mode === 'missing' && r.item_code === '000000')) staged.snapshots.set(key(snapshot), snapshot);
          return { item_code: r.item_code, status: mode === 'error' ? 'ERROR' : 'SUCCESS', message: mode === 'error' ? sqlError : 'ok' };
        });
      },
      stock_daily_snapshot: { findMany: async ({ where }) => {
        assert.equal(where.company_code, 1310);
        return [...staged.snapshots.values()].filter(r => r.snapshot_date.getTime() === where.snapshot_date.getTime()
          && where.OR.some(i => i.item_type === r.item_type && i.item_code === r.item_code && i.uom === r.uom));
      } },
    };
    await callback(tx);
    committed = staged;
  },
};
Module._load = function(request, parent, isMain) {
  if (request === '@/lib/prisma') return { prisma };
  if (request === '@/lib/api-auth') return { checkAuth: async () => ({ authenticated: true, session: { user: { companyCode: '1310' } } }) };
  if (request === '@/lib/log-activity') return { logActivity: async () => {} };
  return originalLoad.apply(this, arguments);
};
const { POST: preview } = require('../../app/api/customs/beginning-data/validate/route.ts');
const { POST: importRows } = require('../../app/api/customs/beginning-data/import/route.ts');
const request = records => new Request('http://localhost/test', { method: 'POST', body: JSON.stringify({ records }) });
const fixture = (n) => Array.from({ length: n }, (_, i) => ({ itemType: 'ROH', itemCode: String(i).padStart(6, '0'), itemName: 'Material  A', uom: 'KG', qty: 1, balanceDate: '01/01/2026', ppkekNumbers: ['000123'] }));
(async () => {
  for (const value of [12, false, {}, [], { formula: '1', result: 'KgM' }, { richText: [] },
    { text: 'KgM', hyperlink: 'https://example.com' }, { error: '#N/A' }, 'a'.repeat(21)]) {
    lookupCalls = [];
    for (const route of [preview, importRows]) {
      const response = await route(request([{ ...fixture(1)[0], ceisaInswUom: value }]));
      assert.equal(response.status, 400);
      assert.deepEqual((await response.json()).errors.map(e => [e.row, e.field]), [[3, 'ceisaInswUom']]);
    }
    assert.equal(lookupCalls.length, 0, 'invalid metadata fails before lookups or transaction');
  }
  for (const value of [undefined, null, '', '   ', ' KgM ', '001', '😀'.repeat(20), '\tKgM\n', 'A\tB', 'KgM\u007f']) {
    batchSizes = []; committed = undefined;
    assert.equal((await preview(request([{ ...fixture(1)[0], ceisaInswUom: value }]))).status, 200);
    assert.equal((await importRows(request([{ ...fixture(1)[0], ceisaInswUom: value }]))).status, 200);
    assert.equal(committed.bb[0].ceisa_insw_uom, typeof value === 'string' ? value.trim() || null : null);
    assert.equal(committed.bb[0].uom, 'KG');
    assert.ok([...committed.snapshots.values()].every(r => !('ceisa_insw_uom' in r) && !('ceisaInswUom' in r)));
  }
  for (const field of ['itemCode', 'itemName', 'itemType', 'uom']) {
    const invalids = field === 'itemCode'
      ? [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, 1e21, 0, null, true, { richText: [] }, { formula: '1', result: 1 }, { error: '#N/A' }]
      : [123, null, true, { richText: [] }];
    for (const invalid of invalids) {
      const row = { ...fixture(1)[0], [field]: invalid };
      for (const route of [preview, importRows]) {
        const response = await route(request([row]));
        assert.equal(response.status, 400);
        const error = (await response.json()).errors[0];
        assert.equal(error.row, 3);
        assert.equal(error.field, { itemCode: 'Item Code', itemName: 'Item Name', itemType: 'Item Type', uom: 'UOM' }[field]);
      }
    }
  }
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Numeric codes');
  const sourceCodes = [512256502000, 510000000010, '512256502000', '000510000012', ' Ab  C ', '0', Number.MAX_SAFE_INTEGER];
  sheet.addRow(sourceCodes);
  sheet.getCell('B1').numFmt = '000000000000000';
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  // Compare raw numeric API inputs and the normalized preview payload independently.
  for (const normalizedPayload of [false, true]) {
    const rows = sourceCodes.map((_, i) => ({ ...fixture(1)[0],
      itemCode: loaded.worksheets[0].getCell(1, i + 1).value,
      uom: i === 2 ? 'PCS' : 'KG',
    }));
    const expectedCodes = ['512256502000', '510000000010', '512256502000', '000510000012', 'Ab  C', '0', '9007199254740991'];
    if (normalizedPayload) rows.forEach(r => { r.itemCode = normalizeBeginningBalanceItemCode(r.itemCode); });
    lookupCalls = []; batchSizes = []; committed = undefined;
    const previewResult = await preview(request(rows));
    assert.equal(previewResult.status, 200);
    const results = (await previewResult.json()).validationResults;
    expectedCodes.forEach((code, i) => assert.equal(results[`${code}|${rows[i].uom}|Material  A|ROH`].valid, true));
    assert.equal((await importRows(request(rows))).status, 200);
    assert.deepEqual(committed.bb.map(r => r.item_code), expectedCodes);
    assert.deepEqual([...committed.snapshots.values()].map(r => r.item_code), expectedCodes);
    assert.equal(lookupCalls.length, 6, 'three batch lookups per endpoint, never per row');
    for (const query of lookupCalls) assert.deepEqual(query.where.item_code.in, [...new Set(expectedCodes)]);
    assert.equal(committed.ppkek.length, rows.length);
  }
  for (const rows of [
    [{ itemCode: 512256502000 }, { itemCode: '512256502000' }],
    [{ itemCode: '000510000012' }, { itemCode: '000510000012', itemName: 'Different' }],
  ]) {
    const records = rows.map(r => ({ ...fixture(1)[0], ...r }));
    const response = await preview(request(records));
    assert.equal(response.status, 200);
    assert.ok(Object.values((await response.json()).validationResults).every(r => !r.valid));
    assert.equal((await importRows(request(records))).status, 400);
  }
  for (const row of [{ qty: '1oops' }, { qty: true }, { qty: 'Infinity' }, { balanceDate: '02/30/2026' }, { balanceDate: 46023 }]) {
    for (const route of [preview, importRows]) assert.equal((await route(request([{ ...fixture(1)[0], ...row }]))).status, 400);
  }
  const previewResponse = await preview(request(fixture(1)));
  assert.equal(previewResponse.status, 200);
  assert.equal((await previewResponse.json()).validationResults['000000|KG|Material  A|ROH'].valid, true);
  for (const n of [1000, 5000, 5004, 12000]) {
    mode = 'success'; committed = undefined; batchSizes = [];
    const rows = fixture(n).map(r => ({ ...r, ceisaInswUom: ' KgM ' }));
    lookupCalls = [];
    // Same item code with distinct UOM is a separate identity.
    rows[1].itemCode = rows[0].itemCode; rows[1].uom = 'PCS';
    const response = await importRows(request(rows));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).successCount, n);
    assert.deepEqual(batchSizes, Array.from({ length: Math.ceil(n / 1000) }, (_, i) => Math.min(1000, n - i * 1000)));
    assert.deepEqual(insertBatchSizes, batchSizes);
    assert.equal(lookupCalls.length, 3, 'batch validation lookup count is independent of row count');
    assert.ok(committed.bb.every(r => r.ceisa_insw_uom === 'KgM'));
    assert.ok([...committed.snapshots.values()].every(r => !('ceisa_insw_uom' in r) && !('ceisaInswUom' in r)));
    assert.equal(committed.bb.length, n);
    assert.equal(committed.ppkek.length, n);
    assert.equal(committed.snapshots.size, n);
    assert.equal(committed.bb[0].item_code, '000000');
    assert.equal(committed.bb[0].item_name, 'Material  A');
    assert.equal(committed.ppkek[0].ppkek_number, '000123');
  }
  assert.equal((await importRows(request(fixture(12001)))).status, 400);
  const logs = [];
  const log = console.error;
  console.error = (...args) => logs.push(args);
  try {
    for (const failure of ['error', 'missing']) {
      mode = failure; committed = undefined; batchSizes = [];
      const response = await importRows(request(fixture(1000).map(r => ({ ...r, ceisaInswUom: 'KgM' }))));
      assert.equal(response.status, 500);
      const body = await response.json();
      assert.equal(body.successCount, 0);
      assert.equal(body.errorCount, failure === 'error' ? 1000 : 1);
      assert.ok(body.errors.length <= 5);
      assert.ok(!JSON.stringify(body).includes('isolated SQL error detail'));
      assert.equal(committed, undefined, 'BB, PPKEK and snapshots must not commit');
    }
    // Server logging contract: bounded preformatted JSON, never sent to HTTP clients.
    const diagnostics = logs.filter(entry => entry[0] === '[API Error] Required beginning balance snapshots failed:')
      .map(entry => JSON.parse(entry[1]));
    const diagnostic = diagnostics.find(entry => entry.diagnostics);
    assert.ok(diagnostic, 'SQL failure diagnostics must be present in server logs');
    assert.equal(diagnostic.diagnostics.errors, 1000);
    assert.equal(diagnostic.diagnostics.sample.length, 5);
    assert.equal(diagnostic.diagnostics.sample[0].message, sqlError.slice(0, 500));
    assert.equal(diagnostic.failedSample.length, 5);
    assert.ok(diagnostic.diagnostics.sample.every(entry => entry.message.length <= 500));
    assert.equal(diagnostics.length, 2, 'one bounded log per failed import');
  } finally { console.error = log; }
  console.log('Mocked preview/import: invalid types, dates, quantities; 1000/5000/5004/12000 metadata success; SQL/verification rollback passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
