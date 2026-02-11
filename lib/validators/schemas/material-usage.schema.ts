// lib/validators/schemas/material-usage.schema.ts

/**
 * Material Usage Validation Schema
 * 
 * Purpose:
 * - Validate material usage request payload
 * - Support ROH/HALB with work_order_number
 * - Support production support items (FERT, HIBE) with cost_center_number
 * - Support reversal transactions
 * - Optional PPKEK traceability
 */

import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { checkDuplicateMaterialUsageItems } from '@/lib/validators/duplicate-item.validator';
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
 * Single material usage item schema
 */
export const materialUsageItemSchema = z.object({
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
  
  ppkek_number: z
    .string()
    .trim()
    .max(50, 'PPKEK number must not exceed 50 characters')
    .nullable()
    .optional(),
});

export type MaterialUsageItemInput = z.infer<typeof materialUsageItemSchema>;

// =============================================================================
// BATCH REQUEST SCHEMA
// =============================================================================

/**
 * Material usage batch request schema
 */
export const materialUsageBatchRequestSchema = z
  .object({
    wms_id: z
      .string()
      .min(1, 'WMS ID is required')
      .max(100, 'WMS ID must not exceed 100 characters')
      .trim(),
    
    company_code: companyCodeSchema,
    owner: companyCodeSchema,
    
    work_order_number: z
      .string()
      .trim()
      .max(50, 'Work order number must not exceed 50 characters')
      .nullable()
      .optional(),
    
    cost_center_number: z
      .string()
      .trim()
      .nullable()
      .optional(),
    
    internal_evidence_number: z
      .string()
      .min(1, 'Internal evidence number is required')
      .max(50, 'Internal evidence number must not exceed 50 characters')
      .trim(),
    
    transaction_date: transactionDateSchema,
    
    reversal: z.enum(['Y']).nullable().optional(),
    
    items: z
      .array(materialUsageItemSchema)
      .min(1, 'At least one item is required')
      .max(10000, 'Maximum 10,000 items per request'),
    
    timestamp: iso8601Schema,
  })
  // Business rule: ROH/HALB must have work_order_number
  .refine(
    (data: any) => {
      const hasRohOrHalb = data.items.some((item: any) =>
        ['ROH', 'HALB'].includes(item.item_type.toUpperCase())
      );
      if (hasRohOrHalb && !data.work_order_number) {
        return false;
      }
      return true;
    },
    {
      message: 'Work order number is required when using ROH or HALB items',
      path: ['work_order_number'],
    }
  )
  // Business rule: Production support must have cost_center_number
  .refine(
    (data: any) => {
      const hasProductionSupport = data.items.some((item: any) =>
        ['FERT', 'HIBE', 'HIBE-M', 'HIBE-E', 'HIBE-T'].includes(item.item_type.toUpperCase())
      );
      if (hasProductionSupport && !data.cost_center_number) {
        return false;
      }
      return true;
    },
    {
      message: 'Cost center number is required for production support items (FERT, HIBE, etc.)',
      path: ['cost_center_number'],
    }
  )
  // Business rule: Cannot use both work_order and cost_center
  .refine(
    (data: any) => {
      if (data.work_order_number && data.cost_center_number) {
        return false;
      }
      return true;
    },
    {
      message: 'Cannot use both work order number and cost center number',
      path: ['work_order_number'],
    }
  )
  // Business rule: Reversal must have items
  .refine(
    (data: any) => {
      if (data.reversal === 'Y' && (!data.items || data.items.length === 0)) {
        return false;
      }
      return true;
    },
    {
      message: 'Reversal transaction must include at least one item',
      path: ['items'],
    }
  );

export type MaterialUsageBatchRequestInput = z.infer<typeof materialUsageBatchRequestSchema>;

// =============================================================================
// VALIDATION FUNCTION
// =============================================================================

/**
 * Validation error detail
 */
export interface ValidationErrorDetail {
  location: 'header' | 'item';
  field: string;
  code: string;
  message: string;
  item_index?: number;
  item_code?: string;
}

// Type alias for backward compatibility
export type BatchValidationError = ValidationErrorDetail;

/**
 * Validation result
 */
interface ValidationResult {
  success: boolean;
  data?: MaterialUsageBatchRequestInput;
  errors?: ValidationErrorDetail[];
}

/**
 * Validate material usage batch request
 * 
 * @param data - Request payload
 * @returns Validation result with detailed errors
 */
export function validateMaterialUsageBatch(data: unknown): ValidationResult {
  const result = materialUsageBatchRequestSchema.safeParse(data);
  
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
export async function validateItemTypes(data: MaterialUsageBatchRequestInput): Promise<ValidationErrorDetail[]> {
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
 * Combination: (item_code, item_name, uom, ppkek_number)
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if no duplicates)
 */
export function checkMaterialUsageDuplicates(data: MaterialUsageBatchRequestInput): ValidationErrorDetail[] {
  return checkDuplicateMaterialUsageItems(
    data.items.map(item => ({
      item_code: item.item_code,
      item_name: item.item_name,
      uom: item.uom,
      ppkek_number: item.ppkek_number ?? undefined,
    }))
  );
}

/**
 * Validate item_type consistency against existing stock_daily_snapshot records
 *
 * @param data - Validated request data
 * @returns Array of validation errors
 */
export async function validateMaterialUsageItemTypeConsistency(
  data: MaterialUsageBatchRequestInput
): Promise<ValidationErrorDetail[]> {
  return validateItemTypeConsistency(
    data.company_code,
    data.items.map(item => ({
      item_type: item.item_type,
      item_code: item.item_code,
      item_name: item.item_name,
    }))
  );
}
