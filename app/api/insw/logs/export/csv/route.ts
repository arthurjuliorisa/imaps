import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { InswCsvError } from '@/lib/insw-logs-csv';
import { csvSpoolConfig, reserveCsvExport, stageCsvDownload } from '@/lib/insw-logs-csv-spool';

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
    const company = validateCompanyCode(auth.session);
    if (!company.success) return company.response;
    if (request.signal.aborted) return new Response(null, { status: 499 });
    const params = new URL(request.url).searchParams;
    const allowed = ['transaction_type', 'insw_status', 'date_from', 'date_to', 'wms_id'];
    for (const key of params.keys()) {
      if (!allowed.includes(key) || params.getAll(key).length !== 1) {
        return json('Use only the supported log filters; company comes from your session.', 400, 'FILTER');
      }
    }
    const filters: { company_code: number; transaction_type?: string; insw_status?: string;
      date_from?: string; date_to?: string; wms_id?: string } = { company_code: company.companyCode };
    for (const key of allowed as (keyof Omit<typeof filters, 'company_code'>)[]) {
      let value = params.get(key) || undefined;
      if (key === 'wms_id') value = value?.trim() || undefined;
      if (!value) continue;
      if (key === 'date_from' || key === 'date_to') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) ||
            new Date(value).toISOString().slice(0, 10) !== value || value < '0001-01-01' || value > '9998-12-31') {
          return json('Use valid YYYY-MM-DD dates.', 400, 'FILTER');
        }
      } else if (value.length > (key === 'wms_id' ? 100 : 20) || /[\x00-\x1f]/.test(value)) {
        return json('A log filter is invalid or too long.', 400, 'FILTER');
      }
      filters[key] = value;
    }
    if (filters.date_from && filters.date_to && filters.date_from > filters.date_to) return json('Start date must precede end date.', 400, 'FILTER');
    const config = csvSpoolConfig();
    release = reserveCsvExport();
    if (!release) return json('An INSW CSV export is already running. Try again shortly.', 429, 'BUSY', { 'Retry-After': '5' });
    const ownedRelease = release;
    // Spool owns release from this point, including failure and slow delivery.
    release = undefined;
    return await stageCsvDownload({ config, signal: request.signal, release: ownedRelease,
      filename: `insw-logs-${filters.date_from || 'all'}-to-${filters.date_to || 'all'}.csv`,
      source: controls => new INSWTransmissionService().createTransmissionLogsCsvSource(filters, controls) });
  } catch (error) {
    if (error instanceof InswCsvError) {
      const status = error.code === 'ROW_LIMIT' || error.code === 'BYTE_LIMIT' ? 413
        : error.code === 'UNSAFE_VALUE' ? 422 : error.code === 'ABORTED' ? 499 : error.code === 'TIMEOUT' ? 504 : 500;
      return json(error.message, status, error.code);
    }
    console.error('INSW CSV export failed (details withheld)');
    return json('Unable to export INSW CSV. Check export configuration or try narrower filters.', 503, 'UNAVAILABLE');
  } finally { release?.(); }
}
