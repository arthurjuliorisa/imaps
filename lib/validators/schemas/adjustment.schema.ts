// lib/validators/schemas/adjustment.schema.ts

/**
 * Adjustments Validation Schema
 * 
 * Purpose:
 * - Validate adjustment request payload
 * - Support GAIN adjustments (inventory increase)
 * - Support LOSS adjustments (inventory decrease)
 * - All item types supported
 * - Optional reason for traceability
 */

import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { checkDuplicateItems } from '@/lib/validators/duplicate-item.validator';
import { validateItemTypeConsistency } from '@/lib/validators/item-type-consistency.validator';

// =============================================================================
// CONSTANTS
// =============================================================================

const VALID_COMPANY_CODES = [1370, 1310, 1380] as const;

// =============================================================================
// REUSABLE SCHEMAS
// =============================================================================

/**
 * ISO 8601 datetime schema
 */
const iso8601Schema = z
  .string()
  .refine(
    (dateStr: string) => {
      const date = new Date(dateStr);
      return !isNaN(date.getTime());
    },
    { message: 'Must be valid ISO 8601 datetime format' }
  );

/**
 * Date string schema (ISO 8601 datetime)
 */
const transactionDateSchema = z
  .string()
  .refine(
    (val) => !isNaN(Date.parse(val)),
    { message: 'Invalid date format' }
  )
  .refine(
    (dateStr: string) => {
      const transactionDate = new Date(dateStr);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return transactionDate <= today;
    },
    { message: 'Transaction date cannot be in the future' }
  );

/**
 * Company code schema
 */
const companyCodeSchema = z
  .number()
  .int('Company code must be an integer')
  .min(1, 'Company code must be greater than 0');

// =============================================================================
// ITEM SCHEMA
// =============================================================================

/**
 * Single adjustment item schema
 */
export const adjustmentItemSchema = z.object({
  adjustment_type: z
    .enum(['GAIN', 'LOSS'], {
      message: 'Adjustment type must be GAIN or LOSS',
    }),
  
  item_type: z
    .string()
    .min(1, 'Item type is required')
    .max(10, 'Item type must not exceed 10 characters')
    .trim(),
  
  item_code: z
    .string()
    .min(1, 'Item code is required')
    .max(50, 'Item code must not exceed 50 characters')
    .trim(),
  
  item_name: z
    .string()
    .min(1, 'Item name is required')
    .max(200, 'Item name must not exceed 200 characters')
    .trim(),
  
  uom: z
    .string()
    .min(1, 'UOM is required')
    .max(20, 'UOM must not exceed 20 characters')
    .trim(),
  
  qty: z
    .number()
    .positive('Quantity must be greater than 0')
    .finite('Quantity must be a finite number'),
  
  reason: z
    .string()
    .trim()
    .max(500, 'Reason must not exceed 500 characters')
    .nullable()
    .optional(),
});

export type AdjustmentItemInput = z.infer<typeof adjustmentItemSchema>;

// =============================================================================
// BATCH REQUEST SCHEMA
// =============================================================================

/**
 * Adjustment batch request schema
 */
export const adjustmentBatchRequestSchema = z
  .object({
    wms_id: z
      .string()
      .min(1, 'WMS ID is required')
      .max(100, 'WMS ID must not exceed 100 characters')
      .trim(),
    
    company_code: companyCodeSchema,
    owner: companyCodeSchema,
    
    wms_doc_type: z
      .string()
      .trim()
      .max(100, 'WMS document type must not exceed 100 characters')
      .nullable()
      .optional(),
    
    internal_evidence_number: z
      .string()
      .min(1, 'Internal evidence number is required')
      .max(50, 'Internal evidence number must not exceed 50 characters')
      .trim(),
    
    transaction_date: transactionDateSchema,
    
    items: z
      .array(adjustmentItemSchema)
      .min(1, 'At least one item is required')
      .max(10000, 'Maximum 10,000 items per request'),
    
    timestamp: iso8601Schema,
  })
  // Business rule: Must have at least one item
  .refine(
    (data: any) => {
      return data.items && data.items.length > 0;
    },
    {
      message: 'Adjustment must include at least one item',
      path: ['items'],
    }
  );

