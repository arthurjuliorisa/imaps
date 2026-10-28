import dayjs from 'dayjs';
import { CsvError, CSV_ROW_LIMIT, quoteCsv, safeCsvText } from './logs-csv';

export const WMS_CSV_HEADER = 'No,Created At,Action,Status,WMS ID,Company Code,Error Type,Items,Expires At\r\n';
export interface WmsCsvRow {
  created_at: Date; action: string; transmission_status: string; wms_id: string | null;
  company_code: number | null; error_type: string | null; item_count: number | null; expires_at: Date;
}
const integer = (value: number | null) => {
  if (value === null) return '';
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new CsvError('SOURCE');
  return String(value);
};
export function encodeWmsCsvRow(row: WmsCsvRow, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > CSV_ROW_LIMIT ||
      ![row.created_at, row.expires_at].every(date => date instanceof Date && Number.isFinite(date.getTime())) ||
      typeof row.action !== 'string' || typeof row.transmission_status !== 'string') throw new CsvError('SOURCE');
  // Raw action codes and company integers identify rows without exporting names
  // fetched from another API. Dates use the existing WMS table's local formats.
  return [String(ordinal), dayjs(row.created_at).format('MM/DD/YYYY HH:mm:ss'),
    safeCsvText(row.action, 100), safeCsvText(row.transmission_status, 20), safeCsvText(row.wms_id, 100),
    integer(row.company_code), safeCsvText(row.error_type, 50), integer(row.item_count),
    dayjs(row.expires_at).format('MM/DD/YYYY')].map(quoteCsv).join(',') + '\r\n';
}
