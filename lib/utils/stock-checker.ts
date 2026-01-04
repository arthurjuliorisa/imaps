import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

export interface StockCheckItem {
  itemCode: string;
  itemType: string;
  qtyRequested: number;
}

export interface StockCheckResult {
  itemCode: string;
  itemType: string;
  currentStock: number;
  qtyRequested: number;
  available: boolean;
  shortfall?: number;
  validationDate?: Date;
}

export interface BatchStockCheckResult {
  results: StockCheckResult[];
  allAvailable: boolean;
}

/**
 * Convert Date to YYYY-MM-DD string format for SQL comparison
 */
function formatDateForSql(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Normalize date to UTC midnight for comparison
 */
function normalizeDate(date: Date): Date {
  return new Date(Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0, 0, 0, 0
  ));
}

/**
 * Check stock availability for a single item at a specific date
 * - For historical dates: uses stock_daily_snapshot only
 * - For current date: combines snapshot + live transactions
 *
 * SCRAP:
 *   Incoming: scrap_transactions (transaction_type='IN')
 *   Outgoing: outgoing_goods (item_type='SCRAP')
 *
 * CG (HIBE-M/E-T):
 *   Incoming: incoming_goods (item_type='HIBE-*')
 *   Outgoing: outgoing_goods (item_type='HIBE-*')
 */
export async function checkStockAvailability(
  companyCode: number,
  itemCode: string,
  itemType: string,
  qtyRequested: number,
  asOfDate: Date
): Promise<StockCheckResult> {
  let currentStock = 0;

  try {
    const normalizedDate = normalizeDate(asOfDate);
    const today = normalizeDate(new Date());
    const isCurrentDate = normalizedDate.getTime() === today.getTime();

    if (isCurrentDate) {
      // Real-time validation: snapshot + live transactions for today
      console.log(`[Stock Check] Using REAL-TIME validation (today)`);
      currentStock = await calculateRealTimeStock(
        companyCode,
        itemCode,
        itemType,
        normalizedDate
      );
    } else {
      // Historical validation: snapshot only for past dates
      const snapshotBalance = await getSnapshotBalance(
        companyCode,
        itemCode,
        itemType,
        normalizedDate
      );
      currentStock = snapshotBalance;
    }

    const available = currentStock >= qtyRequested;
    const shortfall = available ? undefined : qtyRequested - currentStock;

    console.log(`[Stock Check] Result - currentStock: ${currentStock}, requested: ${qtyRequested}, available: ${available}`);

    return {
      itemCode,
      itemType,
      currentStock,
      qtyRequested,
      available,
      shortfall,
      validationDate: asOfDate,
    };
  } catch (error) {
    console.error(
      `[Stock Check Error] Failed to check stock for ${itemCode} on ${asOfDate.toISOString()}:`,
      error
    );
    throw error;
  }
}

/**
 * Get snapshot balance for a specific date
 * - If exact date snapshot exists: use it
 * - If not: fallback to nearest snapshot BEFORE that date (if available)
 * - If no snapshot found at all: return 0 (conservative)
 */
async function getSnapshotBalance(
  companyCode: number,
  itemCode: string,
  itemType: string,
  snapshotDate: Date
): Promise<number> {
  const dateStr = formatDateForSql(snapshotDate);
  
  // First, try to find exact date
  const exactResult = await prisma.$queryRaw<Array<{ closing_balance: Prisma.Decimal }>>`
    SELECT closing_balance
    FROM stock_daily_snapshot
    WHERE company_code = ${companyCode}
      AND item_type = ${itemType}
      AND item_code = ${itemCode}
      AND snapshot_date = ${dateStr}::DATE
    LIMIT 1
  `;

  if (exactResult.length > 0) {
    return Number(exactResult[0].closing_balance);
  }

  // Fallback: Find nearest snapshot BEFORE the requested date
  const nearestResult = await prisma.$queryRaw<Array<{ closing_balance: Prisma.Decimal }>>`
    SELECT closing_balance
    FROM stock_daily_snapshot
    WHERE company_code = ${companyCode}
      AND item_type = ${itemType}
      AND item_code = ${itemCode}
      AND snapshot_date < ${dateStr}::DATE
    ORDER BY snapshot_date DESC
    LIMIT 1
  `;

  if (nearestResult.length > 0) {
    return Number(nearestResult[0].closing_balance);
  }

  // No snapshot found at all - return 0 (conservative approach)
  return 0;
}

/**
 * Calculate real-time stock for current date
 * Priority: Use snapshot for current date if available
 * Fallback: Use snapshot from yesterday + today's transactions
 */