export type AdjustmentBatchRequestInput = z.infer<typeof adjustmentBatchRequestSchema>;

// =============================================================================
// VALIDATION FUNCTION
// =============================================================================

/**
 * Validation error detail
 */
interface ValidationErrorDetail {
  location: 'header' | 'item';
  field: string;
  code: string;
  message: string;
  item_index?: number;
  item_code?: string;
}

/**
 * Validation result
 */
interface ValidationResult {
  success: boolean;
  data?: AdjustmentBatchRequestInput;
  errors?: ValidationErrorDetail[];
}

/**
 * Validate adjustment batch request
 * 
 * @param data - Request payload
 * @returns Validation result with detailed errors
 */
export function validateAdjustmentBatch(data: unknown): ValidationResult {
  const result = adjustmentBatchRequestSchema.safeParse(data);
  
  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }
  
  // Transform Zod errors to API error format
  const errors: ValidationErrorDetail[] = result.error.issues.map((err: any) => {
    const path = err.path.join('.');
    const isItemError = path.startsWith('items.');
    
    let itemIndex: number | undefined;
    let itemCode: string | undefined;
    let field = path;
    
    // Extract item index and field for item-level errors
    if (isItemError) {
      const match = path.match(/^items\.(\d+)\.(.+)$/);
      if (match) {
        itemIndex = parseInt(match[1], 10);
        field = match[2];
        
        // Get item_code if available
        if (typeof data === 'object' && data !== null && 'items' in data) {
          const items = (data as any).items;
          if (Array.isArray(items) && items[itemIndex]) {
            itemCode = items[itemIndex].item_code;
          }
        }
      }
    }
    
    return {
      location: isItemError ? ('item' as const) : ('header' as const),
      field,
      code: err.code === 'custom' ? 'INVALID_VALUE' : err.code.toUpperCase(),
      message: err.message,
      ...(itemIndex !== undefined && { item_index: itemIndex }),
      ...(itemCode && { item_code: itemCode }),
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
export async function validateItemTypes(data: AdjustmentBatchRequestInput): Promise<ValidationErrorDetail[]> {
  const errors: ValidationErrorDetail[] = [];

  // Collect unique item_types
  const itemTypes = [...new Set(data.items.map(item => item.item_type))];

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

    // Check each item's item_type
    data.items.forEach((item, itemIndex) => {
      if (!validCodes.has(item.item_type)) {
        errors.push({
          location: 'item',
          field: 'item_type',
          code: 'INVALID_ITEM_TYPE',
          message: `Item type ${item.item_type} is not valid or not active`,
          item_index: itemIndex,
          item_code: item.item_code,
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
 * Check for duplicate items in the request
 * Combination: (item_code, item_name, uom)
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if no duplicates)
 */
export function checkAdjustmentDuplicates(data: AdjustmentBatchRequestInput): ValidationErrorDetail[] {
  const errors = checkDuplicateItems(
    data.items.map(item => ({
      item_code: item.item_code,
      item_name: item.item_name,
      uom: item.uom,
    })),
    'adjustment'
  );

  // Convert generic duplicate errors to adjustment format
  return errors.map(err => ({
    location: 'item' as const,
    field: err.field,
    code: err.code,
    message: err.message,
    item_index: err.item_index,
    item_code: err.item_code,
  }));
}

/**
 * Validate item_type consistency against existing stock_daily_snapshot records
 *
 * @param data - Validated request data
 * @returns Array of validation errors
 */
export async function validateAdjustmentItemTypeConsistency(
  data: AdjustmentBatchRequestInput
): Promise<ValidationErrorDetail[]> {
  const itemErrors = await validateItemTypeConsistency(
    data.company_code,
    data.items.map(item => ({
      item_type: item.item_type,
      item_code: item.item_code,
      item_name: item.item_name,
    }))
  );

  // Convert generic consistency errors to adjustment format
  return itemErrors.map(err => ({
    location: 'item' as const,
    field: err.field,
    code: err.code,
    message: err.message,
    item_index: err.item_index,
    item_code: err.item_code,
  }));
}
