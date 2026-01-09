import { prisma } from '@/lib/prisma';
import type { AdjustmentBatchRequestInput, AdjustmentItemInput } from '@/lib/validators/schemas/adjustment.schema';
import { logger } from '@/lib/utils/logger';
import { BaseTransactionRepository } from './base-transaction.repository';

/**
 * Adjustments Repository
 * 
 * Handles database operations for adjustments:
 * - Insert adjustment records (INSERT ONLY pattern)
 * - Duplicate check by wms_id
 * - Parallel processing for performance
 * - Snapshot recalculation queuing for backdated transactions
 */

export class AdjustmentsRepository extends BaseTransactionRepository {
  constructor() {
    super();
  }

  /**
   * Create adjustment transaction
   * INSERT ONLY pattern - no updates allowed
   */
  async create(data: AdjustmentBatchRequestInput): Promise<any> {
    const log = logger.child({
      scope: 'AdjustmentsRepository.create',
      wmsId: data.wms_id,
      companyCode: data.company_code,
    });

    try {
      const transactionDate = new Date(data.transaction_date);

      // Check for duplicate wms_id
      const existing = await prisma.adjustments.findFirst({
        where: {
          wms_id: data.wms_id,
          company_code: data.company_code,
        },
      });

      if (existing) {
        log.warn('Duplicate wms_id found', {
          existingId: existing.id,
          existingDate: existing.transaction_date,
        });
        throw new Error(
          `Adjustment transaction with wms_id '${data.wms_id}' already exists`
        );
      }

      // Create transaction atomically
      const result = await prisma.$transaction(async (tx) => {
        // Create header
        const header = await tx.adjustments.create({
          data: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            wms_doc_type: data.wms_doc_type || null,
            internal_evidence_number: data.internal_evidence_number,
            transaction_date: transactionDate,
            timestamp: new Date(data.timestamp),
          },
        });

        log.info('Header created', { adjustmentId: header.id });

        // Create items in parallel
        const itemRecords = data.items.map((item) => ({
          adjustment_id: header.id,
          adjustment_company: data.company_code,
          adjustment_date: transactionDate,
          adjustment_type: item.adjustment_type,
          item_type: item.item_type,
          item_code: item.item_code,
          item_name: item.item_name,
          uom: item.uom,
          qty: item.qty,
          reason: item.reason || null,
        }));

        const itemResults = await Promise.allSettled(
          itemRecords.map((record) =>
            tx.adjustment_items.create({
              data: record,
            })
          )
        );

        // Check for failures
        const failures = itemResults.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
          log.warn('Some items failed to insert', {
            failureCount: failures.length,
            totalCount: itemRecords.length,
          });

          failures.forEach((failure, index) => {
            if (failure.status === 'rejected') {
              log.error('Item insert failed', {
                itemCode: itemRecords[index].item_code,
                error: (failure.reason as any)?.message,
              });
            }
          });
        }

        log.info('Batch create completed', {
          adjustmentId: header.id,
          successCount: itemResults.filter((r) => r.status === 'fulfilled').length,
          failureCount: failures.length,
        });

        return { header, items: itemResults };
      });

      // Step 4: Calculate item-level snapshots for adjustment items
      try {
        // For adjustments: 
        // - GAIN (adjustment_type = 'GAIN') → positive quantity
        // - LOSS (adjustment_type = 'LOSS') → negative quantity
        for (const item of data.items) {
          // Determine sign based on adjustment type
          const qtyMultiplier = item.adjustment_type === 'LOSS' ? -1 : 1;
          const adjustedQty = (item.qty * qtyMultiplier).toString();

          await prisma.$executeRawUnsafe(
            `SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)`,
            data.company_code,
            item.item_type,
            item.item_code,
            item.item_name,
            item.uom,
            transactionDate
          );
        }

        log.info('Item-level snapshots calculated', {
          itemCount: data.items.length,
        });
      } catch (snapshotError) {
        log.error('Snapshot calculation failed', {
          error: (snapshotError as any).message,
          itemCount: data.items.length,
        });
        // Don't fail the entire transaction if snapshot fails
      }

      // Step 5: Queue snapshot recalculation if backdated
      await this.handleBackdatedTransaction(
        data.company_code,
        transactionDate,
        data.wms_id,
        'adjustments'
      );

      return result;
    } catch (err: any) {
      log.error('Create failed', {
        error: err.message,
        stack: err.stack,
      });
      throw err;
    }
  }

  /**
   * Check if company exists in database
   */
  async companyExists(companyCode: number): Promise<boolean> {
    try {
      const company = await prisma.companies.findUnique({
        where: { code: companyCode },
        select: { code: true },
      });
      return !!company;
    } catch (err) {
      logger.error('Error checking company existence', {
        companyCode,
        error: (err as any).message,
      });
      return false;
    }
  }

  /**
   * Get adjustment by wms_id
   */
  async getByWmsId(
    wmsId: string,
    companyCode: number
  ): Promise<any | null> {
    try {
      return await prisma.adjustments.findFirst({
        where: {
          wms_id: wmsId,
          company_code: companyCode,
        },
        include: {
          items: true,
        },
      });
    } catch (err) {
      logger.error('Error fetching adjustment', {
        wmsId,
        companyCode,
        error: (err as any).message,
      });
      return null;
    }
  }

  /**
   * Find many adjustments with pagination
   */
  async findMany(params: {
    where?: any;
    skip?: number;
    take?: number;
    orderBy?: any;
  }): Promise<any[]> {
    try {
      return await prisma.adjustments.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: {
          items: true,
        },
      });
    } catch (err) {
      logger.error('Error finding adjustments', {
        error: (err as any).message,
      });
      return [];
    }
  }

  /**
   * Count adjustments
   */
  async count(params: { where?: any }): Promise<number> {
    try {
      return await prisma.adjustments.count({
        where: params.where,
      });
    } catch (err) {
      logger.error('Error counting adjustments', {
        error: (err as any).message,
      });
      return 0;
    }
  }
}