async function calculateRealTimeStock(
  companyCode: number,
  itemCode: string,
  itemType: string,
  currentDate: Date
): Promise<number> {
  const yesterdayDate = new Date(currentDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);

  const dateStr = formatDateForSql(currentDate);

  // Get snapshot balance (will use nearest snapshot before today)
  const snapshotBalance = await getSnapshotBalance(
    companyCode,
    itemCode,
    itemType,
    yesterdayDate
  );

  let incomingToday = 0;
  let outgoingToday = 0;

  if (itemType === 'SCRAP') {
    // SCRAP: Incoming from scrap_transactions
    const incomingResult = await prisma.$queryRaw<Array<{ total_qty: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(sti.qty), 0) as total_qty
      FROM scrap_transaction_items sti
      JOIN scrap_transactions st ON 
        sti.scrap_transaction_company = st.company_code
        AND sti.scrap_transaction_id = st.id
        AND sti.scrap_transaction_date = st.transaction_date
      WHERE sti.scrap_transaction_company = ${companyCode}
        AND sti.item_code = ${itemCode}
        AND sti.item_type = ${itemType}
        AND st.transaction_type = 'IN'
        AND st.transaction_date = ${dateStr}::DATE
        AND sti.deleted_at IS NULL
        AND st.deleted_at IS NULL
    `;

    incomingToday = incomingResult.length > 0 ? Number(incomingResult[0].total_qty) : 0;

    // SCRAP: Outgoing from outgoing_goods
    const outgoingResult = await prisma.$queryRaw<Array<{ total_qty: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(ogi.qty), 0) as total_qty
      FROM outgoing_good_items ogi
      JOIN outgoing_goods og ON 
        ogi.outgoing_good_id = og.id
        AND ogi.outgoing_good_company = og.company_code
        AND ogi.outgoing_good_date = og.outgoing_date
      WHERE ogi.outgoing_good_company = ${companyCode}
        AND ogi.item_code = ${itemCode}
        AND ogi.item_type = ${itemType}
        AND og.outgoing_date = ${dateStr}::DATE
        AND ogi.deleted_at IS NULL
        AND og.deleted_at IS NULL
    `;

    outgoingToday = outgoingResult.length > 0 ? Number(outgoingResult[0].total_qty) : 0;
  } else if (['HIBE-M', 'HIBE-E', 'HIBE-T'].includes(itemType)) {
    // CG: Incoming from incoming_goods
    const incomingResult = await prisma.$queryRaw<Array<{ total_qty: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(igi.qty), 0) as total_qty
      FROM incoming_good_items igi
      JOIN incoming_goods ig ON 
        igi.incoming_good_id = ig.id
        AND igi.incoming_good_company = ig.company_code
        AND igi.incoming_good_date = ig.incoming_date
      WHERE igi.incoming_good_company = ${companyCode}
        AND igi.item_code = ${itemCode}
        AND igi.item_type = ${itemType}
        AND ig.incoming_date = ${dateStr}::DATE
        AND igi.deleted_at IS NULL
        AND ig.deleted_at IS NULL
    `;

    incomingToday = incomingResult.length > 0 ? Number(incomingResult[0].total_qty) : 0;

    // CG: Outgoing from outgoing_goods
    const outgoingResult = await prisma.$queryRaw<Array<{ total_qty: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(ogi.qty), 0) as total_qty
      FROM outgoing_good_items ogi
      JOIN outgoing_goods og ON 
        ogi.outgoing_good_id = og.id
        AND ogi.outgoing_good_company = og.company_code
        AND ogi.outgoing_good_date = og.outgoing_date
      WHERE ogi.outgoing_good_company = ${companyCode}
        AND ogi.item_code = ${itemCode}
        AND ogi.item_type = ${itemType}
        AND og.outgoing_date = ${dateStr}::DATE
        AND ogi.deleted_at IS NULL
        AND og.deleted_at IS NULL
    `;

    outgoingToday = outgoingResult.length > 0 ? Number(outgoingResult[0].total_qty) : 0;
  } else {
    throw new Error(`Unsupported item type: ${itemType}`);
  }

  // Real-time balance = snapshot + incoming - outgoing
  const calculatedBalance = snapshotBalance + incomingToday - outgoingToday;
  
  return Math.max(0, calculatedBalance); // Ensure non-negative
}

/**
 * Check stock availability for multiple items (batch) at a specific date
 * Validates all items exist in stock as of the transaction date
 */
export async function checkBatchStockAvailability(
  companyCode: number,
  items: StockCheckItem[],
  asOfDate: Date
): Promise<BatchStockCheckResult> {
  const results: StockCheckResult[] = [];

  for (const item of items) {
    const result = await checkStockAvailability(
      companyCode,
      item.itemCode,
      item.itemType,
      item.qtyRequested,
      asOfDate
    );
    results.push(result);
  }

  const allAvailable = results.every((r) => r.available);

  return {
    results,
    allAvailable,
  };
}

/**
 * Check stock balance for SCRAP IN transactions
 * For SCRAP IN, we need to ensure that reducing the IN qty won't make balance negative
 * 
 * Balance = beginning_balance + Total IN (excluding this transaction) - Total OUT
 * 
 * @param companyCode Company code
 * @param itemCode Item code
 * @param itemType Item type (should be 'SCRAP')
 * @param currentInQty Current IN qty in the transaction being edited
 * @param newInQty New IN qty after edit
 * @param asOfDate Transaction date
 * @param excludeTransactionId Transaction ID to exclude from calculation
 * @returns Current balance and whether reduction is allowed
 */
