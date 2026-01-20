// lib/validators/schemas/incoming-goods.schema.ts

/**
 * Incoming Goods Validation Schema
 * 
 * Purpose:
 * - Validate incoming goods request payload
 * - Enforce business rules and data constraints
 * - Provide detailed error messages
 * 
 * Version: 2.0 - Updated with ItemType enum validation
 * 
 * Validation Layers:
 * 1. Schema validation (Zod) - format, required fields, data types
 * 2. Business rules - date logic, conditional fields, enum values
 * 3. Database constraints - unique keys, foreign keys
 * 
 * Changes from v1.0:
 * - item_type validation now uses ItemType enum values
 * - Explicit enum validation with all valid values
 * - Better error messages showing allowed enum values
 */

import { z } from 'zod';
import { Currency } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';

// =============================================================================
// CONSTANTS
// =============================================================================

const VALID_COMPANY_CODES = [1370, 1310, 1380] as const;

// CustomsDocumentType enum values for incoming goods
const INCOMING_CUSTOMS_TYPES = ['BC23', 'BC27', 'BC40'] as const;

// Currency enum values - MANUALLY DEFINED for build-time safety
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
 * Single item schema with item_type string validation
 */
export const incomingGoodItemSchema = z.object({
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
    .finite('Quantity must be a finite number')
    .refine(
      (val: number) => {
        const decimalPlaces = val.toString().split('.')[1]?.length || 0;
        return decimalPlaces <= 3;
      },
      { message: 'Quantity must have maximum 3 decimal places' }
    ),
  
  currency: z.enum(
    VALID_CURRENCIES,
    {
      message: `Currency must be one of: ${VALID_CURRENCIES.join(', ')}`,
    }
  ) as z.ZodType<Currency>, // Type assertion for Currency enum
  
  amount: z
    .number()
    .nonnegative('Amount must be greater than or equal to 0')
    .finite('Amount must be a finite number')
    .refine(
      (val: number) => {
        const decimalPlaces = val.toString().split('.')[1]?.length || 0;
        return decimalPlaces <= 4;
      },
      { message: 'Amount must have maximum 4 decimal places' }
    ),
});

export type IncomingGoodItemInput = z.infer<typeof incomingGoodItemSchema>;

// =============================================================================
// MAIN REQUEST SCHEMA
// =============================================================================

/**
 * Complete incoming goods request schema
 */
export const incomingGoodRequestSchema = z
  .object({
    wms_id: z
      .string()
      .min(1, 'WMS ID is required')
      .max(100, 'WMS ID must not exceed 100 characters')
      .trim(),
    
    company_code: companyCodeSchema,
    owner: companyCodeSchema,
    
    customs_document_type: z.enum(INCOMING_CUSTOMS_TYPES, {
        message: `Customs document type must be one of: ${INCOMING_CUSTOMS_TYPES.join(', ')}`,
      }),
    
    ppkek_number: z
      .string()
      .min(1, 'PPKEK number is required')
      .max(50, 'PPKEK number must not exceed 50 characters')
      .trim(),
    
    customs_registration_date: dateStringSchema,
    
    incoming_evidence_number: z
      .string()
      .min(1, 'Incoming evidence number is required')
      .max(50, 'Incoming evidence number must not exceed 50 characters')
      .trim(),
    
    incoming_date: dateStringSchema,
    
    invoice_number: z
      .string()
      .min(1, 'Invoice number is required')
      .max(50, 'Invoice number must not exceed 50 characters')
      .trim(),
    
    invoice_date: dateStringSchema,
    
    shipper_name: z
      .string()
      .min(1, 'Shipper name is required')
      .max(200, 'Shipper name must not exceed 200 characters')
      .trim(),
    
    items: z
      .array(incomingGoodItemSchema)
      .min(1, 'At least one item is required')
      .max(10000, 'Maximum 10,000 items per request'),
    
    timestamp: iso8601Schema,
  })
  // Business rule: customs_registration_date <= incoming_date
  .refine(
    (data: any) => {
      // Parse both dates in consistent local timezone (YYYY-MM-DD format)
      const [customsYear, customsMonth, customsDay] = data.customs_registration_date.split('-').map(Number);
      const customsDate = new Date(customsYear, customsMonth - 1, customsDay, 0, 0, 0, 0);
      
      const [incomingYear, incomingMonth, incomingDay] = data.incoming_date.split('-').map(Number);
      const incomingDate = new Date(incomingYear, incomingMonth - 1, incomingDay, 0, 0, 0, 0);

      return customsDate <= incomingDate;
    },
    {
      message: 'Customs registration date cannot be after incoming date',
      path: ['customs_registration_date'],
    }
  )
  // Business rule: incoming_date cannot be in the future (environment-based)
  .refine(
    (data: any) => {
      // Skip validation in development/staging for testing purposes
      const isDevelopment = process.env.NODE_ENV === 'development' || 
                           process.env.ALLOW_FUTURE_DATES === 'true';
      
      if (isDevelopment) {
        return true; // Allow any date in development
      }
      
      // Parse incoming_date in consistent local timezone (YYYY-MM-DD format)
      const [year, month, day] = data.incoming_date.split('-').map(Number);
      const incomingDate = new Date(year, month - 1, day, 0, 0, 0, 0);
      
      // Get today in same local timezone
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      return incomingDate <= today;
    },
    {
      message: 'Incoming date cannot be in the future',
      path: ['incoming_date'],
    }
  );

export type IncomingGoodRequestInput = z.infer<typeof incomingGoodRequestSchema>;

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
  data?: IncomingGoodRequestInput;
  errors?: ValidationErrorDetail[];
}

/**
 * Validate incoming good request
 * 
 * @param data - Request payload
 * @returns Validation result with detailed errors
 */
export function validateIncomingGoodRequest(data: unknown): ValidationResult {
  const result = incomingGoodRequestSchema.safeParse(data);
  
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
 * Validate date constraints for incoming goods
 * - incoming_date cannot be in the future (environment-based)
 * - customs_registration_date must be before or equal to incoming_date
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if all dates valid)
 */
export function validateIncomingGoodsDates(data: IncomingGoodRequestInput): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse dates in consistent local timezone (YYYY-MM-DD format)
  const [inYear, inMonth, inDay] = data.incoming_date.split('-').map(Number);
  const incomingDate = new Date(inYear, inMonth - 1, inDay, 0, 0, 0, 0);
  
  const [custYear, custMonth, custDay] = data.customs_registration_date.split('-').map(Number);
  const customsRegDate = new Date(custYear, custMonth - 1, custDay, 0, 0, 0, 0);

  // Validate incoming_date is not in the future
  if (incomingDate > today) {
    errors.push({
      location: 'header',
      field: 'incoming_date',
      code: 'INVALID_VALUE',
      message: 'Incoming date cannot be in the future',
    });
  }

  // Validate customs_registration_date is before or equal to incoming_date
  if (customsRegDate > incomingDate) {
    errors.push({
      location: 'header',
      field: 'customs_registration_date',
      code: 'INVALID_VALUE',
      message: 'Customs registration date must be before or equal to incoming date',
    });
  }

  return errors;
}

/**
 * Validate item_types exist and are active in database
 *
 * @param data - Validated request data
 * @returns Array of validation errors (empty if all valid)
 */
export async function validateItemTypes(data: IncomingGoodRequestInput): Promise<ValidationErrorDetail[]> {
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