import dayjs from 'dayjs';
import { generateCsv, safeCsvText as text, CsvError as InswCsvError, quoteCsv, CSV_ROW_LIMIT } from './logs-csv';
export { CsvError as InswCsvError, quoteCsv, CSV_ROW_LIMIT, CSV_TRIAL_BATCH_SIZE } from './logs-csv';
export const CSV_HEADER = 'No,Sent At,Type,WMS ID,Activity,Status,Retries\r\n';

export interface InswCsvRow {
  sent_at: Date | null;
  transaction_type: string;
  wms_id: string | null;
  insw_activity_code: string | null;
  insw_status: string;
  retry_count: number;
}

export function encodeInswCsvRow(row: InswCsvRow, ordinal: number): string {
  if (!Number.isSafeInteger(ordinal) || ordinal < 1 || ordinal > CSV_ROW_LIMIT ||
      !Number.isInteger(row.retry_count) || row.retry_count < -2147483648 || row.retry_count > 2147483647 ||
      (row.sent_at !== null && (!(row.sent_at instanceof Date) || !Number.isFinite(row.sent_at.getTime())))) {
    throw new InswCsvError('SOURCE');
  }
  return [String(ordinal), row.sent_at ? dayjs(row.sent_at).format('DD/MM/YYYY HH:mm:ss') : '',
    text(row.transaction_type, 20), text(row.wms_id, 100), text(row.insw_activity_code, 10),
    text(row.insw_status, 20), String(row.retry_count)].map(quoteCsv).join(',') + '\r\n';
}

export function generateInswCsv(options: Omit<Parameters<typeof generateCsv<InswCsvRow>>[0], 'header' | 'encodeRow'>) {
  return generateCsv({ ...options, header: CSV_HEADER, encodeRow: encodeInswCsvRow });
}
