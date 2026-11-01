import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';

// Execute the actual route and workbook writer; no DB, session or HTTP transport.
function route(rows: unknown[], authenticated = true, validCompany = true) {
  const calls: unknown[] = [];
  const imports: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json } },
    exceljs: ExcelJS, dayjs,
    '@/lib/services/insw-transmission.service': { INSWTransmissionService: class {
      async getTransmissionLogsForExcel(filters: unknown) { calls.push(filters); return rows; }
    } },
    '@/lib/insw-auth': { checkInswAuth: async () => authenticated
      ? { authenticated: true, session: {} } : { authenticated: false, response: new Response(null, { status: 403 }) } },
    '@/lib/company-validation': { validateCompanyCode: () => validCompany
      ? { success: true, companyCode: 1370 } : { success: false, response: new Response(null, { status: 400 }) } },
  };
  const exports: any = {};
  const source = readFileSync('app/api/insw/logs/export/route.ts', 'utf8');
  const execute = new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, esModuleInterop: true,
  } }).outputText);
  execute(exports, (name: string) => {
    if (!(name in imports)) throw new Error(`Unmocked import ${name}`);
    return imports[name];
  });
  return { get: exports.GET as (request: Request) => Promise<Response>, calls };
}
const row = { sent_at: null, transaction_type: 'incoming', wms_id: 'WMS-1',
  insw_activity_code: '30', insw_status: 'FAILED', retry_count: 0 };
const request = () => new Request('http://fixture.invalid/api/insw/logs/export?transaction_type=incoming&insw_status=FAILED&wms_id=%20WMS-1%20&date_from=2026-10-01&date_to=2026-10-31');

test('Excel export preserves scoped filters and exact complete counts through the row cap', async () => {
  for (const count of [0, 1, 10000]) {
    const fixture = route(Array(count).fill(row));
    const response = await fixture.get(request());
    expect(response.status).toBe(200);
    expect(fixture.calls).toEqual([{ company_code: 1370, transaction_type: 'incoming', insw_status: 'FAILED',
      wms_id: 'WMS-1', date_from: '2026-10-01', date_to: '2026-10-31' }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as any);
    const info = workbook.getWorksheet('Export Info')!;
    expect(info.getRow(2).getCell(2).value).toBe(count);
    expect(info.getRow(3).getCell(2).value).toBe(count);
    expect(info.getRow(4).getCell(2).value).toBe('NO');
    const logs = workbook.getWorksheet('INSW Logs')!;
    expect(logs.rowCount).toBe(count + 1);
    if (count) {
      expect(logs.getRow(2).getCell(2).value).toBe('');
      expect(logs.getRow(2).getCell(4).value).toBe('WMS-1');
    }
  }
});

test('sentinel overflow explicitly rejects oversized export without returning a truncated workbook', async () => {
  const fixture = route(Array(10001).fill(row));
  const response = await fixture.get(request());
  expect(response.status).toBe(413);
  expect((await response.json()).error).toContain('More than 10,000 logs match. Narrow');
  expect(fixture.calls).toHaveLength(1);
});

test('export checks authorization and company before requesting rows', async () => {
  for (const [authenticated, validCompany, status] of [[false, true, 403], [true, false, 400]] as const) {
    const fixture = route([], authenticated, validCompany);
    expect((await fixture.get(request())).status).toBe(status);
    expect(fixture.calls).toHaveLength(0);
  }
});
