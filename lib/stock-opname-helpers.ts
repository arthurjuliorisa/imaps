import { prisma } from './prisma';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * Generate STO number in format: STO-{companyCode}-YYYYMMDD-XXX
 * Example: STO-1001-20260118-001
 */
export async function generateStoNumber(
  companyCode: number,
  stoDate: Date
): Promise<string> {
  // Format date as YYYYMMDD
  const year = stoDate.getFullYear();
  const month = String(stoDate.getMonth() + 1).padStart(2, '0');
  const day = String(stoDate.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  // Get count of stock opnames for this company and date
  const startOfDay = new Date(stoDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(stoDate);
  endOfDay.setHours(23, 59, 59, 999);

  const count = await prisma.stock_opnames.count({
    where: {
      company_code: companyCode,
      sto_datetime: {
        gte: startOfDay,
        lte: endOfDay,
      },
      deleted_at: null,
    },
  });

  // Sequential number for the day (starts at 1)
  const seqNum = String(count + 1).padStart(3, '0');

  return `STO-${companyCode}-${dateStr}-${seqNum}`;
}

/**
 * Calculate end stock for an item at a specific datetime
 * This is the system stock quantity based on LPJ mutasi
 *
 * Formula: Beginning Balance + Total IN - Total OUT
 *
 * Currently returns 0 as placeholder
 * TODO: Implement proper calculation from LPJ mutasi
 */
export async function calculateEndStock(
  companyCode: number,
  itemCode: string,
  asOfDatetime: Date
): Promise<Decimal> {
  // TODO: Implement proper end stock calculation
  // This should query:
  // 1. Beginning balance for the item
  // 2. Sum of incoming_good_items.qty WHERE incoming_date <= asOfDatetime
  // 3. Sum of production_output_items.qty WHERE transaction_date <= asOfDatetime
  // 4. Sum of material_usage_items.qty WHERE transaction_date <= asOfDatetime
  // 5. Sum of outgoing_good_items.qty WHERE outgoing_date <= asOfDatetime
  // 6. Sum of adjustment_items.qty (GAIN - LOSS) WHERE adjustment_date <= asOfDatetime
  //
  // For now, return 0 as dummy value
  return new Decimal(0);
}

/**
 * Calculate variance: sto_qty - end_stock
 */
export function calculateVariance(
  stoQty: Decimal | number,
  endStock: Decimal | number
): Decimal {
  const stoDecimal = stoQty instanceof Decimal ? stoQty : new Decimal(stoQty);
  const endStockDecimal = endStock instanceof Decimal ? endStock : new Decimal(endStock);
  return stoDecimal.minus(endStockDecimal);
}

/**
 * Get item details from items table
 */
export async function getItemDetails(companyCode: number, itemCode: string) {
  return await prisma.items.findFirst({
    where: {
      company_code: companyCode,
      item_code: itemCode,
      deleted_at: null,
      is_active: true,
    },
    select: {
      item_name: true,
      item_type: true,
      uom: true,
    },
  });
}

/**
 * Validate status transition
 * Allowed transitions:
 * - OPEN -> PROCESS (forward)
 * - PROCESS -> RELEASED (forward)
 * - RELEASED -> PROCESS (rollback)
 * Not allowed:
 * - RELEASED -> OPEN
 * - PROCESS -> OPEN
 */
export function isValidStatusTransition(
  currentStatus: string,
  newStatus: string
): boolean {
  // Allow forward transitions
  if (currentStatus === 'OPEN' && newStatus === 'PROCESS') return true;
  if (currentStatus === 'PROCESS' && newStatus === 'RELEASED') return true;

  // Allow rollback from RELEASED to PROCESS
  if (currentStatus === 'RELEASED' && newStatus === 'PROCESS') return true;

  // Block all other transitions (backward to OPEN, same status, etc.)
  return false;
}