export async function checkScrapInBalance(
  companyCode: number,
  itemCode: string,
  itemType: string,
  currentInQty: number,
  newInQty: number,
  asOfDate: Date,
  excludeTransactionId?: number
): Promise<StockCheckResult> {
  try {
    const normalizedDate = normalizeDate(asOfDate);
    const today = normalizeDate(new Date());
    const isCurrentDate = normalizedDate.getTime() === today.getTime();

    console.log(`[Scrap IN Balance] asOfDate=${asOfDate.toISOString()}, normalizedDate=${normalizedDate.toISOString()}, today=${today.toISOString()}, isCurrentDate=${isCurrentDate}`);

    // Get beginning balance for this item
    let beginningBalance = 0;
    const beginningBalanceResult = await prisma.$queryRawUnsafe<[{ qty: bigint }]>(
      `
        SELECT COALESCE(SUM(qty), 0) as qty
        FROM beginning_balances
        WHERE company_code = $1
          AND item_code = $2
          AND item_type = $3
      `,
      companyCode, itemCode, itemType
    );
    
    if (beginningBalanceResult.length > 0) {
      beginningBalance = Number(beginningBalanceResult[0]?.qty || 0);
    }

    console.log(`[Scrap IN Balance] Beginning balance for ${itemCode} (${itemType}): ${beginningBalance}`);

    // Calculate total IN quantity (excluding current transaction)
    const params: any[] = [companyCode, itemCode, itemType, normalizedDate];
    let whereClause = `
        WHERE st.company_code = $1
          AND sti.item_code = $2
          AND sti.item_type = $3
          AND st.transaction_type = 'IN'
          AND st.deleted_at IS NULL
          AND sti.deleted_at IS NULL
          AND st.transaction_date <= $4`;
    
    if (excludeTransactionId) {
      whereClause += ` AND st.id != $${params.length + 1}`;
      params.push(excludeTransactionId);
    }

    const totalInResult = await prisma.$queryRawUnsafe<[{ total_in: bigint }]>(
      `
        SELECT COALESCE(SUM(sti.qty), 0) as total_in
        FROM scrap_transaction_items sti
        JOIN scrap_transactions st ON st.company_code = sti.scrap_transaction_company
          AND st.id = sti.scrap_transaction_id
          AND st.transaction_date = sti.scrap_transaction_date
        ${whereClause}
      `,
      ...params
    );

    const totalIn = Number(totalInResult[0]?.total_in || 0);

    console.log(`[Scrap IN Balance] Total IN for ${itemCode} (excluding transaction ${excludeTransactionId}): ${totalIn}`);

    // Calculate total OUT quantity
    // CRITICAL: Always use TODAY's transactions for validation, not transaction date
    // Because we want to validate: "If we delete this, will CURRENT balance go negative?"
    let totalOut = 0;
    const todayDate = normalizeDate(new Date());
    
    // Always check outgoing qty up to TODAY (current balance state)
    const outResult = await prisma.$queryRawUnsafe<[{ total_out: bigint }]>(
      `
        SELECT COALESCE(SUM(ogi.qty), 0) as total_out
        FROM outgoing_good_items ogi
        JOIN outgoing_goods og ON og.company_code = ogi.outgoing_good_company
          AND og.id = ogi.outgoing_good_id
          AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.company_code = $1
          AND ogi.item_code = $2
          AND ogi.item_type = $3
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
          AND og.outgoing_date <= $4
      `,
      companyCode, itemCode, itemType, todayDate
    );
    totalOut = Number(outResult[0]?.total_out || 0);
    console.log(`[Scrap IN Balance] Total OUT (up to today) for ${itemCode}: ${totalOut}`);

    // Calculate current balance = beginning_balance + Total IN (excluding this) - Total OUT
    const balanceExcludingThisTx = beginningBalance + totalIn - totalOut;
    
    // After the change, this transaction will have newInQty instead of currentInQty
    // newBalance = (balance without this tx) + newInQty
    const newBalance = balanceExcludingThisTx + newInQty;
    
    // Check if new balance would be negative
    const isAllowed = newBalance >= 0;
    const shortfall = isAllowed ? undefined : Math.abs(newBalance);
    
    // For logging: actual current balance (with current transaction included)
    const actualCurrentBalance = balanceExcludingThisTx + currentInQty;

    console.log(`[Scrap IN Balance] For ${itemCode}: actualBalance=${actualCurrentBalance}, currentQty=${currentInQty}, newQty=${newInQty}, newBalance=${newBalance}, allowed=${isAllowed}`);

    return {
      itemCode,
      itemType,
      currentStock: actualCurrentBalance,
      qtyRequested: Math.abs(newInQty - currentInQty), // how much we're changing
      available: isAllowed,
      shortfall,
      validationDate: asOfDate,
    };
  } catch (error) {
    console.error(
      `[Scrap IN Balance Check Error] Failed to check scrap IN balance for ${itemCode} on ${asOfDate.toISOString()}:`,
      error
    );
    throw error;
  }
}
