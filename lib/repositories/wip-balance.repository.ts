// lib/repositories/wip-balance.repository.ts

/**
 * WIP Balance Repository
 * 
 * Purpose:
 * - Handle all database operations for WIP balance records
 * - Implement batch upsert with partial success support
 * - Process records in chunks for performance
 * 
 * Database Schema:
 * - wip_balances (flat table - partitioned by company_code and stock_date)
 * - No detail table (different from incoming goods)
 * - Unique constraint: [company_code, wms_id, stock_date]
 * 
 * Key Differences from Incoming Goods:
 * - Single flat table (no header-detail relationship)
 * - Batch processing (multiple independent records)
 * - Partial success allowed (some records can fail)
 */

import { Prisma } from '@prisma/client';
import prisma from '@/lib/utils/prisma';
import { 
  WipBalanceRecord, 
  WipBalanceUpsertResult,
  WipBalanceBatchResult 
} from '@/lib/types/wip-balance.types';

/**
 * Repository for WIP Balance operations
 */
export class WipBalanceRepository {
  /**
   * Upsert single WIP balance record (idempotent operation)
   * 
   * How it works:
   * 1. Check if record exists using unique constraint
   * 2. If exists: UPDATE with new data
   * 3. If not exists: INSERT new record
   * 
   * Why this approach:
   * - Prisma upsert works well for single flat records
   * - WMS is single source of truth
   * - Idempotent for safe retries
   * 
   * @param record - WIP balance record data
   * @returns Upsert result with record ID
   */
  async upsertSingle(record: WipBalanceRecord): Promise<WipBalanceUpsertResult> {
    try {
      // Check if record exists first (to know if it's update or insert)
      const existing = await prisma.wipBalance.findUnique({
        where: {
          company_code_wms_id_stock_date: {
            company_code: record.company_code,
            wms_id: record.wms_id,
            stock_date: record.stock_date,
          },
        },
        select: { id: true },
      });

      // Perform upsert
      const result = await prisma.wipBalance.upsert({
        where: {
          company_code_wms_id_stock_date: {
            company_code: record.company_code,
            wms_id: record.wms_id,
            stock_date: record.stock_date,
          },
        },
        update: {
          item_type: record.item_type,
          item_code: record.item_code,
          item_name: record.item_name,
          uom: record.uom,
          qty: new Prisma.Decimal(record.qty),
          timestamp: record.timestamp,
          updated_at: new Date(),
        },
        create: {
          wms_id: record.wms_id,
          company_code: record.company_code,
          item_type: record.item_type,
          item_code: record.item_code,
          item_name: record.item_name,
          stock_date: record.stock_date,
          uom: record.uom,
          qty: new Prisma.Decimal(record.qty),
          timestamp: record.timestamp,
        },
        select: { id: true },
      });

      return {
        success: true,
        wms_id: record.wms_id,
        record_id: result.id,
        was_updated: !!existing,
      };
    } catch (error) {
      console.error('Error in WipBalanceRepository.upsertSingle:', error);

      let errorMessage = 'Unknown database error';
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        errorMessage = `Database error: ${error.code} - ${error.message}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      return {
        success: false,
        wms_id: record.wms_id,
        error: errorMessage,
      };
    }
  }

  /**
   * Batch upsert WIP balance records with partial success support
   * 
   * Strategy:
   * - Process records one by one (to isolate failures)
   * - Continue processing even if some records fail
   * - Collect all results for comprehensive response
   * 
   * Why not bulk upsert:
   * - Need to support partial success
   * - Need detailed error tracking per record
   * - One bad record shouldn't block others
   * 
   * Performance consideration:
   * - For large batches, consider chunking in service layer
   * - Repository focuses on correct error handling
   * 
   * @param records - Array of WIP balance records
   * @returns Batch processing result with success/failure counts
   */
  async batchUpsert(records: WipBalanceRecord[]): Promise<WipBalanceBatchResult> {
    const results: WipBalanceUpsertResult[] = [];

    // Process each record individually
    for (const record of records) {
      const result = await this.upsertSingle(record);
      results.push(result);
    }

    // Aggregate results
    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    const failedRecords = results
      .map((result, index) => {
        if (!result.success) {
          return {
            wms_id: result.wms_id,
            row_index: index + 1,
            error: result.error || 'Unknown error',
          };
        }
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      success_count: successCount,
      failed_count: failedCount,
      failed_records: failedRecords,
    };
  }

  /**
   * Find WIP balance record by WMS ID (for debugging/verification)
   * 
   * @param company_code - Company code
   * @param wms_id - WMS record ID
   * @returns WIP balance record or null
   */
  async findByWmsId(company_code: number, wms_id: string) {
    try {
      const record = await prisma.wipBalance.findFirst({
        where: {
          company_code,
          wms_id,
          deleted_at: null,
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      return record;
    } catch (error) {
      console.error('Error in WipBalanceRepository.findByWmsId:', error);
      return null;
    }
  }

  /**
   * Find WIP balance records by date (for daily snapshot verification)
   * 
   * @param company_code - Company code
   * @param stock_date - Stock date
   * @returns Array of WIP balance records
   */
  async findByDate(company_code: number, stock_date: Date) {
    try {
      const records = await prisma.wipBalance.findMany({
        where: {
          company_code,
          stock_date,
          deleted_at: null,
        },
        orderBy: {
          item_code: 'asc',
        },
      });

      return records;
    } catch (error) {
      console.error('Error in WipBalanceRepository.findByDate:', error);
      return [];
    }
  }

  /**
   * Soft delete WIP balance record
   * 
   * Note: This is for future use (not part of current API contract)
   * 
   * @param id - Record ID
   * @returns Success status
   */
  async softDelete(id: number): Promise<boolean> {
    try {
      await prisma.wipBalance.update({
        where: { id },
        data: { deleted_at: new Date() },
      });

      return true;
    } catch (error) {
      console.error('Error in WipBalanceRepository.softDelete:', error);
      return false;
    }
  }

  /**
   * Soft delete all records for a specific date
   * 
   * Use case: Replace entire day's snapshot
   * 
   * @param company_code - Company code
   * @param stock_date - Stock date
   * @returns Success status
   */
  async softDeleteByDate(company_code: number, stock_date: Date): Promise<boolean> {
    try {
      await prisma.wipBalance.updateMany({
        where: {
          company_code,
          stock_date,
          deleted_at: null,
        },
        data: { deleted_at: new Date() },
      });

      return true;
    } catch (error) {
      console.error('Error in WipBalanceRepository.softDeleteByDate:', error);
      return false;
    }
  }

  /**
   * Get statistics for monitoring
   * 
   * @param company_code - Company code
   * @param from_date - Start date
   * @param to_date - End date
   * @returns Statistics object
   */
  async getStatistics(
    company_code: number,
    from_date: Date,
    to_date: Date
  ): Promise<{
    total_records: number;
    unique_items: number;
    total_qty: number;
    by_item_type: Record<string, number>;
  }> {
    try {
      const records = await prisma.wipBalance.findMany({
        where: {
          company_code,
          stock_date: {
            gte: from_date,
            lte: to_date,
          },
          deleted_at: null,
        },
        select: {
          item_code: true,
          item_type: true,
          qty: true,
        },
      });

      const totalRecords = records.length;
      const uniqueItems = new Set(records.map(r => r.item_code)).size;
      const totalQty = records.reduce((sum, r) => sum + Number(r.qty), 0);

      // Group by item type
      const byItemType: Record<string, number> = {};
      records.forEach(record => {
        const itemType = record.item_type;
        byItemType[itemType] = (byItemType[itemType] || 0) + 1;
      });

      return {
        total_records: totalRecords,
        unique_items: uniqueItems,
        total_qty: totalQty,
        by_item_type: byItemType,
      };
    } catch (error) {
      console.error('Error in WipBalanceRepository.getStatistics:', error);
      return {
        total_records: 0,
        unique_items: 0,
        total_qty: 0,
        by_item_type: {},
      };
    }
  }

  /**
   * Count records for a specific date (for verification)
   * 
   * @param company_code - Company code
   * @param stock_date - Stock date
   * @returns Record count
   */
  async countByDate(company_code: number, stock_date: Date): Promise<number> {
    try {
      const count = await prisma.wipBalance.count({
        where: {
          company_code,
          stock_date,
          deleted_at: null,
        },
      });

      return count;
    } catch (error) {
      console.error('Error in WipBalanceRepository.countByDate:', error);
      return 0;
    }
  }
}

// Export singleton instance
export const wipBalanceRepository = new WipBalanceRepository();
