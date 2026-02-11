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
import { prisma } from '@/lib/db/prisma';
import { checkDuplicateWipBalanceItems } from '@/lib/validators/duplicate-item.validator';
import { validateItemTypeConsistency } from '@/lib/validators/item-type-consistency.validator';

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
    (dateStr: string) => {
      const date = new Date(dateStr);
      return !isNaN(date.getTime());
    },
    { message: 'Invalid stock date' }
  )
  .refine(
    (dateStr: string) => {
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
 * Flexible validation supporting multiple ISO 8601 formats:
 * - 2025-11-27T17:00:00Z
 * - 2025-11-27T17:00:00+07:00
 * - 2025-11-27T17:00:00.000Z
 * - 2025-11-27T17:00:00.000+07:00
 */
const iso8601Schema = z
  .string()
  .refine(
    (dateStr) => {
      try {
        // Must contain 'T' to separate date and time
        if (!dateStr.includes('T')) {
          return false;
        }
        
        // Try parsing with Date constructor (accepts most ISO 8601 formats)
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) {
          return false;
        }
        
        // Additional check: must contain timezone info (Z or +/-HH:MM)
        const hasTimezone = /Z$/.test(dateStr) || /[+-]\d{2}:\d{2}$/.test(dateStr) || /[+-]\d{4}$/.test(dateStr);
        
        return hasTimezone;
      } catch {
        return false;
      }
    },
    { message: 'Timestamp must be in ISO 8601 format with timezone (e.g., 2025-11-27T17:00:00Z or 2025-11-27T17:00:00+07:00)' }
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

// Type alias for compatibility with service layer
export type WipBalanceRecordValidated = WipBalanceRecordInput;

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
export interface ValidationErrorDetail {
  location: 'header' | 'record';
  field: string;
  code: string;
  message: string;
  record_index?: number;
  wms_id?: string;
}

// Type alias for backward compatibility
export type BatchValidationError = ValidationErrorDetail;

/**
 * Validation result
 */
export interface ValidationResult {
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
export function validateWIPBalanceBatch(data: unknown): ValidationResult {
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

/**
 * Validate item_types exist and are active in database
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if all valid)
 */
export async function validateItemTypes(data: WipBalanceBatchRequestInput): Promise<ValidationErrorDetail[]> {
  const errors: ValidationErrorDetail[] = [];

  // Collect unique item_types
  const itemTypes = [...new Set(data.records.map(record => record.item_type))];

  // Query database for valid item_types
  try {
    const validItemTypes = await prisma.item_types.findMany({
      where: {
        item_type_code: {
          in: itemTypes,
        },
        is_active: true,
      },
      select: {
        item_type_code: true,
      },
    });

    const validCodes = new Set(validItemTypes.map(t => t.item_type_code));

    // Check each record's item_type
    data.records.forEach((record, recordIndex) => {
      if (!validCodes.has(record.item_type)) {
        errors.push({
          location: 'record',
          field: 'item_type',
          code: 'INVALID_ITEM_TYPE',
          message: `Item type ${record.item_type} is not valid or not active`,
          record_index: recordIndex,
        });
      }
    });
  } catch (error) {
    // If database query fails, log error but don't block validation
    console.error('Error validating item_types:', error);
  }

  return errors;
}

/**
 * Check for duplicate items in wip-balance batch request
 * Combination: (company_code, item_code, item_name, uom, stock_date)
 * 
 * Note: This allows partial success - only duplicate records fail,
 * others can still be processed
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if no duplicates)
 */
export function checkWipBalanceDuplicates(data: WipBalanceBatchRequestInput): ValidationErrorDetail[] {
  const errors = checkDuplicateWipBalanceItems(
    data.records.map(record => ({
      company_code: record.company_code,
      item_code: record.item_code,
      item_name: record.item_name,
      uom: record.uom,
      stock_date: record.stock_date,
    }))
  );

  // Convert generic duplicate errors to wip-balance format
  return errors.map(err => ({
    location: 'record' as const,
    field: err.field,
    code: err.code,
    message: err.message,
    record_index: err.item_index, // item_index from validator is the record index in wip-balance context
    wms_id: data.records[err.item_index ?? 0]?.wms_id,
  }));
}

/**
 * Validate item_type consistency against existing stock_daily_snapshot records
 * 
 * Converts errors to include record_index for batch context
 *
 * @param data - Validated request data
 * @returns Array of validation errors
 */
export async function validateWipBalanceItemTypeConsistency(
  data: WipBalanceBatchRequestInput
): Promise<ValidationErrorDetail[]> {
  const errors: ValidationErrorDetail[] = [];

  // Get unique company codes from batch
  const uniqueCompanyCodes = [...new Set(data.records.map(r => r.company_code))];

  // For each company, validate item types
  for (const companyCode of uniqueCompanyCodes) {
    const companyRecords = data.records.filter(r => r.company_code === companyCode);
    
    const consistencyErrors = await validateItemTypeConsistency(
      companyCode,
      companyRecords.map(record => ({
        item_type: record.item_type,
        item_code: record.item_code,
        item_name: record.item_name,
      }))
    );

    // Convert errors to include record_index for batch context
    companyRecords.forEach((record) => {
      const recordIndex = data.records.indexOf(record);
      
      // Check if there are errors for this record's item_code
      consistencyErrors.forEach(err => {
        if (err.item_code === record.item_code) {
          errors.push({
            location: 'record' as const,
            field: err.field,
            code: err.code,
            message: err.message,
            record_index: recordIndex,
          });
        }
      });
    });
  }

  return errors;
}