import { z } from 'zod';

/**
 * Production Output API Validator
 * Validates requests for POST /api/v1/production-output
 *
 * Supports:
 * - FERT (Finished goods)
 * - HALB (Semifinished goods)
 * - Reversal (returns to production) with reversal: 'Y'
 * - Multiple work orders per item
 */

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

const WorkOrderNumberArraySchema = z
  .array(z.string().trim().min(1).max(50))
  .min(1, 'At least one work order number is required');

const ProductionOutputItemSchema = z.object({
  item_type: z.string().trim().min(1).max(10),
  item_code: z.string().trim().min(1).max(50),
  item_name: z.string().trim().min(1).max(200),
  uom: z.string().trim().min(1).max(20),
  qty: z.number().positive('Quantity must be greater than 0').finite(),
  work_order_numbers: WorkOrderNumberArraySchema,
});

export type ProductionOutputItem = z.infer<typeof ProductionOutputItemSchema>;

export const ProductionOutputBatchSchema = z
  .object({
    wms_id: z.string().trim().min(1).max(100),
    company_code: z.number().int().min(1),
    internal_evidence_number: z.string().trim().min(1).max(50),
    transaction_date: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    }),
    reversal: z.enum(['Y']).nullable().optional(),
    items: z.array(ProductionOutputItemSchema).min(1, 'At least one item is required'),
    timestamp: z.string(),
  })
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

export type ProductionOutputBatch = z.infer<typeof ProductionOutputBatchSchema>;

/**
 * Validate production output request
 */
export function validateProductionOutput(data: unknown) {
  return ProductionOutputBatchSchema.safeParse(data);
}
