import { checkAuth } from '@/lib/api-auth';
import { buildWmsLogWhere, WmsLogFilterError } from '@/lib/wms-log-filters';
import { CsvError } from '@/lib/logs-csv';
import { csvSpoolConfig, reserveCsvExport, stageLogsCsvDownload } from '@/lib/insw-logs-csv-spool';
import { encodeWmsCsvRow, WMS_CSV_HEADER } from '@/lib/wms-logs-csv';
import { createWmsCsvPostgresqlSource } from '@/lib/wms-logs-csv-postgresql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function json(error: string, status: number, code: string, headers?: HeadersInit) {
  return Response.json({ success: false, error, code }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}
export async function GET(request: Request) {
  let release: (() => void) | undefined;
  try {
    const auth = await checkAuth();
    if (!auth.authenticated) return auth.response;
    const where = buildWmsLogWhere(new URL(request.url).searchParams, auth.session, true);
    if (request.signal.aborted) return new Response(null, { status: 499 });
    if (process.env.NODE_ENV === 'production' && process.env.WMS_CSV_OPERATIONS_VERIFIED !== 'yes') {
      throw new Error('WMS CSV production operations not verified');
    }
    const config = csvSpoolConfig();
    // Same config, root, retained-file quota, and process reservation as INSW.
    release = reserveCsvExport();
    if (!release) return json('A CSV export is already running. Try again shortly.', 429, 'BUSY', { 'Retry-After': '5' });
    const ownedRelease = release; release = undefined;
    return await stageLogsCsvDownload({ config, signal: request.signal, release: ownedRelease,
      filename: 'wms-logs.csv', header: WMS_CSV_HEADER, encodeRow: encodeWmsCsvRow,
      source: controls => createWmsCsvPostgresqlSource(where, controls) });
  } catch (error) {
    if (error instanceof WmsLogFilterError) return json(error.message, error.status, 'FILTER');
    if (error instanceof CsvError) {
      const status = error.code === 'ROW_LIMIT' || error.code === 'BYTE_LIMIT' ? 413 : error.code === 'UNSAFE_VALUE' ? 422
        : error.code === 'ABORTED' ? 499 : error.code === 'TIMEOUT' ? 504 : 500;
      const message = error.code === 'UNSAFE_VALUE'
        ? 'WMS CSV refused a spreadsheet-sensitive value (including leading-zero or over-15-digit numeric identifiers). Narrow filters or review source data; values are never rewritten.'
        : error.message;
      return json(message, status, error.code);
    }
    console.error('WMS CSV export failed (details withheld)');
    return json('Unable to export WMS CSV. Check export configuration or try narrower filters.', 503, 'UNAVAILABLE');
  } finally { release?.(); }
}
