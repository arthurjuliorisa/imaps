import { test, expect } from '@playwright/test';
import { bindInswCsvFilters } from '../lib/insw-logs-csv-postgresql';

const dates = { gte: new Date('2026-11-01T00:00:00+07:00'), lt: new Date('2026-11-03T00:00:00+07:00') };
test('CSV accepts canonical date fallback for unsent logs and binds company and filters', () => {
  const result = bindInswCsvFilters({ company_code: 1370, transaction_type: 'incoming', insw_status: 'FAILED',
    wms_id: { contains: 'WMS-1', mode: 'insensitive' },
    OR: [{ sent_at: dates }, { sent_at: null, created_at: dates }] });
  expect(result.companyCode).toBe(1370);
  expect(result.predicate.sql).toContain('log.sent_at IS NULL');
  expect(result.predicate.sql).toContain('log.created_at >=');
  expect(result.predicate.values).toContain(1370);
  expect(result.predicate.values).toContain('%WMS-1%');
  expect(result.predicate.values).toContain(dates.lt.toISOString());
});

import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import ts from 'typescript';
import * as csv from '../lib/insw-logs-csv';
import * as spool from '../lib/insw-logs-csv-spool';
import { transmissionStatus, transmissionResult } from '../lib/insw-log-presentation';

function execute(source: string, imports: Record<string, unknown> = {}) {
  const exports: any = {};
  new Function('exports', 'require', ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText)(exports, (name: string) => {
    if (!(name in imports)) throw new Error(`Unexpected dependency: ${name}`);
    return imports[name];
  });
  return exports;
}

// Run the actual canonical builder, handler, CSV encoder and private spool.
// Only session/company and database rows are doubled; no provider is reachable.
function handler(root: string, rows: csv.InswCsvRow[], status = 200, sourceError = false, validCompany = true) {
  const calls: any[] = [];
  const service = readFileSync('lib/services/insw-transmission.service.ts', 'utf8');
  const builder = service.slice(service.indexOf('  private buildLogWhere('), service.indexOf('  /** Internal only: company_code'));
  const Builder = execute(`export class Builder { ${builder} }`).Builder;
  const imports = {
    '@/lib/insw-auth': { checkInswAuth: async () => status === 200
      ? { authenticated: true, session: { company: 1370 } }
      : { authenticated: false, response: Response.json({ message: 'Access denied' }, { status }) } },
    '@/lib/company-validation': { validateCompanyCode: () => validCompany ? ({ success: true, companyCode: 1370 }) : ({ success: false, response: Response.json({ error: 'Company required' }, { status: 400 }) }) },
    '@/lib/insw-logs-csv': csv,
    '@/lib/insw-logs-csv-spool': { ...spool, csvSpoolConfig: () => ({ root, maxBytes: 1048576,
      quotaBytes: 2097152, reserveBytes: 1, generationMs: 5000, deliveryMs: 5000 }) },
    '@/lib/services/insw-transmission.service': { INSWTransmissionService: class {
      createTransmissionLogsCsvSource(filters: any) {
        calls.push(filters);
        bindInswCsvFilters(new Builder().buildLogWhere(filters, {}));
        let done = false;
        return async () => {
          if (sourceError) throw new csv.InswCsvError('SOURCE');
          if (done) return []; done = true; return rows;
        };
      }
    } },
  };
  return { get: execute(readFileSync('app/api/insw/logs/export/csv/route.ts', 'utf8'), imports).GET, calls };
}

const csvRow = { sent_at: null, transaction_type: 'incoming', wms_id: 'WMS,"café"\nA',
  insw_activity_code: '30', insw_status: 'FAILED', retry_count: 0 };
const path = '/api/insw/logs/export/csv?transaction_type=incoming&insw_status=FAILED&wms_id=%20WMS%20&date_from=2026-11-01&date_to=2026-11-02';

