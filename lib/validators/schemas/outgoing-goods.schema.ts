// lib/validators/schemas/outgoing-goods.schema.ts

/**
 * Outgoing Goods Validation Schema
 * 
 * Purpose:
 * - Validate outgoing goods request payload
 * - Enforce business rules and data constraints
 * - Provide detailed error messages
 * 
 * Version: 1.0 - Unified schema-based validation
 * 
 * Validation Layers:
 * 1. Schema validation (Zod) - format, required fields, data types
 * 2. Business rules - date logic, conditional fields, enum values
 * 3. Database constraints - foreign keys, traceability
 * 
 * Pattern: Aligned with Incoming Goods schema
 */

import { z } from 'zod';
import { Currency } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

// =============================================================================
// CONSTANTS
// =============================================================================

const VALID_COMPANY_CODES = [1370, 1310, 1380] as const;

// CustomsDocumentType enum values for outgoing goods
const OUTGOING_CUSTOMS_TYPES = ['BC30', 'BC25', 'BC27'] as const;

// Currency enum values
const VALID_CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'] as const;

// =============================================================================
// REUSABLE SCHEMAS
// =============================================================================

/**
 * Date string schema (YYYY-MM-DD format)
 */
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(
    (dateStr: string) => {
      const date = new Date(dateStr);
      return !isNaN(date.getTime());
    },
    { message: 'Invalid date value' }
  );

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
 * Company code schema
 */
const companyCodeSchema = z
  .number()
  .int('Company code must be an integer')
  .refine(
    (code: number) => VALID_COMPANY_CODES.includes(code as any),
    {
      message: `Company code must be one of: ${VALID_COMPANY_CODES.join(', ')}`,
    }
  );

// =============================================================================
// ITEM SCHEMA
// =============================================================================

/**
 * Single item schema for outgoing goods
 */
export const outgoingGoodItemSchema = z.object({
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
  
  production_output_wms_ids: z
    .array(z.string().min(1, 'WMS ID cannot be empty'))
    .optional()
    .nullable(),
  
  ppkek_number: z
    .array(z.string().min(1, 'PPKEK number cannot be empty').max(50, 'PPKEK number must not exceed 50 characters'))
    .optional()
    .nullable(),
  
  hs_code: z
    .string()
    .max(20, 'HS code must not exceed 20 characters')
    .trim()
    .nullable()
    .optional(),
  
  uom: z
    .string()
    .min(1, 'UOM is required')
    .max(20, 'UOM must not exceed 20 characters')
    .trim(),
  
  qty: z
    .number()
    .positive('Quantity must be greater than 0')
    .finite('Quantity must be a finite number'),
  
  currency: z.enum(
    VALID_CURRENCIES,
    {
      message: `Currency must be one of: ${VALID_CURRENCIES.join(', ')}`,
    }
  ) as z.ZodType<Currency>,
  
  amount: z
    .number()
    .nonnegative('Amount must be greater than or equal to 0')
    .finite('Amount must be a finite number'),
});

export type OutgoingGoodItemInput = z.infer<typeof outgoingGoodItemSchema>;

// =============================================================================
// MAIN REQUEST SCHEMA
// =============================================================================

/**
 * Complete outgoing goods request schema
 */
