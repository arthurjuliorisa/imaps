import { prisma } from '../db/prisma';
import { logger } from '../utils/logger';
import { Prisma } from '@prisma/client';

/**
 * Interface for item data passed to snapshot functions
 */
export interface SnapshotItem {
  item_type: string;
  item_code: string;
  item_name: string;
  uom: string;
}

/**
 * Interface for snapshot calculation result
 */
export interface SnapshotCalculationResult {
  item_code: string;
  opening_balance: number;
  closing_balance: number;
  incoming_qty: number;
  outgoing_qty: number;
  material_usage_qty: number;
  production_qty: number;
  adjustment_qty: number;
  operation: 'INSERT' | 'UPDATE';
}

/**
 * Interface for batch upsert result
 */
export interface BatchUpsertResult {
  item_code: string;
  opening_balance: number | null;
  closing_balance: number | null;
  status: 'SUCCESS' | 'ERROR';
  message: string;
}

/**
 * SnapshotRepository
 * Handles direct recalculation of item-level stock snapshots
 * No queue, no backdating logic - direct upsert and cascade
 */
export class SnapshotRepository {
  private log = logger.child({ context: 'SnapshotRepository' });

  /**
   * Upsert snapshots for multiple items on a specific date
   * This is the main entry point called after each transaction
   *
   * @param companyCode Company code
   * @param items Array of items to calculate snapshots for
   * @param snapshotDate Date to calculate snapshot for
   * @throws Error if database operation fails
   */
  async upsertItemsSnapshot(
    companyCode: number,
    items: SnapshotItem[],
    snapshotDate: Date
  ): Promise<void> {
    const log = this.log.child({
      method: 'upsertItemsSnapshot',
      companyCode,
      snapshotDate,
      itemsCount: items.length,
    });

    if (!items || items.length === 0) {
      log.debug('No items to snapshot');
      return;
    }

    try {
      // Call PostgreSQL function for EACH item (simpler approach, no batch type matching issues)
      let successCount = 0;
      let errorCount = 0;
      const failures: Array<{ item_code: string; message: string }> = [];

      for (const item of items) {
        try {
          // Call single-item function
          const result = await prisma.$queryRaw<SnapshotCalculationResult[]>`
            SELECT * FROM upsert_item_stock_snapshot(
              ${companyCode}::INTEGER,
              ${item.item_type}::VARCHAR(10),
              ${item.item_code}::VARCHAR(50),
              ${item.item_name}::VARCHAR(200),
              ${item.uom}::VARCHAR(20),
              ${snapshotDate}::DATE
            )
          `;

          successCount++;
          log.debug('Item snapshot upserted', {
            item_code: item.item_code,
            operation: result[0]?.operation,
          });
        } catch (itemError: any) {
          errorCount++;
          failures.push({
            item_code: item.item_code,
            message: itemError?.message || 'Unknown error',
          });
        }
      }

      log.info('Snapshot upsert completed', {
        successCount,
        errorCount,
        itemsCount: items.length,
      });

      // Log failures if any
      if (errorCount > 0) {
        log.warn('Some items failed snapshot calculation', {
          failures,
        });
      }
    } catch (error: any) {
      log.error('Failed to upsert items snapshot', {
        errorName: error?.name,
        errorMessage: error?.message,
        errorCode: error?.code,
        errorStack: error?.stack,
      });
      // Don't throw - snapshots are non-blocking
      // Main transaction should continue even if snapshot fails
    }
  }

  /**
   * Cascade recalculate snapshots from a given date onwards
   * Called when a transaction is inserted/updated and affects opening balances of subsequent dates
   *
   * @param companyCode Company code
   * @param itemType Item type (ROH, HALB, FERT, etc)
   * @param itemCode Item code
   * @param fromDate Start date for cascade (inclusive)
   * @returns Number of snapshots recalculated
   */
  async recalculateItemSnapshotsFromDate(
    companyCode: number,
    itemType: string,
    itemCode: string,
    uom: string,
    fromDate: Date
  ): Promise<number> {
    const log = this.log.child({
      method: 'recalculateItemSnapshotsFromDate',
      companyCode,
      itemType,
      itemCode,
      uom,
      fromDate,
    });

    try {
      // Call PostgreSQL function: recalculate_item_snapshots_from_date
      const result = await prisma.$executeRaw`
        SELECT recalculate_item_snapshots_from_date(
          ${companyCode}::INTEGER,
          ${itemType}::VARCHAR(10),
          ${itemCode}::VARCHAR(50),
          ${uom}::VARCHAR(20),
          ${fromDate}::DATE
        )
      `;

      // Extract count from result
      // prisma.$executeRaw returns number of affected rows, but function returns a scalar
      // We need to use $queryRaw to get the return value
      const countResult = await prisma.$queryRaw<[{ recalculate_item_snapshots_from_date: number }]>`
        SELECT recalculate_item_snapshots_from_date(
          ${companyCode}::INTEGER,
          ${itemType}::VARCHAR(10),
          ${itemCode}::VARCHAR(50),
          ${uom}::VARCHAR(20),
          ${fromDate}::DATE
        )
      `;

      const count = countResult[0]?.recalculate_item_snapshots_from_date ?? 0;

      log.info('Cascade recalculation completed', {
        snapshotCount: count,
      });

      return count;
    } catch (error: any) {
      log.error('Failed to cascade recalculate snapshots', {
        errorName: error?.name,
        errorMessage: error?.message,
        errorCode: error?.code,
        errorStack: error?.stack,
      });
      // Don't throw - cascade recalc is non-blocking
      // Return 0 to indicate no snapshots were recalculated
      return 0;
    }
  }

  /**
   * Get the latest snapshot for an item
   * Useful for debugging and verification
   *
   * @param companyCode Company code
   * @param itemType Item type
   * @param itemCode Item code
   * @returns Latest snapshot or null if not found
   */
  async getLatestSnapshot(
    companyCode: number,
    itemType: string,
    itemCode: string
  ) {
    try {
      return await prisma.stock_daily_snapshot.findFirst({
        where: {
          company_code: companyCode,
          item_type: itemType,
          item_code: itemCode,
        },
        orderBy: {
          snapshot_date: 'desc',
        },
      });
    } catch (error: any) {
      this.log.error('Failed to get latest snapshot', {
        companyCode,
        itemType,
        itemCode,
        error: error?.message,
      });
      return null;
    }
  }

  /**
   * Get snapshots for a date range
   * Useful for report generation
   *
   * @param companyCode Company code
   * @param startDate Start date (inclusive)
   * @param endDate End date (inclusive)
   * @returns Array of snapshots
   */
  async getSnapshotsForDateRange(
    companyCode: number,
    startDate: Date,
    endDate: Date
  ) {
    try {
      return await prisma.stock_daily_snapshot.findMany({
        where: {
          company_code: companyCode,
          snapshot_date: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: [
          { item_type: 'asc' },
          { item_code: 'asc' },
          { snapshot_date: 'asc' },
        ],
      });
    } catch (error: any) {
      this.log.error('Failed to get snapshots for date range', {
        companyCode,
        startDate,
        endDate,
        error: error?.message,
      });
      return [];
    }
  }
}
