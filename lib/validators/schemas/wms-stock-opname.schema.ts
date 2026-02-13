/**
 * WMS Stock Opname Validators
 * Zod schemas for request validation
 */

import { z } from 'zod';

// ============================================================================
// BASE SCHEMAS
// ============================================================================

/**
 * Stock opname item schema (shared between POST and PATCH)
 */
const stockOpnameItemSchema = z.object({
  item_code: z
    .string()
    .min(1, 'Item code is required')
    .max(50, 'Item code must be max 50 characters')
    .trim(),
  item_type: z
    .string()
    .min(1, 'Item type is required')
    .max(10, 'Item type must be max 10 characters')
    .trim(),
  physical_qty: z
    .number()
    .nonnegative('Physical quantity must be >= 0'),
  uom: z
    .string()
    .min(1, 'UOM is required')
    .max(20, 'UOM must be max 20 characters')
    .trim(),
  notes: z
    .string()
    .max(500, 'Notes must be max 500 characters')
    .nullable()
    .optional(),
});

type StockOpnameItemInput = z.infer<typeof stockOpnameItemSchema>;

// ============================================================================
// POST VALIDATION SCHEMA
// ============================================================================

/**
 * Schema for POST /api/v1/stock-opname
 * Creates new stock opname with status="ACTIVE"
 */
export const createStockOpnameSchema = z.object({
  wms_id: z
    .string()
    .min(1, 'WMS ID is required')
    .max(100, 'WMS ID must be max 100 characters')
    .trim(),
  company_code: z
    .number()
    .int('Company code must be an integer'),
  owner: z
    .number()
    .int('Owner must be an integer')
    .nullable()
    .optional(),
  document_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Document date must be YYYY-MM-DD format'),
  items: z
    .array(stockOpnameItemSchema)
    .min(1, 'At least 1 item is required'),
});

export type CreateStockOpnameInput = z.infer<typeof createStockOpnameSchema>;

// ============================================================================
// PATCH VALIDATION SCHEMA
// ============================================================================

/**
 * Schema for PATCH /api/v1/stock-opname
 * Updates stock opname status to "CONFIRMED" or "CANCELLED"
 */
export const updateStockOpnameSchema = z.object({
  wms_id: z
    .string()
    .min(1, 'WMS ID is required')
    .max(100, 'WMS ID must be max 100 characters')
    .trim(),
  status: z
    .enum(['CONFIRMED', 'CANCELLED'])
    .refine((val) => val, 'Status must be "CONFIRMED" or "CANCELLED"'),
  items: z
    .array(stockOpnameItemSchema)
    .optional(),
  notes: z
    .string()
    .max(500, 'Notes must be max 500 characters')
    .nullable()
    .optional(),
});

export type UpdateStockOpnameInput = z.infer<typeof updateStockOpnameSchema>;

// ============================================================================
// DERIVED VALIDATORS FOR INTERNAL USE
// ============================================================================

/**
 * Validates company code format
 */
export const validateCompanyCode = (code: number): boolean => {
  return code > 0 && code <= 999999; // Expect positive integer
};

/**
 * Validates date string is valid date
 */
export const validateDateString = (dateStr: string): boolean => {
  try {
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date.getTime());
  } catch {
    return false;
  }
};

/**
 * Converts ISO date string to Date object
 */
export const parseISODate = (dateStr: string): Date => {
  const date = new Date(dateStr + 'T00:00:00Z');
  return date;
};

/**
 * Validates item type exists in item master
 * (Will be called from service layer with DB lookup)
 */
export const validateItemType = (itemType: string): boolean => {
  // Actual validation happens in service layer with DB lookup
  return !!itemType && itemType.length <= 10;
};

/**
 * Validates WMS ID uniqueness per company
 * (Will be called from repository layer)
 */
export const isValidWmsIdFormat = (wmsId: string): boolean => {
  // WMS ID is alphanumeric, max 50 chars
  return /^[a-zA-Z0-9._-]+$/.test(wmsId) && wmsId.length <= 50;
};
