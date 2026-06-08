import { NextResponse } from 'next/server';

export const MAX_EXPORT_RANGE_MONTHS = 6;
export const DEFAULT_MAX_EXPORT_ROWS = 50000;

export type LpjExportErrorCode =
  | 'INVALID_DATE_FORMAT'
  | 'INVALID_DATE_RANGE'
  | 'DATE_RANGE_TOO_LARGE'
  | 'EXPORT_TOO_LARGE';

export class LpjExportValidationError extends Error {
  code: LpjExportErrorCode;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    code: LpjExportErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'LpjExportValidationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface ValidatedExportDateRange {
  startDate: Date;
  endDate: Date;
  startDateString: string;
  endDateString: string;
}

function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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

export function parseISODateParam(value: string | null | undefined, fieldName: string): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new LpjExportValidationError(
      'INVALID_DATE_FORMAT',
      'Invalid date format. Use YYYY-MM-DD.'
    );
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new LpjExportValidationError(
      'INVALID_DATE_FORMAT',
      'Invalid date format. Use YYYY-MM-DD.',
      400,
      { fieldName }
    );
  }

  return date;
}

export function validateExportDateRange(params: {
  startDate?: string | null;
  endDate?: string | null;
  stockDate?: string | null;
  mode: 'range' | 'single-date';
  maxMonths?: number;
}): ValidatedExportDateRange {
  const maxMonths = params.maxMonths ?? MAX_EXPORT_RANGE_MONTHS;

  const startDate = params.mode === 'single-date'
    ? parseISODateParam(params.stockDate, 'stockDate')
    : parseISODateParam(params.startDate, 'startDate');
  const endDate = params.mode === 'single-date'
    ? startDate
    : parseISODateParam(params.endDate, 'endDate');

  if (endDate.getTime() < startDate.getTime()) {
    throw new LpjExportValidationError(
      'INVALID_DATE_RANGE',
      'End date must be the same as or later than start date.'
    );
  }

  const maxEndDate = addCalendarMonths(startDate, maxMonths);
  if (endDate.getTime() > maxEndDate.getTime()) {
    throw new LpjExportValidationError(
      'DATE_RANGE_TOO_LARGE',
      'Export date range cannot exceed 6 calendar months. Please narrow the selected period.'
    );
  }

  return {
    startDate,
    endDate,
    startDateString: formatDateUTC(startDate),
    endDateString: formatDateUTC(endDate),
  };
}

export function getMaxExportRows(): number {
  // Configurable operational guardrail for synchronous Excel export,
  // not a statement of iMAPS maximum export capability.
  const configuredValue = process.env.LPJ_MUTASI_MAX_EXPORT_ROWS || process.env.MAX_EXPORT_ROWS;
  const parsedValue = configuredValue ? Number(configuredValue) : DEFAULT_MAX_EXPORT_ROWS;

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return DEFAULT_MAX_EXPORT_ROWS;
  }

  return Math.floor(parsedValue);
}

export function validateExportRowCount(totalRows: number, maxRows = getMaxExportRows()): void {
  if (totalRows > maxRows) {
    throw new LpjExportValidationError(
      'EXPORT_TOO_LARGE',
      'Export contains too many rows. Please narrow the date range or filters.',
      413,
      {
        totalRows,
        maxRows,
      }
    );
  }
}

export function lpjExportErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof LpjExportValidationError)) return null;

  return NextResponse.json(
    {
      success: false,
      code: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    },
    { status: error.status }
  );
}
