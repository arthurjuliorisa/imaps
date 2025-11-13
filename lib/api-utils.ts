import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import validator from 'validator';

/**
 * Standard API error response handler
 * Converts various error types to appropriate HTTP responses
 */
export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);

  // Prisma unique constraint violation
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      const target = (error.meta?.target as string[]) || [];
      return NextResponse.json(
        { message: `A record with this ${target.join(', ')} already exists` },
        { status: 409 }
      );
    }
    if (error.code === 'P2003') {
      return NextResponse.json(
        { message: 'Foreign key constraint failed. Related record not found.' },
        { status: 400 }
      );
    }
    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Record not found' },
        { status: 404 }
      );
    }
  }

  // Validation error
  if (error instanceof ValidationError) {
    return NextResponse.json(
      { message: error.message },
      { status: 400 }
    );
  }

  // Generic error
  if (error instanceof Error) {
    return NextResponse.json(
      { message: error.message },
      { status: 500 }
    );
  }

  // Unknown error
  return NextResponse.json(
    { message: 'An unexpected error occurred' },
    { status: 500 }
  );
}

/**
 * Custom validation error class
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/**
 * Validates required fields in request body
 */
export function validateRequiredFields(
  data: Record<string, any>,
  fields: string[]
): void {
  const missing = fields.filter(field => !data[field] || String(data[field]).trim() === '');
  if (missing.length > 0) {
    throw new ValidationError(`Missing required fields: ${missing.join(', ')}`);
  }
}

/**
 * Trims all string values in an object
 */
export function trimStringFields<T extends Record<string, any>>(data: T): T {
  const trimmed: any = {};
  for (const [key, value] of Object.entries(data)) {
    trimmed[key] = typeof value === 'string' ? value.trim() : value;
  }
  return trimmed;
}

/**
 * Validates email format
 */
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * Pagination helper
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function getPaginationParams(searchParams: URLSearchParams): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '10', 10)));
  const skip = (page - 1) * limit;

  return { skip, take: limit, page, limit };
}

export function createPaginatedResponse<T>(
  data: T[],
  total: number,
  page: number,
  limit: number
): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Parse and normalize date to UTC midnight to avoid timezone issues
 * @param dateInput - Date string or Date object
 * @returns Normalized Date object at UTC midnight
 * @throws Error if date format is invalid
 */
export function parseAndNormalizeDate(dateInput: string | Date): Date {
  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) {
    throw new ValidationError('Invalid date format');
  }

  // Normalize to UTC midnight
  return new Date(Date.UTC(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    0, 0, 0, 0
  ));
}

/**
 * Get current date normalized to UTC midnight
 * @returns Today's date at UTC midnight
 */
export function getTodayUTC(): Date {
  const now = new Date();
  return new Date(Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  ));
}

/**
 * Validate that a date is not in the future
 * @param date - Date to validate
 * @throws ValidationError if date is in the future
 */
export function validateDateNotFuture(date: Date): void {
  const today = getTodayUTC();
  if (date > today) {
    throw new ValidationError('Date cannot be in the future');
  }
}

/**
 * Sanitize and validate remarks input
 * @param remarks - Remarks text (optional)
 * @param maxLength - Maximum allowed length (default: 1000)
 * @returns Sanitized remarks or null
 * @throws ValidationError if remarks exceed max length
 */
export function sanitizeRemarks(
  remarks: string | null | undefined,
  maxLength: number = 1000
): string | null {
  if (!remarks) return null;

  // Trim whitespace
  const trimmed = remarks.trim();
  if (trimmed.length === 0) return null;

  // Validate max length
  if (trimmed.length > maxLength) {
    throw new ValidationError(`Remarks must not exceed ${maxLength} characters`);
  }

  // Sanitize to prevent XSS - escape HTML entities
  return validator.escape(trimmed);
}

/**
 * Validate that a number is positive (> 0)
 * @param value - Value to validate
 * @param fieldName - Name of the field for error message
 * @throws ValidationError if value is not a positive number
 */
export function validatePositiveNumber(value: any, fieldName: string = 'Value'): number {
  const numValue = parseFloat(String(value));
  if (isNaN(numValue) || numValue <= 0) {
    throw new ValidationError(`${fieldName} must be a positive number greater than 0`);
  }
  return numValue;
}

/**
 * Validate that an item exists and matches the expected type
 * @param prisma - Prisma client instance
 * @param itemId - Item ID to validate
 * @param expectedType - Expected ItemType (e.g., 'RM', 'FG', 'CAPITAL')
 * @returns Item if valid
 * @throws ValidationError if item doesn't exist or type doesn't match
 */
export async function validateItemType(
  prisma: any,
  itemId: string,
  expectedType: string
): Promise<any> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { id: true, code: true, name: true, type: true, uomId: true },
  });

  if (!item) {
    throw new ValidationError('Invalid itemId: Item does not exist');
  }

  if (item.type !== expectedType) {
    const typeNames: Record<string, string> = {
      RM: 'Raw Material',
      FG: 'Finished Good',
      CAPITAL: 'Capital Goods',
      SFG: 'Semi-Finished Good',
      SCRAP: 'Scrap',
    };
    throw new ValidationError(
      `Invalid item type: Item is a ${typeNames[item.type] || item.type}, expected ${typeNames[expectedType] || expectedType}`
    );
  }

  return item;
}
