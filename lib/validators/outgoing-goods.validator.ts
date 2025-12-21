import { z } from 'zod';
import { transformZodErrors } from '@/lib/utils/error-transformer';

/**
 * Zod schemas for Outgoing Goods validation
 */

const CustomsDocumentTypeSchema = z.enum(['BC30', 'BC25', 'BC27'], {
  message: 'Customs document type must be one of: BC30, BC25, BC27',
});

const CurrencySchema = z.enum(['USD', 'IDR', 'CNY', 'EUR', 'JPY'], {
  message: 'Currency must be one of: USD, IDR, CNY, EUR, JPY',
});

const OutgoingGoodsItemSchema = z.object({
  item_type: z.string().max(10, 'Item type must be no more than 10 characters'),
  item_code: z.string().min(1, 'Item code is required').max(50, 'Item code must be no more than 50 characters'),
  item_name: z.string().min(1, 'Item name is required').max(200, 'Item name must be no more than 200 characters'),
  production_output_wms_ids: z.array(z.string().min(1)).optional().nullable(),
  hs_code: z.string().max(20, 'HS code must be no more than 20 characters').optional().nullable(),
  uom: z.string().min(1, 'UOM is required').max(20, 'UOM must be no more than 20 characters'),
  qty: z.number().positive('Quantity must be greater than 0'),
  currency: CurrencySchema,
  amount: z.number().nonnegative('Amount must be greater than or equal to 0'),
});

const outgoingGoodsRequestSchema = z.object({
  wms_id: z.string().min(1, 'WMS ID is required').max(100, 'WMS ID must be no more than 100 characters'),
  company_code: z.number().int('Company code must be an integer').refine(
    (code) => [1370, 1310, 1380].includes(code),
    'Company code must be one of: 1370, 1310, or 1380'
  ),
  owner: z.number().int('Owner must be an integer').refine(
    (owner) => [1370, 1310, 1380].includes(owner),
    'Owner must be one of: 1370, 1310, or 1380'
  ),
  customs_document_type: CustomsDocumentTypeSchema,
  ppkek_number: z.string().min(1, 'PPKEK number is required for all outgoing transactions').max(50, 'PPKEK number must be no more than 50 characters'),
  customs_registration_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Customs registration date must be in YYYY-MM-DD format'),
  outgoing_evidence_number: z.string().min(1, 'Outgoing evidence number is required').max(50, 'Outgoing evidence number must be no more than 50 characters'),
  outgoing_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Outgoing date must be in YYYY-MM-DD format'),
  invoice_number: z.string().min(1, 'Invoice number is required').max(50, 'Invoice number must be no more than 50 characters'),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invoice date must be in YYYY-MM-DD format'),
  recipient_name: z.string().min(1, 'Recipient name is required').max(200, 'Recipient name must be no more than 200 characters'),
  items: z.array(OutgoingGoodsItemSchema).min(1, 'At least one item is required'),
  timestamp: z.string().refine(
    (val) => {
      try {
        const date = new Date(val);
        return !isNaN(date.getTime());
      } catch {
        return false;
      }
    },
    { message: 'Timestamp must be a valid ISO 8601 datetime string' }
  ),
});

export type OutgoingGoodsRequest = z.infer<typeof outgoingGoodsRequestSchema>;

export interface ValidationErrorDetail {
  location: 'header' | 'item';
  field: string;
  code: string;
  message: string;
  item_index?: number;
  item_code?: string;
}

export interface ValidationResult {
  success: boolean;
  data?: OutgoingGoodsRequest;
  errors?: ValidationErrorDetail[];
}

/**
 * Validate outgoing goods request
 *
 * @param data - Request payload
 * @returns Validation result with detailed errors
 */
export function validateOutgoingGoodsRequest(data: unknown): ValidationResult {
  const result = outgoingGoodsRequestSchema.safeParse(data);

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  // Transform Zod errors to API error format
  const errors = transformZodErrors(result.error);

  // Map to our ValidationErrorDetail format and add item_code if available
  const validationErrors: ValidationErrorDetail[] = errors.map((err: any) => {
    let itemCode: string | undefined;

    // Try to extract item_code from data if it's an item error
    if (err.location === 'item' && err.item_index !== undefined) {
      if (typeof data === 'object' && data !== null && 'items' in data) {
        const items = (data as any).items;
        if (Array.isArray(items) && items[err.item_index]) {
          itemCode = items[err.item_index].item_code;
        }
      }
    }

    return {
      location: err.location,
      field: err.field,
      code: err.code,
      message: err.message,
      ...(err.item_index !== undefined && { item_index: err.item_index }),
      ...(itemCode && { item_code: itemCode }),
    };
  });

  return {
    success: false,
    errors: validationErrors,
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
export function validateOutgoingGoodsDates(data: OutgoingGoodsRequest): ValidationErrorDetail[] {
  const errors: ValidationErrorDetail[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Parse dates
  const outgoingDate = new Date(data.outgoing_date);
  const customsRegDate = new Date(data.customs_registration_date);
  const invoiceDate = new Date(data.invoice_date);

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
export function validateProductionTraceability(data: OutgoingGoodsRequest): ValidationErrorDetail[] {
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