test('actual CSV handler downloads over HTTP with dates, escaping, UTF-8 and empty/error distinction', async () => {
  const root = await mkdtemp(join(tmpdir(), 'imaps-csv-regression-'));
  try {
    for (const rows of [[csvRow], []]) {
      const fixture = handler(root, rows);
      const server = createServer(async (req, res) => {
        const response = await fixture.get(new Request(`http://127.0.0.1${req.url}`));
        res.writeHead(response.status, Object.fromEntries(response.headers));
        res.end(Buffer.from(await response.arrayBuffer()));
      });
      await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      try {
        const address = server.address() as { port: number };
        const response = await fetch(`http://127.0.0.1:${address.port}${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-disposition')).toBe('attachment; filename="insw-logs-2026-11-01-to-2026-11-02.csv"');
        expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
        const bytes = Buffer.from(await response.arrayBuffer());
        expect(bytes.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
        expect(bytes.toString()).toBe('\uFEFF' + csv.CSV_HEADER + (rows.length ? csv.encodeInswCsvRow(csvRow, 1) : ''));
        if (rows.length) expect(bytes.toString()).toContain('"WMS,""café""\nA"');
        expect(fixture.calls).toEqual([{ company_code: 1370, transaction_type: 'incoming', insw_status: 'FAILED',
          wms_id: 'WMS', date_from: '2026-11-01', date_to: '2026-11-02' }]);
      } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    }
    const failed = handler(root, [], 200, true);
    const response = await failed.get(new Request(`http://fixture.invalid${path}`));
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('SOURCE');
    expect(response.headers.get('content-disposition')).toBeNull();
    expect(await readdir(root)).toEqual([]);
  } finally { await rmdir(root); }
});

test('CSV refuses denied users and forged company/duplicate/invalid filters before reading data', async () => {
  for (const status of [401, 403]) {
    const fixture = handler('/unused', [], status);
    expect((await fixture.get(new Request(`http://fixture.invalid${path}`))).status).toBe(status);
    expect(fixture.calls).toEqual([]);
  }
  const invalidCompany = handler('/unused', [], 200, false, false);
  expect((await invalidCompany.get(new Request(`http://fixture.invalid${path}`))).status).toBe(400);
  expect(invalidCompany.calls).toEqual([]);
  for (const query of ['company_code=1380', 'date_from=2026-11-02&date_to=2026-11-01', 'date_from=2026-02-30', 'wms_id=A&wms_id=B']) {
    const fixture = handler('/unused', []);
    expect((await fixture.get(new Request(`http://fixture.invalid/api/insw/logs/export/csv?${query}`))).status).toBe(400);
    expect(fixture.calls).toEqual([]);
  }
});

test('date adapter remains fail closed for arbitrary OR and unequal bounds', () => {
  for (const OR of [[{ company_code: 1380 }, { sent_at: dates }],
    [{ sent_at: dates }, { sent_at: null, created_at: { gte: dates.gte } }]]) {
    expect(() => bindInswCsvFilters({ company_code: 1370, OR })).toThrow();
  }
  expect(bindInswCsvFilters({ company_code: 1370 }).predicate.values).toEqual([1370]);
  for (const bounds of [{ gte: dates.gte }, { lt: dates.lt }, dates]) {
    const canonical = bindInswCsvFilters({ company_code: 1370, OR: [{ sent_at: bounds }, { sent_at: null, created_at: bounds }] });
    expect(canonical.predicate.sql).toContain('log.sent_at IS NULL');
    expect(bindInswCsvFilters({ company_code: 1370, sent_at: bounds }).predicate.sql).not.toContain('OR');
  }
});

test('presentation keeps uncertain, held success, historical and simulated results distinct', () => {
  const base: any = { insw_status: 'FAILED', can_resend: false, current_queue: { status: 'SUCCEEDED', delivery_state: 'KNOWN_SUCCESS' } };
  expect(transmissionStatus(base).label).toBe('Sent Successfully');
  expect(transmissionStatus({ ...base, insw_status: 'SUCCESS', current_queue: { status: 'READY' } }).label).toBe('Queued');
  expect(transmissionStatus({ ...base, current_queue: { status: 'HELD', hold_reason: 'DELIVERY_UNKNOWN' } }).label).toBe('Delivery Uncertain');
  expect(transmissionStatus({ ...base, current_queue: { status: 'HELD', delivery_state: 'KNOWN_SUCCESS' } }).explanation).toContain('do not send again');
  expect(transmissionResult('PENDING_RESOLVED').label).toBe('Resolved by Resend');
  expect(transmissionResult('SUCCESS', 'KNOWN_SUCCESS', 'SIMULATED_REMOTE_REJECTION').label).toBe('Rehearsal');
  expect(transmissionResult('SUCCESS', 'KNOWN_SUCCESS', 'REAL_INSW_TEST_RESPONSE').label).toBe('INSW Test Result');
  expect(transmissionStatus({ ...base, queue_attempt_id: 'old', metadata: { rehearsalProvenance: 'SIMULATED_REMOTE_REJECTION' },
    current_queue: { ...base.current_queue, attempt: { id: 'latest' } } }).label).toBe('Sent Successfully');
});
