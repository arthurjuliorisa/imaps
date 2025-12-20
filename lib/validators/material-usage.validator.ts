import { z } from 'zod';

/**
 * Material Usage API Validator
 * Validates requests for POST /api/v1/material-usage
 * 
 * Supports:
 * - ROH (Raw materials) with work_order_number
 * - HALB (Semifinished) with work_order_number
 * - HIBE (Production support) with cost_center_number
 * - Reversal (returns) with reversal: 'Y'
 * - PPKEK traceability (optional)
 */

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

const MaterialUsageItemSchema = z.object({
  item_type: z.string().trim().min(1).max(10),
  item_code: z.string().trim().min(1).max(50),
  item_name: z.string().trim().min(1).max(200),
  uom: z.string().trim().min(1).max(20),
  qty: z.number().positive('Quantity must be greater than 0').finite(),
  ppkek_number: z.string().trim().max(50).nullable().optional(),
});

export type MaterialUsageItem = z.infer<typeof MaterialUsageItemSchema>;

export const MaterialUsageBatchSchema = z
  .object({
    wms_id: z.string().trim().min(1).max(100),
    company_code: z.number().int().min(1),
    work_order_number: z.string().trim().max(50).nullable().optional(),
    cost_center_number: z.string().trim().nullable().optional(),
    internal_evidence_number: z.string().trim().min(1).max(50),
    transaction_date: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    }),
    reversal: z.enum(['Y']).nullable().optional(),
    items: z.array(MaterialUsageItemSchema).min(1),
    timestamp: z.string(),
  })
  .refine(
    (data) => {
      // Check if items contain ROH or HALB types
      const hasRohOrHalb = data.items.some((item) =>
        ['ROH', 'HALB'].includes(item.item_type)
      );
      // Check if items contain production support types (FERT, HIBE, etc.)
      const hasProductionSupport = data.items.some((item) =>
        ['FERT', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T'].includes(item.item_type)
      );

      // If ROH/HALB present, must have work_order_number
      if (hasRohOrHalb && !data.work_order_number) {
        return false;
      }

      // If production support present, must have cost_center_number
      if (hasProductionSupport && !data.cost_center_number) {
        return false;
      }

      // Cannot use both work_order and cost_center
      if (data.work_order_number && data.cost_center_number) {
        return false;
      }

      return true;
    },
    {
      message:
        'Work order required for ROH/HALB, cost center required for production support types. Cannot use both.',
      path: ['work_order_number'],
    }
  )
  .refine(
    (data) => {
      const transactionDate = new Date(data.transaction_date);
      const today = new Date();
      today.setHours(23, 59, 59, 999);
      return transactionDate <= today;
    },
    {
      message: 'Transaction date cannot be in the future',
      path: ['transaction_date'],
    }
  )
  .refine(
    (data) => {
      // ✅ Reversal Rule: Must have items
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

export type MaterialUsageBatch = z.infer<typeof MaterialUsageBatchSchema>;

// ============================================================================
// VALIDATION FUNCTION
// ============================================================================

export interface BatchValidationError {
  location: 'header' | 'item';
  field?: string;
  item_index?: number;
  item_code?: string;
  code: string;
  message: string;
}

export interface BatchValidationResult {
  success: boolean;
  errors: BatchValidationError[];
  data?: MaterialUsageBatch;
}

/**
 * Validate material usage batch with detailed error reporting
 * Returns both schema and business logic validation errors
 */
export function validateMaterialUsageBatch(
  payload: unknown
): BatchValidationResult {
  // Schema validation
  const schemaResult = MaterialUsageBatchSchema.safeParse(payload);

  if (!schemaResult.success) {
    const errors: BatchValidationError[] = schemaResult.error.issues.map(
      (issue) => {
        const path = issue.path[0] as string;

        // Item-level errors
        if (path === 'items') {
          const itemIndex = issue.path[1] as number;
          const item = (payload as any)?.items?.[itemIndex];
          return {
            location: 'item',
            item_index: itemIndex,
            item_code: item?.item_code,
            field: issue.path[2] as string,
            code: issue.code,
            message: issue.message,
          };
        }

        // Header-level errors
        return {
          location: 'header',
          field: path,
          code: issue.code,
          message: issue.message,
        };
      }
    );

    return {
      success: false,
      errors,
    };
  }

  // Additional business logic validation
  const businessErrors = validateBusinessRules(schemaResult.data);

  if (businessErrors.length > 0) {
    return {
      success: false,
      errors: businessErrors,
    };
  }

  return {
    success: true,
    errors: [],
    data: schemaResult.data,
  };
}

/**
 * Validate business rules after schema validation
 */
function validateBusinessRules(data: MaterialUsageBatch): BatchValidationError[] {
  const errors: BatchValidationError[] = [];

  // Validate company code
  if (![1370, 1310, 1380].includes(data.company_code)) {
    errors.push({
      location: 'header',
      field: 'company_code',
      code: 'INVALID_VALUE',
      message: `Company code must be 1370, 1310, or 1380. Got: ${data.company_code}`,
    });
  }

  // Validate reversal value (if present)
  if (data.reversal && data.reversal !== 'Y') {
    errors.push({
      location: 'header',
      field: 'reversal',
      code: 'INVALID_VALUE',
      message: `Reversal must be 'Y' or null. Got: ${data.reversal}`,
    });
  }

  // Validate items
  data.items.forEach((item, index) => {
    // Quantity must be positive
    if (item.qty <= 0) {
      errors.push({
        location: 'item',
        item_index: index,
        item_code: item.item_code,
        field: 'qty',
        code: 'INVALID_VALUE',
        message: 'Quantity must be greater than 0',
      });
    }
  });

  return errors;
}
