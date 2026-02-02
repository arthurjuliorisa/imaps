import { Decimal } from '@prisma/client/runtime/library';

/**
 * Check if an object looks like a Prisma Decimal (has s, e, d properties)
 */
function isDecimalLike(obj: any): boolean {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    's' in obj &&
    'e' in obj &&
    'd' in obj &&
    Array.isArray(obj.d)
  );
}

/**
 * Convert a Decimal-like object to a number
 * Uses Decimal.js constructor to properly reconstruct the value
 */
function decimalToNumber(decimal: any): number {
  try {
    // Try to reconstruct using Decimal constructor
    const dec = new Decimal(decimal);
    return dec.toNumber();
  } catch (error) {
    // Fallback: return 0 if reconstruction fails
    console.error('Failed to convert Decimal-like object:', decimal, error);
    return 0;
  }
}

/**
 * Converts BigInt and Decimal fields for JSON serialization
 * - BigInt is converted to string
 * - Decimal is converted to number
 * This is necessary because JavaScript's JSON.stringify cannot serialize these types
 */
export function serializeBigInt<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return String(obj) as T;
  }

  // Handle Prisma Decimal type (both instance and plain object)
  if (obj instanceof Decimal) {
    return obj.toNumber() as T;
  }

  // Handle Decimal-like objects (after JSON serialization)
  if (isDecimalLike(obj)) {
    return decimalToNumber(obj) as T;
  }

  if (obj instanceof Date) {
    return obj.toISOString() as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => serializeBigInt(item)) as T;
  }

  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        serialized[key] = serializeBigInt((obj as any)[key]);
      }
    }
    return serialized;
  }

  return obj;
}
