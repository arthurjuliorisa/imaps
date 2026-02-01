import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { SnapshotRepository } from '@/lib/repositories/snapshot.repository';

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

// Initialize snapshot repository
const snapshotRepo = new SnapshotRepository();

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
 * Check if two dates are the same day
 */
function isSameDay(date1: Date, date2: Date): boolean {
  return (
    date1.getFullYear() === date2.getFullYear() &&
    date1.getMonth() === date2.getMonth() &&
    date1.getDate() === date2.getDate()
  );
}

/**
 * Check stock availability for a single item at a specific date
 * Uses new item-level snapshot implementation
 * 
 * - For historical dates: Uses snapshot table
 * - For current date: Combines snapshot + real-time transactions
 *
 * @param companyCode Company code
 * @param itemCode Item code to check
 * @param itemType Item type (ROH, HALB, FERT, HIBE*, SCRAP)
 * @param qtyRequested Quantity being requested
 * @param asOfDate Transaction date (for historical stock queries)
 * @param excludeWmsId Optional: WMS ID to exclude (for UPDATE/revision scenarios)
 * @returns StockCheckResult with available stock and shortfall
 */
export async function checkStockAvailability(
  companyCode: number,
  itemCode: string,
  itemType: string,
  qtyRequested: number,
  asOfDate: Date,
  excludeWmsId?: string
): Promise<StockCheckResult> {
  let currentStock = 0;

  try {
    const normalizedDate = normalizeDate(asOfDate);
    const today = normalizeDate(new Date());
    const isCurrentDate = isSameDay(normalizedDate, today);

    if (isCurrentDate) {
      // Real-time validation: check today's snapshot first, fallback to calculated balance
      currentStock = await calculateRealTimeStock(
        companyCode,
        itemCode,
        itemType,
        normalizedDate,
        excludeWmsId
      );
    } else {
      // Historical validation: use snapshot only for past dates
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
 * 
 * Strategy:
 * 1. Check if snapshot exists for today - use it directly (most accurate)
 * 2. If no snapshot yet - calculate from opening balance + today's transactions
 * 
 * @param companyCode Company code
 * @param itemCode Item code
 * @param itemType Item type
 * @param currentDate Current date
 * @param excludeWmsId Optional: WMS ID to exclude (for UPDATE/revision scenarios)
 */
async function calculateRealTimeStock(
  companyCode: number,
  itemCode: string,
  itemType: string,
  currentDate: Date,
  excludeWmsId?: string
): Promise<number> {
  const dateStr = formatDateForSql(currentDate);

  // First: Try to find snapshot for today
  const todaySnapshot = await prisma.$queryRaw<Array<{ closing_balance: Prisma.Decimal }>>`
    SELECT closing_balance
    FROM stock_daily_snapshot
    WHERE company_code = ${companyCode}
      AND item_type = ${itemType}
      AND item_code = ${itemCode}
      AND snapshot_date = ${dateStr}::DATE
    LIMIT 1
  `;

  if (todaySnapshot.length > 0) {
    const balance = Number(todaySnapshot[0].closing_balance);
    console.log(`[RealTimeStock] Found today's snapshot for ${itemType} ${itemCode} on ${dateStr}: ${balance}`);
    return balance;
  }

  // Fallback: Calculate from opening balance + today's transactions
  const yesterdayDate = new Date(currentDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);

  // Get opening balance (from previous snapshot or beginning_balances)
  const openingBalance = await getOpeningBalance(
    companyCode,
    itemCode,
    itemType,
    yesterdayDate
  );

  // Get all today's transactions aggregated
  const todayTransactions = await getTodayTransactions(
    companyCode,
    itemCode,
    itemType,
    dateStr,
    excludeWmsId
  );

  // Calculate balance: opening + net transactions
  const calculatedBalance = openingBalance + todayTransactions;
  const balance = Math.max(0, calculatedBalance); // Ensure non-negative

  return balance;
}

/**
 * Get opening balance for a specific item on a specific date
 * Uses PostgreSQL function or fallback to manual lookup
 */
async function getOpeningBalance(
  companyCode: number,
  itemCode: string,
  itemType: string,
  asOfDate: Date
): Promise<number> {
  const dateStr = formatDateForSql(asOfDate);

  try {
    // Try to find previous day's snapshot first (most recent)
    const snapshotResult = await prisma.$queryRaw<Array<{ closing_balance: Prisma.Decimal }>>`
      SELECT closing_balance
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND item_type = ${itemType}
        AND item_code = ${itemCode}
        AND snapshot_date <= ${dateStr}::DATE
      ORDER BY snapshot_date DESC
      LIMIT 1
    `;

    if (snapshotResult.length > 0) {
      return Number(snapshotResult[0].closing_balance);
    }

    // Fallback: Check beginning_balances table
    const beginningResult = await prisma.$queryRaw<Array<{ qty: Prisma.Decimal }>>`
      SELECT qty
      FROM beginning_balances
      WHERE company_code = ${companyCode}
        AND item_type = ${itemType}
        AND item_code = ${itemCode}
    `;

    if (beginningResult.length > 0) {
      return Number(beginningResult[0].qty);
    }

    // No history found
    return 0;
  } catch (error) {
    console.error('[OpeningBalance] Error fetching opening balance:', error);
    return 0;
  }
}

/**
 * Get today's transactions for real-time stock calculation
 * Aggregates all transaction types for the item on the specified date
 * 
 * Formula varies by item_type:
 * - ROH/HALB/HIBE*: + incoming - material_usage - outgoing ± adjustment
 * - FERT: + production - outgoing ± adjustment
 * - SCRAP: + scrap_in - scrap_out ± adjustment
 * 
 * @param companyCode Company code
 * @param itemCode Item code
 * @param itemType Item type
 * @param dateStr Date string in YYYY-MM-DD format
 * @param excludeWmsId Optional: WMS ID to exclude (for UPDATE/revision scenarios)
 */
async function getTodayTransactions(
  companyCode: number,
  itemCode: string,
  itemType: string,
  dateStr: string,
  excludeWmsId?: string
): Promise<number> {
  try {
    // Build query with or without excludeWmsId
    // We need to construct the WHERE clause carefully to avoid Prisma parameter counting issues
    let query: string;
    
    if (excludeWmsId) {
      query = `
        WITH daily_txns AS (
          -- Incoming goods
          SELECT 'incoming' as type, COALESCE(SUM(igi.qty), 0)::numeric as qty
          FROM incoming_good_items igi
          JOIN incoming_goods ig ON ig.company_code = igi.incoming_good_company
            AND ig.id = igi.incoming_good_id
            AND ig.incoming_date = igi.incoming_good_date
          WHERE ig.company_code = $1
            AND igi.item_type = $2
            AND igi.item_code = $3
            AND ig.incoming_date = $4::DATE
            AND ig.deleted_at IS NULL
            AND igi.deleted_at IS NULL
            AND ig.wms_id != $8
          
          UNION ALL
          
          -- Outgoing goods
          SELECT 'outgoing' as type, COALESCE(SUM(ogi.qty), 0)::numeric as qty
          FROM outgoing_good_items ogi
          JOIN outgoing_goods og ON og.company_code = ogi.outgoing_good_company
            AND og.id = ogi.outgoing_good_id
            AND og.outgoing_date = ogi.outgoing_good_date
          WHERE og.company_code = $1
            AND ogi.item_type = $2
            AND ogi.item_code = $3
            AND og.outgoing_date = $4::DATE
            AND og.deleted_at IS NULL
            AND ogi.deleted_at IS NULL
            AND og.wms_id != $8
          
          UNION ALL
          
          -- Material usage
          SELECT 'material_usage' as type, COALESCE(SUM(
            CASE WHEN mu.reversal = 'Y' THEN -mui.qty ELSE mui.qty END
          ), 0)::numeric as qty
          FROM material_usage_items mui
          JOIN material_usages mu ON mu.company_code = mui.material_usage_company
            AND mu.id = mui.material_usage_id
            AND mu.transaction_date = mui.material_usage_date
          WHERE mu.company_code = $1
            AND mui.item_type = $2
            AND mui.item_code = $3
            AND mu.transaction_date = $4::DATE
            AND mu.deleted_at IS NULL
            AND mui.deleted_at IS NULL
            AND mu.wms_id != $8
          
          UNION ALL
          
          -- Production output
          SELECT 'production' as type, COALESCE(SUM(
            CASE WHEN po.reversal = 'Y' THEN -poi.qty ELSE poi.qty END
          ), 0)::numeric as qty
          FROM production_output_items poi
          JOIN production_outputs po ON po.company_code = poi.production_output_company
            AND po.id = poi.production_output_id
            AND po.transaction_date = poi.production_output_date
          WHERE po.company_code = $1
            AND poi.item_type = $2
            AND poi.item_code = $3
            AND po.transaction_date = $4::DATE
            AND po.deleted_at IS NULL
            AND poi.deleted_at IS NULL
            AND po.wms_id != $8
          
          UNION ALL
          
          -- Adjustments
          SELECT 'adjustment' as type, COALESCE(SUM(
            CASE WHEN ai.adjustment_type = 'GAIN' THEN ai.qty ELSE -ai.qty END
          ), 0)::numeric as qty
          FROM adjustment_items ai
          JOIN adjustments a ON a.company_code = ai.adjustment_company
            AND a.id = ai.adjustment_id
            AND a.transaction_date = ai.adjustment_date
          WHERE a.company_code = $1
            AND ai.item_type = $2
            AND ai.item_code = $3
            AND a.transaction_date = $4::DATE
            AND a.deleted_at IS NULL
            AND ai.deleted_at IS NULL
            AND a.wms_id != $8
          
          UNION ALL
          
          -- Scrap transactions
          SELECT 'scrap' as type, COALESCE(SUM(
            CASE WHEN st.transaction_type = 'IN' THEN sti.qty ELSE -sti.qty END
          ), 0)::numeric as qty
          FROM scrap_transaction_items sti
          JOIN scrap_transactions st ON st.company_code = sti.scrap_transaction_company
            AND st.id = sti.scrap_transaction_id
            AND st.transaction_date = sti.scrap_transaction_date
          WHERE st.company_code = $1
            AND sti.item_type = $2
            AND sti.item_code = $3
            AND st.transaction_date = $4::DATE
            AND st.deleted_at IS NULL
            AND sti.deleted_at IS NULL
            AND st.document_number != $8
        )
        SELECT
          SUM(CASE WHEN type = 'incoming' THEN qty ELSE 0 END)::numeric as incoming_qty,
          SUM(CASE WHEN type = 'outgoing' THEN qty ELSE 0 END)::numeric as outgoing_qty,
          SUM(CASE WHEN type = 'material_usage' THEN qty ELSE 0 END)::numeric as material_usage_qty,
          SUM(CASE WHEN type = 'production' THEN qty ELSE 0 END)::numeric as production_qty,
          SUM(CASE WHEN type = 'adjustment' THEN qty ELSE 0 END)::numeric as adjustment_qty,
          SUM(CASE WHEN type = 'scrap' AND (qty > 0) THEN qty ELSE 0 END)::numeric as scrap_in_qty,
          SUM(CASE WHEN type = 'scrap' AND (qty < 0) THEN -qty ELSE 0 END)::numeric as scrap_out_qty
        FROM daily_txns
      `;
    } else {
      query = `
        WITH daily_txns AS (
          -- Incoming goods
          SELECT 'incoming' as type, COALESCE(SUM(igi.qty), 0)::numeric as qty
          FROM incoming_good_items igi
          JOIN incoming_goods ig ON ig.company_code = igi.incoming_good_company
            AND ig.id = igi.incoming_good_id
            AND ig.incoming_date = igi.incoming_good_date
          WHERE ig.company_code = $1
            AND igi.item_type = $2
            AND igi.item_code = $3
            AND ig.incoming_date = $4::DATE
            AND ig.deleted_at IS NULL
            AND igi.deleted_at IS NULL
          
          UNION ALL
          
          -- Outgoing goods
          SELECT 'outgoing' as type, COALESCE(SUM(ogi.qty), 0)::numeric as qty
          FROM outgoing_good_items ogi
          JOIN outgoing_goods og ON og.company_code = ogi.outgoing_good_company
            AND og.id = ogi.outgoing_good_id
            AND og.outgoing_date = ogi.outgoing_good_date
          WHERE og.company_code = $1
            AND ogi.item_type = $2
            AND ogi.item_code = $3
            AND og.outgoing_date = $4::DATE
            AND og.deleted_at IS NULL
            AND ogi.deleted_at IS NULL
          
          UNION ALL
          
          -- Material usage
          SELECT 'material_usage' as type, COALESCE(SUM(
            CASE WHEN mu.reversal = 'Y' THEN -mui.qty ELSE mui.qty END
          ), 0)::numeric as qty
          FROM material_usage_items mui
          JOIN material_usages mu ON mu.company_code = mui.material_usage_company
            AND mu.id = mui.material_usage_id
            AND mu.transaction_date = mui.material_usage_date
          WHERE mu.company_code = $1
            AND mui.item_type = $2
            AND mui.item_code = $3
            AND mu.transaction_date = $4::DATE
            AND mu.deleted_at IS NULL
            AND mui.deleted_at IS NULL
          
          UNION ALL
          
          -- Production output
          SELECT 'production' as type, COALESCE(SUM(
            CASE WHEN po.reversal = 'Y' THEN -poi.qty ELSE poi.qty END
          ), 0)::numeric as qty
          FROM production_output_items poi
          JOIN production_outputs po ON po.company_code = poi.production_output_company
            AND po.id = poi.production_output_id
            AND po.transaction_date = poi.production_output_date
          WHERE po.company_code = $1
            AND poi.item_type = $2
            AND poi.item_code = $3
            AND po.transaction_date = $4::DATE
            AND po.deleted_at IS NULL
            AND poi.deleted_at IS NULL
          
          UNION ALL
          
          -- Adjustments
          SELECT 'adjustment' as type, COALESCE(SUM(
            CASE WHEN ai.adjustment_type = 'GAIN' THEN ai.qty ELSE -ai.qty END
          ), 0)::numeric as qty
          FROM adjustment_items ai
          JOIN adjustments a ON a.company_code = ai.adjustment_company
            AND a.id = ai.adjustment_id
            AND a.transaction_date = ai.adjustment_date
          WHERE a.company_code = $1
            AND ai.item_type = $2
            AND ai.item_code = $3
            AND a.transaction_date = $4::DATE
            AND a.deleted_at IS NULL
            AND ai.deleted_at IS NULL
          
          UNION ALL
          
          -- Scrap transactions
          SELECT 'scrap' as type, COALESCE(SUM(
            CASE WHEN st.transaction_type = 'IN' THEN sti.qty ELSE -sti.qty END
          ), 0)::numeric as qty
          FROM scrap_transaction_items sti
          JOIN scrap_transactions st ON st.company_code = sti.scrap_transaction_company
            AND st.id = sti.scrap_transaction_id
            AND st.transaction_date = sti.scrap_transaction_date
          WHERE st.company_code = $1
            AND sti.item_type = $2
            AND sti.item_code = $3
            AND st.transaction_date = $4::DATE
            AND st.deleted_at IS NULL
            AND sti.deleted_at IS NULL
        )
        SELECT
          SUM(CASE WHEN type = 'incoming' THEN qty ELSE 0 END)::numeric as incoming_qty,
          SUM(CASE WHEN type = 'outgoing' THEN qty ELSE 0 END)::numeric as outgoing_qty,
          SUM(CASE WHEN type = 'material_usage' THEN qty ELSE 0 END)::numeric as material_usage_qty,
          SUM(CASE WHEN type = 'production' THEN qty ELSE 0 END)::numeric as production_qty,
          SUM(CASE WHEN type = 'adjustment' THEN qty ELSE 0 END)::numeric as adjustment_qty,
          SUM(CASE WHEN type = 'scrap' AND (qty > 0) THEN qty ELSE 0 END)::numeric as scrap_in_qty,
          SUM(CASE WHEN type = 'scrap' AND (qty < 0) THEN -qty ELSE 0 END)::numeric as scrap_out_qty
        FROM daily_txns
      `;
    }

    // Get all transaction types aggregated
    const params = [companyCode, itemType, itemCode, dateStr];
    if (excludeWmsId) {
      params.push(excludeWmsId);
    }

    const result = await prisma.$queryRawUnsafe<Array<{
      incoming_qty: Prisma.Decimal;
      outgoing_qty: Prisma.Decimal;
      material_usage_qty: Prisma.Decimal;
      production_qty: Prisma.Decimal;
      adjustment_qty: Prisma.Decimal;
      scrap_in_qty: Prisma.Decimal;
      scrap_out_qty: Prisma.Decimal;
    }>>(query, ...params);

    if (result.length === 0) return 0;

    const tx = result[0];
    const incomingQty = Number(tx.incoming_qty || 0);
    const outgoingQty = Number(tx.outgoing_qty || 0);
    const materialUsageQty = Number(tx.material_usage_qty || 0);
    const productionQty = Number(tx.production_qty || 0);
    const adjustmentQty = Number(tx.adjustment_qty || 0);
    const scrapInQty = Number(tx.scrap_in_qty || 0);
    const scrapOutQty = Number(tx.scrap_out_qty || 0);

    // Apply item_type-specific formula
    let netTransactions = 0;

    if (['ROH', 'HALB', 'HIBE-M', 'HIBE-E', 'HIBE-T'].includes(itemType)) {
      // ROH/HALB/HIBE*: incoming - material_usage - outgoing ± adjustment
      netTransactions = incomingQty - materialUsageQty - outgoingQty + adjustmentQty;
    } else if (itemType === 'FERT') {
      // FERT: production - outgoing ± adjustment
      netTransactions = productionQty - outgoingQty + adjustmentQty;
    } else if (itemType === 'SCRAP') {
      // SCRAP: scrap_in - scrap_out ± adjustment
      netTransactions = scrapInQty - scrapOutQty + adjustmentQty;
    } else {
      // Unknown type - use all transactions
      netTransactions = incomingQty - materialUsageQty - outgoingQty + productionQty + adjustmentQty + scrapInQty - scrapOutQty;
    }

    return netTransactions;
  } catch (error) {
    console.error('[TodayTransactions] Error fetching transactions:', error);
    return 0;
  }
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
 * Balance = opening_balance + Total IN (excluding this transaction) - Total OUT
 * 
 * Uses snapshot-based approach for accuracy
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
    const dateStr = formatDateForSql(normalizedDate);

    console.log(`[Scrap IN Balance] Checking: ${itemCode} (${itemType}), currentQty=${currentInQty}, newQty=${newInQty}, transactionDate=${dateStr}, excludeId=${excludeTransactionId}`);

    // Get opening balance (previous day balance - the day BEFORE the transaction date)
    const previousDay = new Date(normalizedDate);
    previousDay.setDate(previousDay.getDate() - 1);
    const previousDayStr = formatDateForSql(previousDay);
    
    const openingBalance = await getOpeningBalance(companyCode, itemCode, itemType, previousDay);

    console.log(`[Scrap IN Balance] Opening balance (as of ${previousDayStr}): ${openingBalance}`);

    // Calculate total IN quantity (excluding current transaction)
    // For delete validation: include ALL IN transactions up to end of time, excluding the one being deleted
    const totalInResult = await prisma.$queryRaw<Array<{ total_in: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(sti.qty), 0)::numeric as total_in
      FROM scrap_transaction_items sti
      JOIN scrap_transactions st ON st.company_code = sti.scrap_transaction_company
        AND st.id = sti.scrap_transaction_id
        AND st.transaction_date = sti.scrap_transaction_date
      WHERE st.company_code = ${companyCode}
        AND sti.item_code = ${itemCode}
        AND sti.item_type = ${itemType}
        AND st.transaction_type = 'IN'
        AND st.deleted_at IS NULL
        AND sti.deleted_at IS NULL
        AND (${excludeTransactionId} IS NULL OR st.id != ${excludeTransactionId || null})
    `;

    const totalIn = Number(totalInResult[0]?.total_in || 0);
    console.log(`[Scrap IN Balance] Total IN (excluding transaction): ${totalIn}`);

    // Calculate total OUT quantity - INCLUDE ALL OUT TRANSACTIONS
    // For delete validation: we need to check against ALL future OUTs, not just past ones
    // This ensures we detect if deleting this IN would make balance negative at any future date
    const totalOutResult = await prisma.$queryRaw<Array<{ total_out: Prisma.Decimal }>>`
      SELECT COALESCE(SUM(ogi.qty), 0)::numeric as total_out
      FROM outgoing_good_items ogi
      JOIN outgoing_goods og ON og.company_code = ogi.outgoing_good_company
        AND og.id = ogi.outgoing_good_id
        AND og.outgoing_date = ogi.outgoing_good_date
      WHERE og.company_code = ${companyCode}
        AND ogi.item_code = ${itemCode}
        AND ogi.item_type = ${itemType}
        AND og.deleted_at IS NULL
        AND ogi.deleted_at IS NULL
    `;

    const totalOut = Number(totalOutResult[0]?.total_out || 0);
    console.log(`[Scrap IN Balance] Total OUT (all): ${totalOut}`);

    // Calculate balance excluding this transaction: opening + total_in - total_out
    const balanceExcludingThisTx = openingBalance + totalIn - totalOut;
    console.log(`[Scrap IN Balance] CALCULATION: openingBalance(${openingBalance}) + totalIn(${totalIn}) - totalOut(${totalOut}) = balanceExcludingThisTx(${balanceExcludingThisTx})`);

    // After the change, this transaction will have newInQty instead of currentInQty
    // newBalance = (balance without this tx) + newInQty
    const newBalance = balanceExcludingThisTx + newInQty;
    console.log(`[Scrap IN Balance] newBalance = balanceExcludingThisTx(${balanceExcludingThisTx}) + newInQty(${newInQty}) = ${newBalance}`);

    // Check if new balance would be negative
    const isAllowed = newBalance >= 0;
    const shortfall = isAllowed ? undefined : Math.abs(newBalance);

    // For logging: actual current balance (with current transaction included)
    const actualCurrentBalance = balanceExcludingThisTx + currentInQty;

    console.log(`[Scrap IN Balance] For ${itemCode}: actualBalance=${actualCurrentBalance}, currentQty=${currentInQty}, newQty=${newInQty}, newBalance=${newBalance}, allowed=${isAllowed}, shortfall=${shortfall}`);

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
