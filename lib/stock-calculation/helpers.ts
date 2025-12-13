/**
 * Stock Calculation Helpers
 *
 * Provides utility functions for stock calculation operations.
 * Includes formatting, date manipulation, and calculation helpers.
 *
 * @module StockCalculationHelpers
 */

import { PrismaClient } from '@prisma/client';

// =====================================================================
// Types and Interfaces
// =====================================================================

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface ItemTypeInfo {
  code: string;
  name: string;
  description: string;
  calculationMethod: 'TRANSACTION' | 'WIP_SNAPSHOT';
}

export interface StockMovementSummary {
  itemCode: string;
  itemName: string;
  itemType: string;
  openingBalance: number;
  incoming: number;
  outgoing: number;
  materialUsage: number;
  production: number;
  adjustment: number;
  closingBalance: number;
  uom: string;
}

// =====================================================================
// Item Type Information
// =====================================================================

export const ITEM_TYPES: Record<string, ItemTypeInfo> = {
  ROH: {
    code: 'ROH',
    name: 'Raw Materials',
    description: 'Raw materials for production',
    calculationMethod: 'TRANSACTION',
  },
  HALB: {
    code: 'HALB',
    name: 'Work in Progress',
    description: 'Semifinished goods in production',
    calculationMethod: 'WIP_SNAPSHOT',
  },
  FERT: {
    code: 'FERT',
    name: 'Finished Goods',
    description: 'Completed products ready for shipment',
    calculationMethod: 'TRANSACTION',
  },
  HIBE: {
    code: 'HIBE',
    name: 'Capital Goods',
    description: 'General capital goods and equipment',
    calculationMethod: 'TRANSACTION',
  },
  'HIBE-M': {
    code: 'HIBE-M',
    name: 'Machinery',
    description: 'Production machinery and equipment',
    calculationMethod: 'TRANSACTION',
  },
  'HIBE-E': {
    code: 'HIBE-E',
    name: 'Engineering Equipment',
    description: 'Engineering and technical equipment',
    calculationMethod: 'TRANSACTION',
  },
  'HIBE-T': {
    code: 'HIBE-T',
    name: 'Tools',
    description: 'Tools and accessories',
    calculationMethod: 'TRANSACTION',
  },
  SCRAP: {
    code: 'SCRAP',
    name: 'Production Scrap',
    description: 'Production waste and scrap material',
    calculationMethod: 'TRANSACTION',
  },
};

export function getItemTypeInfo(itemTypeCode: string): ItemTypeInfo | undefined {
  return ITEM_TYPES[itemTypeCode];
}

export function getAllItemTypes(): ItemTypeInfo[] {
  return Object.values(ITEM_TYPES);
}

export function isCapitalGoodsType(itemTypeCode: string): boolean {
  return ['HIBE', 'HIBE-M', 'HIBE-E', 'HIBE-T'].includes(itemTypeCode);
}

// =====================================================================
// Date Helpers
// =====================================================================

export function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parseDate(dateString: string): Date {
  return new Date(dateString);
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export function subtractDays(date: Date, days: number): Date {
  return addDays(date, -days);
}

export function getDateRange(startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  let currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    dates.push(new Date(currentDate));
    currentDate = addDays(currentDate, 1);
  }

  return dates;
}

export function getMonthRange(year: number, month: number): DateRange {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0);

  return { startDate, endDate };
}

export function getPreviousDay(date: Date): Date {
  return subtractDays(date, 1);
}

export function getNextDay(date: Date): Date {
  return addDays(date, 1);
}

// =====================================================================
// Calculation Formula Helpers
// =====================================================================

export function calculateROHBalance(
  opening: number,
  incoming: number,
  materialUsage: number,
  adjustment: number
): number {
  return opening + incoming - materialUsage + adjustment;
}

export function calculateFERTBalance(
  opening: number,
  production: number,
  outgoing: number,
  adjustment: number
): number {
  return opening + production - outgoing + adjustment;
}

export function calculateHIBEBalance(
  opening: number,
  incoming: number,
  outgoing: number,
  adjustment: number
): number {
  return opening + incoming - outgoing + adjustment;
}

