const DEFAULT_TRANSACTION_EXPORT_MAX_RANGE_DAYS = 31;

export const TRANSACTION_DATE_RANGE_REQUIRED_MESSAGE =
  'Start date and end date are required for export.';
export const TRANSACTION_DATE_RANGE_TOO_LARGE_MESSAGE =
  'Export date range cannot exceed 31 days. Please narrow the selected period.';

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function inclusiveDayCount(startDate: Date, endDate: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((endDate.getTime() - startDate.getTime()) / millisecondsPerDay) + 1;
}

export function validateClientTransactionExportDateRange(
  startDate: string,
  endDate: string,
  maxRangeDays = DEFAULT_TRANSACTION_EXPORT_MAX_RANGE_DAYS
): string | null {
  if (!startDate || !endDate) return TRANSACTION_DATE_RANGE_REQUIRED_MESSAGE;

  const parsedStartDate = parseDateOnly(startDate);
  const parsedEndDate = parseDateOnly(endDate);

  if (!parsedStartDate || !parsedEndDate) {
    return 'Invalid date format. Use YYYY-MM-DD.';
  }

  if (parsedEndDate.getTime() < parsedStartDate.getTime()) {
    return 'End date must be the same as or later than start date.';
  }

  if (inclusiveDayCount(parsedStartDate, parsedEndDate) > maxRangeDays) {
    return `Export date range cannot exceed ${maxRangeDays} days. Please narrow the selected period.`;
  }

  return null;
}

function getFilenameFromContentDisposition(contentDisposition: string | null, fallback: string): string {
  if (!contentDisposition) return fallback;
  const match = contentDisposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

export async function readTransactionExportErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.message || data.error || 'Export failed. Please narrow the filters or try again.';
  } catch {
    return 'Export failed. Please narrow the filters or try again.';
  }
}

export async function downloadTransactionExcelResponse(
  response: Response,
  fallbackFileName: string
): Promise<void> {
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = getFilenameFromContentDisposition(
    response.headers.get('Content-Disposition'),
    fallbackFileName
  );
  document.body.appendChild(link);
  link.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(link);
}
