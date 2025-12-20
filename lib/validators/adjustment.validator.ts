import { z } from 'zod';

/**
 * Adjustments API Validator
 * Validates requests for POST /api/v1/adjustments
 *
 * Supports:
 * - GAIN adjustments (inventory increase from stock opname, damaged goods recovery, etc.)
 * - LOSS adjustments (inventory decrease from damage, theft, etc.)
 * - All item types (ROH, HALB, FERT, etc.)
 * - Optional reason for traceability
 */

// ============================================================================
// SCHEMA DEFINITIONS
// ============================================================================

const AdjustmentItemSchema = z.object({
  adjustment_type: z.enum(['GAIN', 'LOSS']),
  item_type: z.string().trim().min(1).max(50), // Relaxed from 10 to 50 to allow longer item type codes
  item_code: z.string().trim().min(1).max(50),
  item_name: z.string().trim().min(1).max(200),
  uom: z.string().trim().min(1).max(20),
  qty: z.number().positive('Quantity must be greater than 0').finite(),
  reason: z.string().trim().max(1000).nullable().optional(), // Relaxed from 500 to 1000 for more flexibility
});

export type AdjustmentItem = z.infer<typeof AdjustmentItemSchema>;

export const AdjustmentBatchSchema = z
  .object({
    wms_id: z.string().trim().min(1).max(100),
    company_code: z.number().int().min(1),
    wms_doc_type: z.string().trim().max(100).nullable().optional(),
    internal_evidence_number: z.string().trim().min(1).max(50),
    transaction_date: z.string().refine((val) => !isNaN(Date.parse(val)), {
      message: 'Invalid date format',
    }),
    items: z.array(AdjustmentItemSchema).min(1, 'At least one item is required'),
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
      // At least one item is required
      if (!data.items || data.items.length === 0) {
        return false;
      }
      return true;
    },
    {
      message: 'Adjustment must include at least one item',
      path: ['items'],
    }
  );

export type AdjustmentBatch = z.infer<typeof AdjustmentBatchSchema>;

/**
 * Validate adjustment request
 */
export function validateAdjustment(data: unknown) {
  return AdjustmentBatchSchema.safeParse(data);
}
