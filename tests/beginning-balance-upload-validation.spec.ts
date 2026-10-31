import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import { execFileSync } from 'node:child_process';
import {
  normalizeBeginningBalanceText,
  normalizeBeginningBalanceItemCode,
  parseBeginningBalanceQty,
  parseBeginningBalanceDate,
  validateBeginningBalanceUploadRecord,
} from '../lib/beginning-balance-upload-validation';

const row = { itemType: 'ROH', itemCode: '00123', itemName: 'Material  A', uom: 'KG', qty: 1, balanceDate: '01/01/2026' };

test('Excel round trip accepts stored numeric item codes and preserves exact text', async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Fixture');
  sheet.addRow(['000510000012', 512256502000, 510000000010, { formula: '1+1', result: 2 }]);
  sheet.getCell('B1').numFmt = '@';
  sheet.getCell('C1').numFmt = '000000000000000';
  const loaded = new ExcelJS.Workbook();
  await loaded.xlsx.load(await workbook.xlsx.writeBuffer());
  const cells = loaded.worksheets[0].getRow(1);
  for (const [index, expected] of ['000510000012', '512256502000', '510000000010'].entries()) {
    const cell = cells.getCell(index + 1);
    expect(cell.type).toBe(index === 0 ? ExcelJS.ValueType.String : ExcelJS.ValueType.Number);
    expect(normalizeBeginningBalanceItemCode(cell.value)).toBe(expected);
    expect(validateBeginningBalanceUploadRecord({ ...row, itemCode: cell.value })).toEqual([]);
  }
  expect(cells.getCell(2).text).toBe('512256502000');
  expect(cells.getCell(4).type).toBe(ExcelJS.ValueType.Formula);
  expect(() => normalizeBeginningBalanceItemCode(cells.getCell(4).value)).toThrow('Item Code');
  expect(normalizeBeginningBalanceText('  A  B  ')).toBe('A  B');
  for (const value of [null, undefined, 123, false, {}, []]) expect(normalizeBeginningBalanceText(value)).toBe('');
});

test('item code contract preserves text and rejects unsafe numeric and nonprimitive cells', () => {
  for (const value of ['512256502000', '510000000010', '000510000012', '0', '  Ab  C  ']) {
    expect(normalizeBeginningBalanceItemCode(value)).toBe(value.trim());
    expect(validateBeginningBalanceUploadRecord({ ...row, itemCode: value })).toEqual([]);
  }
  expect(normalizeBeginningBalanceItemCode(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
  // Long textual identifiers never pass through Number or exponent formatting.
  expect(normalizeBeginningBalanceItemCode('900719925474099312345')).toBe('900719925474099312345');
  for (const value of [-1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 1e21,
    true, false, new Date(), {}, [], { error: '#N/A' }, { richText: [] }, { formula: '1', result: 1 }]) {
    expect(() => normalizeBeginningBalanceItemCode(value)).toThrow('Item Code');
    expect(validateBeginningBalanceUploadRecord({ ...row, itemCode: value })).toEqual([
      expect.objectContaining({ field: 'Item Code', error: expect.stringContaining('Item Code') }),
    ]);
  }
  for (const value of [0, -0, '', '   ', null, undefined]) {
    expect(() => normalizeBeginningBalanceItemCode(value)).toThrow('Item Code is required');
  }
  for (const field of ['itemType', 'itemName', 'uom', 'ppkekNumbers']) {
    expect(validateBeginningBalanceUploadRecord({ ...row, [field]: 512256502000 })).toContainEqual(
      expect.objectContaining({ error: expect.stringMatching(/text/i) }),
    );
  }
});

test('strict quantities and dates reject coercion and calendar rollover', () => {
  for (const value of ['1x', '0x10', true, {}, '', null, Infinity, NaN, -1, 0]) expect(() => parseBeginningBalanceQty(value)).toThrow();
  expect(parseBeginningBalanceQty('12.50')).toBe(12.5);
  for (const value of ['02/30/2026', '02/29/2025', '13/01/2026', '01/01/2026x', 46023, {}, '01/01/2999']) expect(() => parseBeginningBalanceDate(value)).toThrow();
  expect(parseBeginningBalanceDate('02/29/2024').toISOString()).toBe('2024-02-29T00:00:00.000Z');
  expect(validateBeginningBalanceUploadRecord(row)).toEqual([]);
});

test('mocked HTTP routes verify all 5000/5004 identities and reject atomic failures', () => {
  const output = execFileSync(process.execPath, ['tests/helpers/beginning-balance-upload-harness.cjs'], { encoding: 'utf8', timeout: 20000 });
  expect(output).toContain('SQL/verification rollback passed');
});
