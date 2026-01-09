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
      // Real-time validation: snapshot + live transactions for today
      console.log(`[Stock Check] Using REAL-TIME validation (today)`);
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
      console.log(`[Stock Check] Using snapshot for historical date`);
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
    console.log(`[Snapshot] Found exact snapshot for ${itemCode} on ${dateStr}: ${exactResult[0].closing_balance}`);
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
    console.log(`[Snapshot] Found carried-forward snapshot for ${itemCode} from ${nearestResult}: ${nearestResult[0].closing_balance}`);
    return Number(nearestResult[0].closing_balance);
  }

  // No snapshot found at all - return 0 (conservative approach)
  console.log(`[Snapshot] No snapshot found for ${itemCode}, returning 0`);
  return 0;
}

/**
 * Calculate real-time stock for current date
 * Uses snapshot from yesterday + today's transactions
 * 
 * Strategy:
 * 1. Get opening balance (snapshot from yesterday or beginning_balances)
 * 2. Get all transactions for today (all types), optionally excluding a specific transaction
 * 3. Return: opening + incoming - outgoing - material_usage + production ± adjustment ± scrap
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
  const yesterdayDate = new Date(currentDate);
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);

  // Get opening balance (from previous snapshot or beginning_balances)
  const openingBalance = await getOpeningBalance(
    companyCode,
    itemCode,
    itemType,
    yesterdayDate
  );

  console.log(`[RealTimeStock] Opening balance for ${itemCode}: ${openingBalance}${excludeWmsId ? ` (excluding ${excludeWmsId})` : ''}`);

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

  console.log(`[RealTimeStock] Today transactions net: ${todayTransactions}, final balance: ${balance}`);

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
    const beginningResult = await prisma.$queryRaw<Array<{ initial_qty: Prisma.Decimal }>>`
      SELECT initial_qty
      FROM beginning_balances
      WHERE company_code = ${companyCode}
        AND item_type = ${itemType}
        AND item_code = ${itemCode}
    `;

    if (beginningResult.length > 0) {
      return Number(beginningResult[0].initial_qty);
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
    // Get all transaction types aggregated
    const result = await prisma.$queryRaw<Array<{
      incoming_qty: Prisma.Decimal;
      outgoing_qty: Prisma.Decimal;
      material_usage_qty: Prisma.Decimal;
      production_qty: Prisma.Decimal;
      adjustment_qty: Prisma.Decimal;
      scrap_in_qty: Prisma.Decimal;
      scrap_out_qty: Prisma.Decimal;
    }>>`
      WITH daily_txns AS (
        -- Incoming goods
        SELECT 'incoming' as type, COALESCE(SUM(igi.qty), 0)::numeric as qty
        FROM incoming_good_items igi
        JOIN incoming_goods ig ON ig.company_code = igi.incoming_good_company
          AND ig.id = igi.incoming_good_id
          AND ig.incoming_date = igi.incoming_good_date
        WHERE ig.company_code = ${companyCode}
          AND igi.item_type = ${itemType}
          AND igi.item_code = ${itemCode}
          AND ig.incoming_date = ${dateStr}::DATE
          AND ig.deleted_at IS NULL
          AND igi.deleted_at IS NULL
          ${excludeWmsId ? `AND ig.wms_id != ${excludeWmsId}` : ''}
        
        UNION ALL
        
        -- Outgoing goods
        SELECT 'outgoing' as type, COALESCE(SUM(ogi.qty), 0)::numeric as qty
        FROM outgoing_good_items ogi
        JOIN outgoing_goods og ON og.company_code = ogi.outgoing_good_company
          AND og.id = ogi.outgoing_good_id
          AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.company_code = ${companyCode}
          AND ogi.item_type = ${itemType}
          AND ogi.item_code = ${itemCode}
          AND og.outgoing_date = ${dateStr}::DATE
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
          ${excludeWmsId ? `AND og.wms_id != ${excludeWmsId}` : ''}
        
        UNION ALL
        
        -- Material usage
        SELECT 'material_usage' as type, COALESCE(SUM(
          CASE WHEN mui.reversal = 'Y' THEN -mui.qty ELSE mui.qty END
        ), 0)::numeric as qty
        FROM material_usage_items mui
        JOIN material_usages mu ON mu.company_code = mui.material_usage_company
          AND mu.id = mui.material_usage_id
          AND mu.transaction_date = mui.material_usage_date
        WHERE mu.company_code = ${companyCode}
          AND mui.item_type = ${itemType}
          AND mui.item_code = ${itemCode}
          AND mu.transaction_date = ${dateStr}::DATE
          AND mu.deleted_at IS NULL
          AND mui.deleted_at IS NULL
          ${excludeWmsId ? `AND mu.wms_id != ${excludeWmsId}` : ''}
        
        UNION ALL
        
        -- Production output
        SELECT 'production' as type, COALESCE(SUM(poi.qty), 0)::numeric as qty
        FROM production_output_items poi
        JOIN production_outputs po ON po.company_code = poi.production_output_company
          AND po.id = poi.production_output_id
          AND po.production_date = poi.production_output_date
        WHERE po.company_code = ${companyCode}
          AND poi.item_type = ${itemType}
          AND poi.item_code = ${itemCode}
          AND po.production_date = ${dateStr}::DATE
          AND po.deleted_at IS NULL
          AND poi.deleted_at IS NULL
          ${excludeWmsId ? `AND po.wms_id != ${excludeWmsId}` : ''}
        
        UNION ALL
        
        -- Adjustments
        SELECT 'adjustment' as type, COALESCE(SUM(
          CASE WHEN ai.adjustment_type = 'GAIN' THEN ai.qty ELSE -ai.qty END
        ), 0)::numeric as qty
        FROM adjustment_items ai
        JOIN adjustments a ON a.company_code = ai.adjustment_company
          AND a.id = ai.adjustment_id
          AND a.adjustment_date = ai.adjustment_date
        WHERE a.company_code = ${companyCode}
          AND ai.item_type = ${itemType}
          AND ai.item_code = ${itemCode}
          AND a.adjustment_date = ${dateStr}::DATE
          AND a.deleted_at IS NULL
          AND ai.deleted_at IS NULL
          ${excludeWmsId ? `AND a.wms_id != ${excludeWmsId}` : ''}
        
        UNION ALL
        
        -- Scrap transactions
        SELECT 'scrap' as type, COALESCE(SUM(
          CASE WHEN sti.direction = 'IN' THEN sti.qty ELSE -sti.qty END
        ), 0)::numeric as qty
        FROM scrap_transaction_items sti
        JOIN scrap_transactions st ON st.company_code = sti.scrap_transaction_company
          AND st.id = sti.scrap_transaction_id
          AND st.transaction_date = sti.scrap_transaction_date
        WHERE st.company_code = ${companyCode}
          AND sti.item_type = ${itemType}
          AND sti.item_code = ${itemCode}
          AND st.transaction_date = ${dateStr}::DATE
          AND st.deleted_at IS NULL
          AND sti.deleted_at IS NULL
          ${excludeWmsId ? `AND st.wms_id != ${excludeWmsId}` : ''}
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

    console.log(`[TodayTransactions] ${itemType} ${itemCode}${excludeWmsId ? ` (excl ${excludeWmsId})` : ''}: in=${incomingQty}, out=${outgoingQty}, matUsage=${materialUsageQty}, prod=${productionQty}, adj=${adjustmentQty}, scrapIn=${scrapInQty}, scrapOut=${scrapOutQty}, net=${netTransactions}`);

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

    console.log(`[Scrap IN Balance] Checking: ${itemCode} (${itemType}), currentQty=${currentInQty}, newQty=${newInQty}`);

    // Get opening balance (previous snapshot or beginning_balances)
    const openingBalance = await getOpeningBalance(companyCode, itemCode, itemType, normalizedDate);

    console.log(`[Scrap IN Balance] Opening balance: ${openingBalance}`);

    // Calculate total IN quantity (excluding current transaction)
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
        AND st.transaction_date <= ${dateStr}::DATE
        ${excludeTransactionId ? `AND st.id != ${excludeTransactionId}` : ''}
    `;

    const totalIn = Number(totalInResult[0]?.total_in || 0);
    console.log(`[Scrap IN Balance] Total IN (excluding transaction): ${totalIn}`);

    // Calculate total OUT quantity (up to today, for current balance state)
    const todayDate = normalizeDate(new Date());
    const todayDateStr = formatDateForSql(todayDate);

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
        AND og.outgoing_date <= ${todayDateStr}::DATE
    `;

    const totalOut = Number(totalOutResult[0]?.total_out || 0);
    console.log(`[Scrap IN Balance] Total OUT (up to today): ${totalOut}`);

    // Calculate balance excluding this transaction: opening + total_in - total_out
    const balanceExcludingThisTx = openingBalance + totalIn - totalOut;

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
