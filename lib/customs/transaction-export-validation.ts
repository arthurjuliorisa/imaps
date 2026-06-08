import { NextResponse } from 'next/server';

export const DEFAULT_TRANSACTION_EXPORT_MAX_RANGE_DAYS = 31;
export const DEFAULT_TRANSACTION_EXPORT_MAX_ROWS = 20000;

export type TransactionExportErrorCode =
  | 'DATE_RANGE_REQUIRED'
  | 'INVALID_DATE_FORMAT'
  | 'INVALID_DATE_RANGE'
  | 'DATE_RANGE_TOO_LARGE'
  | 'EXPORT_TOO_LARGE';

export class TransactionExportValidationError extends Error {
  code: TransactionExportErrorCode;
  status: number;
  details?: Record<string, unknown>;

  constructor(
    code: TransactionExportErrorCode,
    message: string,
    status = 400,
    details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'TransactionExportValidationError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface TransactionExportConfig {
  maxRangeDays: number;
  maxRows: number;
}

export interface ValidatedTransactionExportDateRange {
  startDate: Date;
  endDate: Date;
  startDateString: string;
  endDateString: string;
}

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const rawValue = process.env[name];
  const parsedValue = rawValue ? Number(rawValue) : fallback;
  return Number.isFinite(parsedValue) && parsedValue > 0 ? Math.floor(parsedValue) : fallback;
}

export function getTransactionExportConfig(): TransactionExportConfig {
  return {
    maxRangeDays: getPositiveIntegerEnv(
      'TRANSACTION_EXPORT_MAX_RANGE_DAYS',
      DEFAULT_TRANSACTION_EXPORT_MAX_RANGE_DAYS
    ),
    // TRANSACTION_EXPORT_MAX_ROWS is a configurable operational guardrail for synchronous
    // Excel export, chosen to protect production stability. It is not a statement of
    // iMAPS maximum export capability.
    maxRows: getPositiveIntegerEnv(
      'TRANSACTION_EXPORT_MAX_ROWS',
      DEFAULT_TRANSACTION_EXPORT_MAX_ROWS
    ),
  };
}

function formatDateUTC(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function inclusiveDayCount(startDate: Date, endDate: Date): number {
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((endDate.getTime() - startDate.getTime()) / millisecondsPerDay) + 1;
}

export function parseTransactionExportDate(value: string | null | undefined): Date {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TransactionExportValidationError(
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
    throw new TransactionExportValidationError(
      'INVALID_DATE_FORMAT',
      'Invalid date format. Use YYYY-MM-DD.'
    );
  }

  return date;
}

export function validateTransactionExportDateRange(params: {
  startDate?: string | null;
  endDate?: string | null;
  maxRangeDays?: number;
}): ValidatedTransactionExportDateRange {
  if (!params.startDate || !params.endDate) {
    throw new TransactionExportValidationError(
      'DATE_RANGE_REQUIRED',
      'Start date and end date are required for export.'
    );
  }

  const startDate = parseTransactionExportDate(params.startDate);
  const endDate = parseTransactionExportDate(params.endDate);

  if (endDate.getTime() < startDate.getTime()) {
    throw new TransactionExportValidationError(
      'INVALID_DATE_RANGE',
      'End date must be the same as or later than start date.'
    );
  }

  const maxRangeDays = params.maxRangeDays ?? DEFAULT_TRANSACTION_EXPORT_MAX_RANGE_DAYS;

  if (inclusiveDayCount(startDate, endDate) > maxRangeDays) {
    throw new TransactionExportValidationError(
      'DATE_RANGE_TOO_LARGE',
      `Export date range cannot exceed ${maxRangeDays} days. Please narrow the selected period.`
    );
  }

  return {
    startDate,
    endDate,
    startDateString: formatDateUTC(startDate),
    endDateString: formatDateUTC(endDate),
  };
}

export function validateTransactionExportRowCount(totalRows: number, maxRows: number): void {
  if (totalRows > maxRows) {
    throw new TransactionExportValidationError(
      'EXPORT_TOO_LARGE',
      'Export contains too many rows. Please narrow the date range or filters.',
      413,
      { totalRows, maxRows }
    );
  }
}

export function transactionExportErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof TransactionExportValidationError)) return null;

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
