// lib/validators/schemas/wip-balance.schema.ts

/**
 * WIP Balance Validation Schema
 * 
 * Purpose:
 * - Validate batch request payload structure
 * - Validate individual record fields
 * - Enforce business rules per API contract v2.4
 * 
 * Validation Rules (from API Contract):
 * 1. Company Code: Must be 1370, 1310, or 1380 (integer)
 * 2. Item Code: Must be valid raw material item code
 * 3. Quantity: Can be 0 (depleted) or positive
 * 4. Stock Date: Should be current date or recent past
 * 5. Item Type: All types supported (ROH, HALB) - no restrictions
 * 
 * Version: 2.0 - Updated with standardized validation pattern
 */

import { z } from 'zod';

// =============================================================================
// CONSTANTS
// =============================================================================

/**
 * Valid company codes
 */
const VALID_COMPANY_CODES = [1370, 1310, 1380] as const;

// =============================================================================
// REUSABLE SCHEMAS
// =============================================================================

/**
 * Date string schema (YYYY-MM-DD format)
 */
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Stock date must be in YYYY-MM-DD format')
  .refine(
    (dateStr) => {
      const date = new Date(dateStr);
      return !isNaN(date.getTime());
    },
    { message: 'Invalid stock date' }
  )
  .refine(
    (dateStr) => {
      const date = new Date(dateStr);
      // Stock date should not be too far in the future (allow max 1 day ahead for timezone differences)
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 59, 999);
      return date <= tomorrow;
    },
    { message: 'Stock date cannot be more than 1 day in the future' }
  );

/**
 * ISO 8601 datetime schema
 */
const iso8601Schema = z
  .string()
  .refine(
    (dateStr) => {
      const date = new Date(dateStr);
      return !isNaN(date.getTime()) && dateStr.includes('T');
    },
    { message: 'Timestamp must be in ISO 8601 format (e.g., 2025-11-27T17:00:00Z)' }
  );

/**
 * Company code schema
 */
const companyCodeSchema = z
  .number()
  .int('Company code must be an integer')
  .refine(
    (code) => VALID_COMPANY_CODES.includes(code as any),
    {
      message: `Company code must be one of: ${VALID_COMPANY_CODES.join(', ')}`,
    }
  );

// =============================================================================
// RECORD SCHEMA
// =============================================================================

/**
 * Single WIP Balance record schema
 */
export const WipBalanceRecordSchema = z.object({
  wms_id: z
    .string()
    .min(1, 'WMS ID is required')
    .max(100, 'WMS ID must be at most 100 characters')
    .trim(),

  company_code: companyCodeSchema,

  item_type: z
    .string()
    .min(1, 'Item type is required')
    .max(10, 'Item type must be at most 10 characters')
    .trim()
    .toUpperCase(),
  // Note: No validation on specific item_type values - WMS guarantees correctness

  item_code: z
    .string()
    .min(1, 'Item code is required')
    .max(50, 'Item code must be at most 50 characters')
    .trim(),

  item_name: z
    .string()
    .min(1, 'Item name is required')
    .max(200, 'Item name must be at most 200 characters')
    .trim(),

  stock_date: dateStringSchema,

  uom: z
    .string()
    .min(1, 'Unit of measure is required')
    .max(20, 'Unit of measure must be at most 20 characters')
    .trim()
    .toUpperCase(),

  qty: z
    .number()
    .or(z.string().transform((val) => parseFloat(val)))
    .refine((val) => !isNaN(val), 'Quantity must be a valid number')
    .refine((val) => val >= 0, 'Quantity must be 0 or positive')
    .refine(
      (val) => {
        // Check max 3 decimal places
        const decimalPart = val.toString().split('.')[1];
        return !decimalPart || decimalPart.length <= 3;
      },
      'Quantity can have maximum 3 decimal places'
    )
    .transform((val) => Number(val)),

  timestamp: iso8601Schema,
});

export type WipBalanceRecordInput = z.infer<typeof WipBalanceRecordSchema>;

// =============================================================================
// BATCH REQUEST SCHEMA
// =============================================================================

/**
 * Batch request schema
 * Structure: { records: [...] }
 */
export const WipBalanceBatchRequestSchema = z
  .object({
    records: z
      .array(WipBalanceRecordSchema)
      .min(1, 'Records array must contain at least 1 record')
      .max(10000, 'Maximum 10,000 records per request'),
  })
  .refine(
    (data) => {
      // Check for duplicate wms_id within the same batch
      const wmsIds = data.records.map((r) => r.wms_id);
      const uniqueWmsIds = new Set(wmsIds);
      return wmsIds.length === uniqueWmsIds.size;
    },
    {
      message: 'Duplicate wms_id found in batch. Each wms_id must be unique within the request.',
      path: ['records'],
    }
  );

export type WipBalanceBatchRequestInput = z.infer<typeof WipBalanceBatchRequestSchema>;

// =============================================================================
// VALIDATION FUNCTION
// =============================================================================

/**
 * Validation error detail
 */
interface ValidationErrorDetail {
  location: 'header' | 'record';
  field: string;
  code: string;
  message: string;
  record_index?: number;
  wms_id?: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  success: boolean;
  data?: WipBalanceBatchRequestInput;
  errors?: ValidationErrorDetail[];
}

/**
 * Validate WIP balance batch request
 * 
 * @param data - Request payload
 * @returns Validation result with detailed errors
 */
export function validateWipBalanceBatch(data: unknown): ValidationResult {
  const result = WipBalanceBatchRequestSchema.safeParse(data);
  
  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }
  
  // Transform Zod errors to API error format
  const errors: ValidationErrorDetail[] = result.error.issues.map((err) => {
    const path = err.path.join('.');
    const isRecordError = path.startsWith('records.');
    
    let recordIndex: number | undefined;
    let wmsId: string | undefined;
    let field = path;
    
    // Extract record index and field for record-level errors
    if (isRecordError) {
      const match = path.match(/^records\.(\d+)\.(.+)$/);
      if (match) {
        recordIndex = parseInt(match[1], 10);
        field = match[2];
        
        // Get wms_id if available
        if (typeof data === 'object' && data !== null && 'records' in data) {
          const records = (data as any).records;
          if (Array.isArray(records) && records[recordIndex]) {
            wmsId = records[recordIndex].wms_id;
          }
        }
      } else if (path === 'records') {
        // Batch-level error (e.g., duplicate wms_id)
        field = 'records';
      }
    }
    
    return {
      location: isRecordError ? ('record' as const) : ('header' as const),
      field,
      code: err.code === 'custom' ? 'INVALID_VALUE' : err.code.toUpperCase(),
      message: err.message,
      ...(recordIndex !== undefined && { record_index: recordIndex }),
      ...(wmsId && { wms_id: wmsId }),
    };
  });
  
  return {
    success: false,
    errors,
  };
}

/**
 * Validation helper for single record
 * 
 * @param data - Raw record data
 * @returns Validation result
 */
export function validateWipBalanceRecord(data: unknown): ValidationResult {
  const result = WipBalanceRecordSchema.safeParse(data);
  
  if (result.success) {
    return {
      success: true,
      data: { records: [result.data] },
    };
  }
  
  // Transform Zod errors to API error format
  const errors: ValidationErrorDetail[] = result.error.issues.map((err) => {
    const path = err.path.join('.');
    
    return {
      location: 'record' as const,
      field: path,
      code: err.code === 'custom' ? 'INVALID_VALUE' : err.code.toUpperCase(),
      message: err.message,
    };
  });
  
  return {
    success: false,
    errors,
  };
}