export const outgoingGoodRequestSchema = z
  .object({
    wms_id: z
      .string()
      .min(1, 'WMS ID is required')
      .max(100, 'WMS ID must not exceed 100 characters')
      .trim(),
    
    company_code: companyCodeSchema,
    owner: companyCodeSchema,
    
    customs_document_type: z.enum(OUTGOING_CUSTOMS_TYPES, {
        message: `Customs document type must be one of: ${OUTGOING_CUSTOMS_TYPES.join(', ')}`,
      }),
    
    ppkek_number: z
      .string()
      .min(1, 'PPKEK number is required')
      .max(50, 'PPKEK number must not exceed 50 characters')
      .trim(),
    
    customs_registration_date: dateStringSchema,
    
    outgoing_evidence_number: z
      .string()
      .min(1, 'Outgoing evidence number is required')
      .max(50, 'Outgoing evidence number must not exceed 50 characters')
      .trim(),
    
    outgoing_date: dateStringSchema,
    
    invoice_number: z
      .string()
      .min(1, 'Invoice number is required')
      .max(50, 'Invoice number must not exceed 50 characters')
      .trim(),
    
    invoice_date: dateStringSchema,
    
    recipient_name: z
      .string()
      .min(1, 'Recipient name is required')
      .max(200, 'Recipient name must not exceed 200 characters')
      .trim(),
    
    items: z
      .array(outgoingGoodItemSchema)
      .min(1, 'At least one item is required')
      .max(10000, 'Maximum 10,000 items per request'),
    
    timestamp: iso8601Schema,
  })
  // Business rule: customs_registration_date <= outgoing_date
  .refine(
    (data: any) => {
      const customsDate = new Date(data.customs_registration_date);
      const outgoingDate = new Date(data.outgoing_date);
      return customsDate <= outgoingDate;
    },
    {
      message: 'Customs registration date cannot be after outgoing date',
      path: ['customs_registration_date'],
    }
  )
  // Business rule: outgoing_date cannot be in the future
  .refine(
    (data: any) => {
      const isDevelopment = process.env.NODE_ENV === 'development' || 
                           process.env.ALLOW_FUTURE_DATES === 'true';
      
      if (isDevelopment) {
        return true;
      }
      
      const outgoingDate = new Date(data.outgoing_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      return outgoingDate <= today;
    },
    {
      message: 'Outgoing date cannot be in the future',
      path: ['outgoing_date'],
    }
  );

export type OutgoingGoodRequestInput = z.infer<typeof outgoingGoodRequestSchema>;

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

/**
 * Validation result
 */
export interface ValidationResult {
  success: boolean;
  data?: OutgoingGoodRequestInput;
  errors?: ValidationErrorDetail[];
}

/**
 * Validate outgoing good request
 * 
 * @param data - Request payload
 * @returns Validation result with detailed errors
 */
export function validateOutgoingGoodRequest(data: unknown): ValidationResult {
  const result = outgoingGoodRequestSchema.safeParse(data);
  
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
 * Validate date constraints for outgoing goods
 * - outgoing_date cannot be in the future
 * - customs_registration_date must be before or equal to outgoing_date
 * - invoice_date should be valid
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if all dates valid)
 */
export function validateOutgoingGoodsDates(data: OutgoingGoodRequestInput): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse dates
  const outgoingDate = new Date(data.outgoing_date);
  const customsRegDate = new Date(data.customs_registration_date);

  // Validate outgoing_date is not in the future
  if (outgoingDate > today) {
    errors.push({
      location: 'header',
      field: 'outgoing_date',
      code: 'INVALID_VALUE',
      message: 'Outgoing date cannot be in the future',
    });
  }

  // Validate customs_registration_date is before or equal to outgoing_date
  if (customsRegDate > outgoingDate) {
    errors.push({
      location: 'header',
      field: 'customs_registration_date',
      code: 'INVALID_VALUE',
      message: 'Customs registration date must be before or equal to outgoing date',
    });
  }

  return errors;
}

/**
 * Validate conditional production_output_wms_ids for FERT and HALB items
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if all valid)
 */
export function validateProductionTraceability(data: OutgoingGoodRequestInput): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];

  data.items.forEach((item, itemIndex) => {
    // For FERT and HALB items, production_output_wms_ids is REQUIRED
    if (['FERT', 'HALB'].includes(item.item_type.toUpperCase())) {
      if (!item.production_output_wms_ids || item.production_output_wms_ids.length === 0) {
        errors.push({
          location: 'item',
          field: 'production_output_wms_ids',
          code: 'MISSING_REQUIRED',
          message: 'Production output WMS IDs required for finished goods',
          item_index: itemIndex,
          item_code: item.item_code,
        });
      }
    }
  });

  return errors;
}

/**
 * Validate item_types exist and are active in database
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if all valid)
 */
export async function validateItemTypes(data: OutgoingGoodRequestInput): Promise<ValidationErrorDetail[]> {
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