export function calculateSCRAPBalance(
  opening: number,
  incoming: number,
  outgoing: number,
  adjustment: number
): number {
  return opening + incoming - outgoing + adjustment;
}

// =====================================================================
// Formatting Helpers
// =====================================================================

export function formatQuantity(quantity: number, decimals: number = 2): string {
  return quantity.toFixed(decimals);
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function formatPercentage(value: number, decimals: number = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

// =====================================================================
// Stock Movement Summary
// =====================================================================

export async function getStockMovementSummary(
  prisma: PrismaClient,
  companyCode: string,
  itemCode: string,
  startDate: Date,
  endDate: Date
): Promise<StockMovementSummary[]> {
  try {
    const movements = await prisma.$queryRaw<any[]>`
      SELECT
        item_code,
        item_name,
        item_type_code,
        MIN(opening_balance) AS opening_balance,
        SUM(COALESCE(incoming_qty, 0)) AS incoming,
        SUM(COALESCE(outgoing_qty, 0)) AS outgoing,
        SUM(COALESCE(material_usage_qty, 0)) AS material_usage,
        SUM(COALESCE(production_qty, 0)) AS production,
        SUM(COALESCE(adjustment_qty, 0)) AS adjustment,
        MAX(closing_balance) AS closing_balance,
        MAX(uom) AS uom
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND item_code = ${itemCode}
        AND snapshot_date BETWEEN ${startDate}::DATE AND ${endDate}::DATE
      GROUP BY item_code, item_name, item_type_code
      ORDER BY item_code
    `;

    return movements.map((row) => ({
      itemCode: row.item_code,
      itemName: row.item_name,
      itemType: row.item_type_code,
      openingBalance: Number(row.opening_balance),
      incoming: Number(row.incoming),
      outgoing: Number(row.outgoing),
      materialUsage: Number(row.material_usage),
      production: Number(row.production),
      adjustment: Number(row.adjustment),
      closingBalance: Number(row.closing_balance),
      uom: row.uom,
    }));
  } catch (error) {
    throw new Error(
      `Failed to get stock movement summary: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// =====================================================================
// Stock Statistics
// =====================================================================

export interface StockStatistics {
  totalItems: number;
  totalClosingBalance: number;
  itemsByType: Record<string, number>;
  negativeStockCount: number;
  averageBalance: number;
}

export async function getStockStatistics(
  prisma: PrismaClient,
  companyCode: string,
  targetDate: Date
): Promise<StockStatistics> {
  try {
    const stats = await prisma.$queryRaw<any[]>`
      SELECT
        COUNT(DISTINCT item_code) AS total_items,
        SUM(closing_balance) AS total_closing_balance,
        COUNT(CASE WHEN closing_balance < 0 THEN 1 END) AS negative_stock_count,
        AVG(closing_balance) AS average_balance
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND snapshot_date = ${targetDate}::DATE
    `;

    const itemsByType = await prisma.$queryRaw<any[]>`
      SELECT
        item_type_code,
        COUNT(DISTINCT item_code) AS count
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND snapshot_date = ${targetDate}::DATE
      GROUP BY item_type_code
    `;

    const itemsByTypeMap: Record<string, number> = {};
    itemsByType.forEach((row) => {
      itemsByTypeMap[row.item_type_code] = Number(row.count);
    });

    return {
      totalItems: Number(stats[0]?.total_items || 0),
      totalClosingBalance: Number(stats[0]?.total_closing_balance || 0),
      itemsByType: itemsByTypeMap,
      negativeStockCount: Number(stats[0]?.negative_stock_count || 0),
      averageBalance: Number(stats[0]?.average_balance || 0),
    };
  } catch (error) {
    throw new Error(
      `Failed to get stock statistics: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// =====================================================================
// Missing Snapshots Detection
// =====================================================================

export async function findMissingSnapshots(
  prisma: PrismaClient,
  companyCode: string,
  startDate: Date,
  endDate: Date
): Promise<Date[]> {
  try {
    const allDates = getDateRange(startDate, endDate);
    const existingDates = await prisma.$queryRaw<any[]>`
      SELECT DISTINCT snapshot_date
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND snapshot_date BETWEEN ${startDate}::DATE AND ${endDate}::DATE
      ORDER BY snapshot_date
    `;

    const existingDateSet = new Set(
      existingDates.map((row) => formatDate(new Date(row.snapshot_date)))
    );

    return allDates.filter((date) => !existingDateSet.has(formatDate(date)));
  } catch (error) {
    throw new Error(
      `Failed to find missing snapshots: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

// =====================================================================
// Data Consistency Checks
// =====================================================================

export interface ConsistencyCheckResult {
  hasIssues: boolean;
  issues: string[];
}

export async function checkDataConsistency(
  prisma: PrismaClient,
  companyCode: string,
  targetDate: Date
): Promise<ConsistencyCheckResult> {
  const issues: string[] = [];

  try {
    // Check for missing opening balances
    const missingOpeningBalances = await prisma.$queryRaw<any[]>`
      SELECT item_code
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND snapshot_date = ${targetDate}::DATE
        AND opening_balance IS NULL
    `;

    if (missingOpeningBalances.length > 0) {
      issues.push(`${missingOpeningBalances.length} items have missing opening balances`);
    }

    // Check for calculation method consistency
    const invalidCalculationMethods = await prisma.$queryRaw<any[]>`
      SELECT item_code, item_type_code, calculation_method
      FROM stock_daily_snapshot
      WHERE company_code = ${companyCode}
        AND snapshot_date = ${targetDate}::DATE
        AND (
          (item_type_code = 'HALB' AND calculation_method != 'WIP_SNAPSHOT')
          OR (item_type_code != 'HALB' AND calculation_method != 'TRANSACTION')
        )
    `;

    if (invalidCalculationMethods.length > 0) {
      issues.push(
        `${invalidCalculationMethods.length} items have incorrect calculation method for their item type`
      );
    }

    // Check for orphaned transactions (transactions without snapshots)
    const orphanedTransactions = await prisma.$queryRaw<any[]>`
      SELECT DISTINCT t.item_code
      FROM (
        SELECT item_code FROM incoming_details WHERE company_code = ${companyCode} AND trx_date = ${targetDate}::DATE
        UNION
        SELECT item_code FROM outgoing_details WHERE company_code = ${companyCode} AND trx_date = ${targetDate}::DATE
        UNION
        SELECT item_code FROM material_usage_details WHERE company_code = ${companyCode} AND trx_date = ${targetDate}::DATE
      ) t
      LEFT JOIN stock_daily_snapshot s
        ON s.company_code = ${companyCode}
        AND s.item_code = t.item_code
        AND s.snapshot_date = ${targetDate}::DATE
      WHERE s.item_code IS NULL
    `;

    if (orphanedTransactions.length > 0) {
      issues.push(
        `${orphanedTransactions.length} items have transactions but no stock snapshot`
      );
    }
  } catch (error) {
    issues.push(`Error checking data consistency: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    hasIssues: issues.length > 0,
    issues,
  };
}

// =====================================================================
// Batch Processing Helpers
// =====================================================================

export async function batchProcessItems<T>(
  items: T[],
  batchSize: number,
  processor: (batch: T[]) => Promise<void>
): Promise<void> {
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    await processor(batch);
  }
}

// =====================================================================
// Export All Helpers
// =====================================================================

export const helpers = {
  getItemTypeInfo,
  getAllItemTypes,
  isCapitalGoodsType,
  formatDate,
  parseDate,
  addDays,
  subtractDays,
  getDateRange,
  getMonthRange,
  getPreviousDay,
  getNextDay,
  calculateROHBalance,
  calculateFERTBalance,
  calculateHIBEBalance,
  calculateSCRAPBalance,
  formatQuantity,
  formatCurrency,
  formatPercentage,
  getStockMovementSummary,
  getStockStatistics,
  findMissingSnapshots,
  checkDataConsistency,
  batchProcessItems,
};

export default helpers;
