/** WMS list/export policy. SUPER_ADMIN's company selector is a filter, never
 * authority. Other sessions must carry a valid assigned company. */
export class WmsLogFilterError extends Error {
  constructor(message: string, public readonly status: 400 | 403) { super(message); }
}
export interface WmsLogWhere {
  company_code?: number;
  created_at?: { gte?: Date; lte?: Date };
  wms_id?: { contains: string; mode: 'insensitive' };
  action?: string;
  error_type?: string;
  transmission_status?: string;
}
export const WMS_LOG_FILTER_KEYS = ['date_from', 'date_to', 'action', 'error_type', 'transmission_status', 'company_code', 'wms_id'] as const;
function company(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^-?\d+$/.test(value))) return;
  const code = Number(value);
  return Number.isInteger(code) && code >= -2147483648 && code <= 2147483647 ? code : undefined;
}

export function buildWmsLogWhere(params: URLSearchParams, session: unknown, strict = false): WmsLogWhere {
  const user = (session as { user?: { role?: string; companyCode?: unknown } } | null)?.user;
  const superAdmin = user?.role === 'SUPER_ADMIN';
  const assigned = company(user?.companyCode);
  if (!superAdmin && assigned === undefined) throw new WmsLogFilterError('A valid assigned company is required.', 403);
  if (strict) {
    for (const key of params.keys()) {
      if (!(WMS_LOG_FILTER_KEYS as readonly string[]).includes(key) || params.getAll(key).length !== 1) {
        throw new WmsLogFilterError('Use only supported WMS log filters, without duplicates or pagination.', 400);
      }
    }
    for (const key of WMS_LOG_FILTER_KEYS) {
      const value = params.get(key);
      if (value === null) continue;
      const max = key === 'error_type' ? 50 : key === 'transmission_status' ? 20 : 100;
      if (value.length > max || /[\x00-\x1f]/.test(value)) throw new WmsLogFilterError('A WMS log filter is invalid or too long.', 400);
      if ((key === 'date_from' || key === 'date_to') && value) {
        // Preserve JS Date parsing and the listing's inclusive lte boundary.
        // UI sends YYYY-MM-DD and YYYY-MM-DDT23:59:59 (server-local time).
        if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value) ||
            !Number.isFinite(Date.parse(value)) || value.slice(0, 10) < '0001-01-01' || value.slice(0, 10) > '9998-12-31' ||
            new Date(value.slice(0, 10)).toISOString().slice(0, 10) !== value.slice(0, 10)) {
          throw new WmsLogFilterError('Use valid WMS date boundaries.', 400);
        }
      }
    }
  }
  const where: WmsLogWhere = {};
  const requested = params.get('company_code');
  if (requested && requested !== 'ALL') {
    const code = company(requested);
    if (code === undefined) throw new WmsLogFilterError('Invalid company filter.', 400);
    if (!superAdmin && code !== assigned) throw new WmsLogFilterError('Unauthorized - cannot access other company logs', 403);
    where.company_code = code;
  } else if (!superAdmin) where.company_code = assigned;
  const from = params.get('date_from'), to = params.get('date_to');
  if (from || to) {
    where.created_at = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
    if (strict && from && to && new Date(from) > new Date(to)) throw new WmsLogFilterError('Start date must precede end date.', 400);
  }
  const wms = params.get('wms_id')?.trim();
  if (wms) where.wms_id = { contains: wms, mode: 'insensitive' };
  for (const key of ['action', 'error_type', 'transmission_status'] as const) {
    const value = params.get(key);
    if (value && value !== 'ALL') where[key] = value;
  }
  return where;
}

/** UI transport shared by listing and export; caller supplies committed search. */
export function wmsLogFilterParams(filters: {
  dateFrom: string; dateTo: string; appliedWmsIdSearch: string; actionFilter: string;
  errorTypeFilter: string; transmissionStatusFilter: string; companyCodeFilter: string;
}): URLSearchParams {
  return new URLSearchParams({
    ...(filters.dateFrom && { date_from: filters.dateFrom }),
    ...(filters.dateTo && { date_to: filters.dateTo + 'T23:59:59' }),
    ...(filters.appliedWmsIdSearch && { wms_id: filters.appliedWmsIdSearch }),
    ...(filters.actionFilter !== 'ALL' && { action: filters.actionFilter }),
    ...(filters.errorTypeFilter !== 'ALL' && { error_type: filters.errorTypeFilter }),
    ...(filters.transmissionStatusFilter !== 'ALL' && { transmission_status: filters.transmissionStatusFilter }),
    ...(filters.companyCodeFilter !== 'ALL' && { company_code: filters.companyCodeFilter }),
  });
}
