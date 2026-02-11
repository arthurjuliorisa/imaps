import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { AdjustmentBatchRequestInput, AdjustmentItemInput } from '@/lib/validators/schemas/adjustment.schema';
import { logger } from '@/lib/utils/logger';
import { BaseTransactionRepository } from './base-transaction.repository';

/**
 * Adjustments Repository
 * 
 * Handles database operations for adjustments:
 * - Upsert adjustment records with date change detection
 * - Company existence validation
 * - Parallel processing for performance
 * - Snapshot recalculation for backdated/same-day transactions
 */

export class AdjustmentsRepository extends BaseTransactionRepository {
  constructor() {
    super();
  }

  /**
   * Create or update adjustment transaction with date change detection
   * 
   * =========================================================================
   * NEW FLOW: Detect date change, handle deletion of old records
   * =========================================================================
   * STEP 1: Find existing by wms_id (ANY date) to detect date change
   * STEP 2: If date changed, DELETE old, then INSERT new
   * STEP 3: If same date, UPSERT header and intelligently manage items
   * STEP 4: Calculate item-level snapshots
   * STEP 5: Cascade recalculate if date changed
   *
   * Date Change Scenarios:
   * - Same date: UPSERT → Update/Insert items intelligently → Recalc same date
   * - Different date: DELETE old + INSERT new → Recalc both → Cascade from new date
   */
  async create(data: AdjustmentBatchRequestInput): Promise<any> {
    const log = logger.child({
      scope: 'AdjustmentsRepository.create',
      wmsId: data.wms_id,
      companyCode: data.company_code,
    });

    try {
      const transactionDate = new Date(data.transaction_date);

      // =========================================================================
      // STEP 1: Find existing by wms_id (ANY date) to detect date change
      // =========================================================================
      const existing = await prisma.adjustments.findFirst({
        where: {
          company_code: data.company_code,
          wms_id: data.wms_id,
          deleted_at: null,
        },
      });

      const oldDate = existing?.transaction_date;
      const isDateChanged = existing && oldDate?.getTime() !== transactionDate.getTime();

      // Query existing items BEFORE any deletion
      let existingItemRecords: any[] = [];
      if (existing) {
        existingItemRecords = await prisma.adjustment_items.findMany({
          where: {
            adjustment_id: existing.id,
            adjustment_company: data.company_code,
            adjustment_date: existing.transaction_date,
            deleted_at: null,
          },
        });
      }

      // =========================================================================
      // STEP 2, 3: Transaction - Delete old if date changed, then Upsert new
      // =========================================================================
      const result = await prisma.$transaction(async (tx) => {
        // If date changed, delete old record first
        if (isDateChanged && existing && oldDate) {
          log.debug('Date changed, soft-deleting old items and header', {
            oldDate,
            newDate: transactionDate,
            wmsId: data.wms_id,
          });

          // Soft delete old items
          await tx.adjustment_items.updateMany({
            where: {
              adjustment_id: existing.id,
              adjustment_company: data.company_code,
              adjustment_date: oldDate,
              deleted_at: null,
            },
            data: {
              deleted_at: new Date(),
            },
          });

          // Delete old header
          await tx.adjustments.delete({
            where: {
              company_code_wms_id_transaction_date: {
                company_code: data.company_code,
                wms_id: data.wms_id,
                transaction_date: oldDate,
              },
            },
          });

          log.info('Old record deleted due to date change', {
            oldDate: oldDate.toISOString().split('T')[0],
          });
        }

        // Upsert header
        const header = await tx.adjustments.upsert({
          where: {
            company_code_wms_id_transaction_date: {
              company_code: data.company_code,
              wms_id: data.wms_id,
              transaction_date: transactionDate,
            },
          },
          update: {
            wms_doc_type: data.wms_doc_type || null,
            internal_evidence_number: data.internal_evidence_number,
            timestamp: new Date(data.timestamp),
            updated_at: new Date(),
            deleted_at: null,
          },
          create: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            owner: data.owner,
            wms_doc_type: data.wms_doc_type || null,
            internal_evidence_number: data.internal_evidence_number,
            transaction_date: transactionDate,
            timestamp: new Date(data.timestamp),
          },
        });

        log.info('Header upserted', { adjustmentId: header.id });

        // For update case (same date), intelligently manage items
        if (!isDateChanged) {
          // Get existing items for this adjustment_id
          const existingItems = await tx.adjustment_items.findMany({
            where: {
              adjustment_id: header.id,
              adjustment_company: data.company_code,
              adjustment_date: transactionDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_type: true,
              item_code: true,
              adjustment_type: true,
              qty: true,
            },
          });

          const existingItemMap = new Map(
            existingItems.map(i => [`${i.item_type}|${i.item_code}|${i.adjustment_type}`, i])
          );
          const payloadItemSet = new Set(
            data.items.map(i => `${i.item_type}|${i.item_code}|${i.adjustment_type}`)
          );

          // 1. Soft-delete items that are no longer in payload
          const itemsToDelete = existingItems.filter(
            item => !payloadItemSet.has(`${item.item_type}|${item.item_code}|${item.adjustment_type}`)
          );

          if (itemsToDelete.length > 0) {
            await tx.adjustment_items.updateMany({
              where: {
                id: {
                  in: itemsToDelete.map(i => i.id),
                },
              },
              data: {
                deleted_at: new Date(),
              },
            });

            log.info('Soft-deleted removed items', {
              deletedCount: itemsToDelete.length,
              deletedItems: itemsToDelete.map(i => i.item_code),
            });
          }

          // 2. Update existing items and 3. Insert new items
          for (const item of data.items) {
            const key = `${item.item_type}|${item.item_code}|${item.adjustment_type}`;
            const existingItem = existingItemMap.get(key);

            if (existingItem) {
              // Item exists, update it
              await tx.adjustment_items.update({
                where: { id: existingItem.id },
                data: {
                  item_name: item.item_name,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty),
                  reason: item.reason || null,
                  updated_at: new Date(),
                  deleted_at: null,
                },
              });
            } else {
              // New item, insert it
              await tx.adjustment_items.create({
                data: {
                  adjustment_id: header.id,
                  adjustment_company: data.company_code,
                  adjustment_date: transactionDate,
                  adjustment_type: item.adjustment_type,
                  item_type: item.item_type,
                  item_code: item.item_code,
                  item_name: item.item_name,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty),
                  reason: item.reason || null,
                },
              });
            }
          }

          log.info('Items updated/inserted intelligently', {
            totalItems: data.items.length,
            deletedCount: itemsToDelete.length,
          });
        } else {
          // Date changed: insert all new items
          const itemsData = data.items.map((item) => ({
            adjustment_id: header.id,
            adjustment_company: data.company_code,
            adjustment_date: transactionDate,
            adjustment_type: item.adjustment_type,
            item_type: item.item_type,
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
            qty: new Prisma.Decimal(item.qty),
            reason: item.reason || null,
          }));

          await tx.adjustment_items.createMany({
            data: itemsData,
          });

          log.info('New items inserted (date change)', {
            insertedCount: itemsData.length,
          });
        }

        return { header, items: [] };
      });

      log.info('Items managed successfully', {
        totalItems: data.items.length,
      });

      // Step 4: Calculate item-level snapshots
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

        // Step 5: Cascade recalculation from transaction_date onwards
        // CRITICAL: Must cascade even on first insert (not just date change)
        // Adjustment can affect snapshots on transaction_date and ALL future dates
        const snapshotItems = data.items.map(item => ({
          item_type: item.item_type,
          item_code: item.item_code,
          item_name: item.item_name,
          uom: item.uom,
        }));

        await this.cascadeRecalculateSnapshots(
          data.company_code,
          snapshotItems,
          transactionDate
        );

        log.info('Cascade recalculation completed', {
          fromDate: transactionDate.toISOString().split('T')[0],
          itemCount: snapshotItems.length,
        });

        // Additional: If date changed, also recalculate old date
        if (isDateChanged && oldDate) {
          try {
            // Recalculate old date snapshots
            for (const item of data.items) {
              await prisma.$executeRawUnsafe(
                `SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)`,
                data.company_code,
                item.item_type,
                item.item_code,
                item.item_name,
                item.uom,
                oldDate
              );
            }

            // Cascade from old date too
            await this.cascadeRecalculateSnapshots(
              data.company_code,
              snapshotItems,
              oldDate
            );

            log.info('Old date snapshots and cascade completed', {
              oldDate: oldDate.toISOString().split('T')[0],
            });
          } catch (oldDateError) {
            log.error('Old date recalculation failed', {
              error: (oldDateError as any).message,
              oldDate: oldDate?.toISOString(),
            });
          }
        }
      } catch (snapshotError) {
        log.error('Snapshot calculation failed', {
          error: (snapshotError as any).message,
          itemCount: data.items.length,
        });
        // Don't fail the entire transaction if snapshot fails
      }

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
