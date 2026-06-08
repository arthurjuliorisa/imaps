const MAX_EXPORT_RANGE_MONTHS = 6;
export const DATE_RANGE_TOO_LARGE_MESSAGE =
  'Export date range cannot exceed 6 calendar months. Please narrow the selected period.';

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

function daysInUTCMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function addCalendarMonths(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const targetMonth = month + months;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedTargetMonth = ((targetMonth % 12) + 12) % 12;
  const clampedDay = Math.min(day, daysInUTCMonth(targetYear, normalizedTargetMonth));

  return new Date(Date.UTC(targetYear, normalizedTargetMonth, clampedDay));
}

export function validateClientExportDateRange(startDate: string, endDate: string): string | null {
  const parsedStartDate = parseDateOnly(startDate);
  const parsedEndDate = parseDateOnly(endDate);

  if (!parsedStartDate || !parsedEndDate) {
    return 'Invalid date format. Use YYYY-MM-DD.';
  }

  if (parsedEndDate.getTime() < parsedStartDate.getTime()) {
    return 'End date must be the same as or later than start date.';
  }

  if (parsedEndDate.getTime() > addCalendarMonths(parsedStartDate, MAX_EXPORT_RANGE_MONTHS).getTime()) {
    return DATE_RANGE_TOO_LARGE_MESSAGE;
  }

  return null;
}

export function getFilenameFromContentDisposition(
  contentDisposition: string | null,
  fallback: string
): string {
  if (!contentDisposition) return fallback;

  const match = contentDisposition.match(/filename="?([^"]+)"?/i);
  return match?.[1] || fallback;
}

export async function readExportErrorMessage(response: Response): Promise<string> {
  try {
    const data = await response.json();
    return data.message || data.error || 'Export failed. Please narrow the filters or try again.';
  } catch {
    return 'Export failed. Please narrow the filters or try again.';
  }
}

export async function downloadExcelResponse(response: Response, fallbackFileName: string): Promise<void> {
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
