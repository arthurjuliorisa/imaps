import { z } from 'zod';
import { isValidDateFormat, isFutureDate, parseDateString } from '../utils/date.util';
import type { ErrorDetail } from '../types/api-response';

/**
 * Zod schemas for Incoming Goods validation
 */

const CustomsDocumentTypeSchema = z.enum(['BC23', 'BC27', 'BC40'], {
  message: 'Must be BC23, BC27, or BC40',
});

const CurrencySchema = z.enum(['USD', 'IDR', 'CNY', 'EUR', 'JPY'], {
  message: 'Must be USD, IDR, CNY, EUR, or JPY',
});

const IncomingGoodsItemSchema = z.object({
  item_type: z.string().min(1).max(10),
  item_code: z.string().min(1).max(50),
  item_name: z.string().min(1).max(200),
  hs_code: z.string().max(20).nullable().optional(),
  uom: z.string().min(1).max(20),
  qty: z
    .number()
    .positive('Quantity must be greater than 0')
    .multipleOf(0.001, 'Quantity can have maximum 3 decimal places'),
  currency: CurrencySchema,
  amount: z
    .number()
    .nonnegative('Amount must be greater than or equal to 0')
    .multipleOf(0.0001, 'Amount can have maximum 4 decimal places'),
});

export const IncomingGoodsRequestSchema = z.object({
  wms_id: z.string().min(1).max(100),
  company_code: z.number().int().refine((val) => [1370, 1310, 1380].includes(val), {
    message: 'Company code must be 1370, 1310, or 1380',
  }),
  owner: z.number().int().refine((val) => [1370, 1310, 1380].includes(val), {
    message: 'Owner must be 1370, 1310, or 1380',
  }),
  customs_document_type: CustomsDocumentTypeSchema,
  ppkek_number: z.string().min(1).max(50),
  customs_registration_date: z.string().refine(isValidDateFormat, {
    message: 'Date must be in YYYY-MM-DD format',
  }),
  incoming_evidence_number: z.string().min(1).max(50),
  incoming_date: z.string().refine(isValidDateFormat, {
    message: 'Date must be in YYYY-MM-DD format',
  }),
  invoice_number: z.string().min(1).max(50),
  invoice_date: z.string().refine(isValidDateFormat, {
    message: 'Date must be in YYYY-MM-DD format',
  }),
  shipper_name: z.string().min(1).max(200),
  items: z.array(IncomingGoodsItemSchema).min(1, 'At least 1 item is required'),
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

export type IncomingGoodsValidated = z.infer<typeof IncomingGoodsRequestSchema>;

/**
 * Business validation (beyond schema)
 */
export const validateIncomingGoodsBusiness = (
  data: IncomingGoodsValidated
): ErrorDetail[] => {
  const errors: ErrorDetail[] = [];

  // Check if incoming_date is not in future
  if (isFutureDate(data.incoming_date)) {
    errors.push({
      location: 'header',
      field: 'incoming_date',
      code: 'FUTURE_DATE_NOT_ALLOWED',
      message: 'Incoming date cannot be in the future',
    });
  }

  // Check if customs_registration_date <= incoming_date
  const customsDate = parseDateString(data.customs_registration_date);
  const incomingDate = parseDateString(data.incoming_date);
  
  if (customsDate > incomingDate) {
    errors.push({
      location: 'header',
      field: 'customs_registration_date',
      code: 'INVALID_DATE',
      message: 'Customs registration date cannot be after incoming date',
    });
  }

  // Validate each item
  data.items.forEach((item, index) => {
    // Additional item validations can be added here
    // For example: check if item_code exists in master data (done in service layer)
  });

  return errors;
};

/**
 * Main validation function
 */
export const validateIncomingGoods = (
  payload: unknown
): { success: true; data: IncomingGoodsValidated } | { success: false; errors: ErrorDetail[] } => {
  // Schema validation
  const schemaResult = IncomingGoodsRequestSchema.safeParse(payload);
  
  if (!schemaResult.success) {
    const errors: ErrorDetail[] = schemaResult.error.issues.map((err) => {
      const path = err.path.join('.');
      const isItemError = path.startsWith('items.');
      
      if (isItemError) {
        const match = path.match(/items\.(\d+)\.(.+)/);
        const itemIndex = match ? parseInt(match[1]) : 0;
        const field = match ? match[2] : path;
        
        return {
          location: 'item' as const,
          item_index: itemIndex,
          field,
          code: 'INVALID_FORMAT',
          message: err.message,
        };
      }
      
      return {
        location: 'header' as const,
        field: path,
        code: 'INVALID_FORMAT',
        message: err.message,
      };
    });
    
    return { success: false, errors };
  }

  // Business validation
  const businessErrors = validateIncomingGoodsBusiness(schemaResult.data);
  
  if (businessErrors.length > 0) {
    return { success: false, errors: businessErrors };
  }

  return { success: true, data: schemaResult.data };
};