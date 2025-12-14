// lib/validators/schemas/incoming-goods.schema.ts

/**
 * Incoming Goods Validation Schema
 * 
 * Purpose:
 * - Validate incoming goods request payload from WMS
 * - Enforce data types, formats, and business rules
 * - Provide clear error messages for validation failures
 * 
 * Based on: WMS-iMAPS API Contract v2.4 Section 5.1
 */

import { z } from 'zod';
import { CustomsDocumentType, ItemType, Currency } from '@prisma/client';

// ============================================================================
// CONSTANTS
// ============================================================================

const VALID_COMPANY_CODES = [1370, 1310, 1380];
const INCOMING_CUSTOMS_TYPES: CustomsDocumentType[] = ['BC23', 'BC27', 'BC40'];

// All item types are supported (no restrictions per API Contract v2.4)
const ALL_ITEM_TYPES: ItemType[] = [
  'ROH',
  'HALB',
  'FERT',
  'HIBE',
  'HIBE_M',
  'HIBE_E',
  'HIBE_T',
  'DIEN',
  'SCRAP',
];

const ALL_CURRENCIES: Currency[] = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];

// ============================================================================
// HELPER SCHEMAS
// ============================================================================

/**
 * Date string schema (YYYY-MM-DD format)
 */
const dateStringSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
  .refine(
    (dateStr) => {
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
    (dateStr) => {
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
    (code) => VALID_COMPANY_CODES.includes(code),
    {
      message: `Company code must be one of: ${VALID_COMPANY_CODES.join(', ')}`,
    }
  );

// ============================================================================
// ITEM SCHEMA
// ============================================================================

/**
 * Single item validation schema
 */
export const incomingGoodItemSchema = z.object({
  item_type: z.enum(ALL_ITEM_TYPES as [ItemType, ...ItemType[]], {
    message: `Item type must be one of: ${ALL_ITEM_TYPES.join(', ')}`,
  }),
  
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
      (val) => {
        // Check max 3 decimal places
        const decimalPlaces = (val.toString().split('.')[1] || '').length;
        return decimalPlaces <= 3;
      },
      { message: 'Quantity must have at most 3 decimal places' }
    ),
  
  currency: z.enum(ALL_CURRENCIES as [Currency, ...Currency[]], {
    message: `Currency must be one of: ${ALL_CURRENCIES.join(', ')}`,
  }),
  
  amount: z
    .number()
    .nonnegative('Amount must be 0 or greater')
    .finite('Amount must be a finite number')
    .refine(
      (val) => {
        // Check max 4 decimal places
        const decimalPlaces = (val.toString().split('.')[1] || '').length;
        return decimalPlaces <= 4;
      },
      { message: 'Amount must have at most 4 decimal places' }
    ),
});

// ============================================================================
// HEADER SCHEMA
// ============================================================================

/**
 * Complete incoming goods request validation schema
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
    
    customs_document_type: z.enum(
      INCOMING_CUSTOMS_TYPES as [CustomsDocumentType, ...CustomsDocumentType[]],
      {
        message: `Customs document type must be one of: ${INCOMING_CUSTOMS_TYPES.join(', ')}`,
      }
    ),
    
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
  .refine(
    (data) => {
      // Business rule: incoming_date cannot be in the future
      // Skip validation in development/staging for testing purposes
      const isDevelopment = process.env.NODE_ENV === 'development' || 
                           process.env.ALLOW_FUTURE_DATES === 'true';
      
      if (isDevelopment) {
        return true; // Allow any date in development
      }
      
      const incomingDate = new Date(data.incoming_date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      return incomingDate <= today;
    },
    {
      message: 'Incoming date cannot be in the future',
      path: ['incoming_date'],
    }
  )
  .refine(
    (data) => {
      // Business rule: customs_registration_date <= incoming_date
      const customsDate = new Date(data.customs_registration_date);
      const incomingDate = new Date(data.incoming_date);
      
      return customsDate <= incomingDate;
    },
    {
      message: 'Customs registration date cannot be after incoming date',
      path: ['customs_registration_date'],
    }
  );

// ============================================================================
// TYPE EXPORTS (inferred from schemas)
// ============================================================================

export type IncomingGoodItemInput = z.infer<typeof incomingGoodItemSchema>;
export type IncomingGoodRequestInput = z.infer<typeof incomingGoodRequestSchema>;

// ============================================================================
// VALIDATION HELPER FUNCTION
// ============================================================================

/**
 * Validate incoming goods request and return detailed errors
 * 
 * @param data - Request payload to validate
 * @returns Validation result with structured errors
 */
export function validateIncomingGoodRequest(data: unknown): {
  success: boolean;
  data?: IncomingGoodRequestInput;
  errors?: Array<{
    location: 'header' | 'item';
    field: string;
    code: string;
    message: string;
    item_index?: number;
    item_code?: string;
  }>;
} {
  const result = incomingGoodRequestSchema.safeParse(data);
  
  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }
  
  // Transform Zod errors to API Contract error format
  const errors = result.error.issues.map((err) => {
    const path = err.path.join('.');
    const isItemError = path.startsWith('items.');
    
    // Extract item index if it's an item error
    let itemIndex: number | undefined;
    let itemCode: string | undefined;
    let field = path;
    
    if (isItemError) {
      const match = path.match(/^items\.(\d+)\.(.+)$/);
      if (match) {
        itemIndex = parseInt(match[1], 10);
        field = match[2];
        
        // Try to get item_code if available
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