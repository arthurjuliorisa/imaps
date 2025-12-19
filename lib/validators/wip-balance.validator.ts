import { z } from 'zod';
import { isValidDateFormat } from '../utils/date.util';

/**
 * Zod schemas for WIP Balance validation
 * 
 * Pattern aligned with Incoming Goods validator
 * - Two-step validation: Schema + Business Logic
 * - Schema validation returns field-specific errors
 * - Business validation checks database constraints
 */

const WIPBalanceRecordSchema = z.object({
  wms_id: z.string().min(1).max(100),
  company_code: z.number().int().refine((val) => [1370, 1310, 1380].includes(val), {
    message: 'Company code must be 1370, 1310, or 1380',
  }),
  item_type: z.string().min(1).max(10),
  item_code: z.string().min(1).max(50),
  item_name: z.string().min(1).max(200),
  stock_date: z.string().refine(isValidDateFormat, {
    message: 'Date must be in YYYY-MM-DD format',
  }),
  uom: z.string().min(1).max(20),
  qty: z
    .number()
    .nonnegative('Quantity must be greater than or equal to 0')
    .multipleOf(0.001, 'Quantity can have maximum 3 decimal places'),
  timestamp: z
    .string()
    .refine(
      (dateStr) => {
        try {
          // Must contain 'T' to separate date and time
          if (!dateStr.includes('T')) {
            return false;
          }
          
          // Try parsing with Date constructor
          const date = new Date(dateStr);
          if (isNaN(date.getTime())) {
            return false;
          }
          
          // Must contain timezone info (Z or +/-HH:MM)
          const hasTimezone = /Z$/.test(dateStr) || /[+-]\d{2}:\d{2}$/.test(dateStr) || /[+-]\d{4}$/.test(dateStr);
          
          return hasTimezone;
        } catch {
          return false;
        }
      },
      { message: 'Timestamp must be ISO 8601 format with timezone (e.g., 2025-11-27T17:00:00Z or 2025-11-27T17:00:00+07:00)' }
    ),
});

export const WIPBalanceBatchSchema = z.object({
  records: z
    .array(WIPBalanceRecordSchema)
    .min(1, 'At least one record is required')
    .refine(
      (records) => {
        const wmsIds = records.map((r) => r.wms_id);
        const uniqueWmsIds = new Set(wmsIds);
        return wmsIds.length === uniqueWmsIds.size;
      },
      {
        message: 'Duplicate wms_id found in records',
      }
    ),
});

export type WIPBalanceRecordInput = z.infer<typeof WIPBalanceRecordSchema>;
export type WIPBalanceBatchInput = z.infer<typeof WIPBalanceBatchSchema>;

/**
 * Validated WIP Balance record (after schema validation)
 * Used internally in service layer
 */
export interface WIPBalanceRecordValidated extends WIPBalanceRecordInput {
  stock_date: string; // Keep as string for now, convert in service
  timestamp: string;
}

/**
 * Validated batch
 */
export interface WIPBalanceBatchValidated {
  records: WIPBalanceRecordValidated[];
}

/**
 * Batch validation error detail
 */
export interface BatchValidationError {
  location: string;
  field: string;
  code: string;
  message: string;
}

/**
 * Validate WIP Balance batch request
 * Returns detailed error information for batch processing
 */
export function validateWIPBalanceBatch(payload: unknown): {
  success: true;
  data: WIPBalanceBatchValidated;
} | {
  success: false;
  errors: BatchValidationError[];
} {
  const result = WIPBalanceBatchSchema.safeParse(payload);

  if (!result.success) {
    const errors: BatchValidationError[] = [];

    result.error.issues.forEach((err: z.ZodIssue) => {
      const pathParts = err.path || [];
      let recordIndex = 0;
      let field = 'batch';

      // Extract record index and field name from path
      if (pathParts.length > 0) {
        if (pathParts[0] === 'records' && typeof pathParts[1] === 'number') {
          recordIndex = pathParts[1];
          field = (pathParts[2] as string) || 'unknown';
        } else {
          field = pathParts.join('.');
        }
      }

      errors.push({
        location: recordIndex === 0 && !field ? 'batch' : `records[${recordIndex}]`,
        field,
        code: err.code === 'invalid_type' ? 'TYPE_MISMATCH' : 'VALIDATION_ERROR',
        message: err.message,
      });
    });

    return { success: false, errors };
  }

  return { success: true, data: result.data as WIPBalanceBatchValidated };
}
