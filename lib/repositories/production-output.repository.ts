import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { ProductionOutputBatchRequestInput, ProductionOutputItemInput } from '@/lib/validators/schemas/production-output.schema';
import { logger } from '@/lib/utils/logger';
import { BaseTransactionRepository } from './base-transaction.repository';

/**
 * Production Output Repository
 * 
 * Handles database operations for production output:
 * - Insert production output records (INSERT ONLY pattern)
 * - Duplicate check by wms_id
 * - Parallel processing for performance
 * - Snapshot recalculation queuing for backdated transactions
 */

export class ProductionOutputRepository extends BaseTransactionRepository {
  constructor() {
    super();
  }

  /**
   * Batch upsert production output with date change detection
   * 
   * =========================================================================
   * NEW FLOW: Detect date change, handle deletion of old records
   * =========================================================================
   * STEP 1: Find existing by wms_id (ANY date) to detect date change
   * STEP 2: If date changed, DELETE old, then INSERT new
   * STEP 3: If same date, UPSERT header and intelligently manage items
   * STEP 4: Create traceability records
   * STEP 5: Calculate item-level snapshots
   * STEP 6: Cascade recalculate if date changed
   *
   * Date Change Scenarios:
   * - Same date: UPSERT → Update/Insert items intelligently → Recalc same date
   * - Different date: DELETE old + INSERT new → Recalc both → Cascade from new date
   */
  async create(data: ProductionOutputBatchRequestInput): Promise<any> {
    const log = logger.child({
      scope: 'ProductionOutputRepository.create',
      wmsId: data.wms_id,
      companyCode: data.company_code,
    });

    try {
      const transactionDate = new Date(data.transaction_date);

      // =========================================================================
      // STEP 1: Find existing by wms_id (ANY date) to detect date change
      // =========================================================================
      const existing = await prisma.production_outputs.findFirst({
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
        existingItemRecords = await prisma.production_output_items.findMany({
          where: {
            production_output_id: existing.id,
            production_output_company: data.company_code,
            production_output_date: existing.transaction_date,
            deleted_at: null,
          },
        });
      }

      const itemCodeToIdMap = new Map<string, number>();

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
          await tx.production_output_items.updateMany({
            where: {
              production_output_id: existing.id,
              production_output_company: data.company_code,
              production_output_date: oldDate,
              deleted_at: null,
            },
            data: {
              deleted_at: new Date(),
            },
          });

          // Delete old header
          await tx.production_outputs.delete({
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
        const header = await tx.production_outputs.upsert({
          where: {
            company_code_wms_id_transaction_date: {
              company_code: data.company_code,
              wms_id: data.wms_id,
              transaction_date: transactionDate,
            },
          },
          update: {
            internal_evidence_number: data.internal_evidence_number,
            reversal: data.reversal || null,
            section: data.section || null,
            timestamp: new Date(data.timestamp),
            updated_at: new Date(),
            deleted_at: null,
          },
          create: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            owner: data.owner,
            internal_evidence_number: data.internal_evidence_number,
            transaction_date: transactionDate,
            reversal: data.reversal || null,
            section: data.section || null,
            timestamp: new Date(data.timestamp),
          },
        });

        log.info('Header upserted', { productionOutputId: header.id });

        // For update case (same date), intelligently manage items
        if (!isDateChanged) {
          // Get existing items for this production_output_id
          const existingItems = await tx.production_output_items.findMany({
            where: {
              production_output_id: header.id,
              production_output_company: data.company_code,
              production_output_date: transactionDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_type: true,
              item_code: true,
              qty: true,
            },
          });

          // ===================================================================
          // FIX: Delete ALL old items + insert ALL new items for same-date
          // ===================================================================
          // REASON: Ensures reversal transactions are handled correctly
          //         When reversal sent with same wms_id + same date:
          //         - Original: qty=50 (reversal=NULL) stored as-is
          //         - Reversal: qty=50 (reversal='Y') stored as-is
          //         - SQL function negates during aggregation (CASE WHEN reversal='Y' THEN -qty)
          //         - Result: production_qty = +50 + (-50) = 0 ✓ CORRECT
          // SAFE: snapshot cascade correctly aggregates all items via upsert_item_stock_snapshot()
          // ===================================================================

          // Soft-delete ALL existing items
          if (existingItems.length > 0) {
            await tx.production_output_items.updateMany({
              where: {
                id: {
                  in: existingItems.map(i => i.id),
                },
              },
              data: {
                deleted_at: new Date(),
              },
            });

            log.info('Soft-deleted all items for idempotent replace', {
              deletedCount: existingItems.length,
              reason: 'Same-date idempotency: delete all + insert all to handle reversal correctly',
            });
          }

          // Insert ALL new items fresh
          const itemsData = data.items.map((item) => ({
            production_output_id: header.id,
            production_output_company: data.company_code,
            production_output_date: transactionDate,
            item_type: item.item_type,
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
            qty: new Prisma.Decimal(item.qty),
            amount: item.amount ? new Prisma.Decimal(item.amount) : null,
          }));

          await tx.production_output_items.createMany({
            data: itemsData,
            skipDuplicates: false,
          });

          // Map created items for traceability
          const insertedItems = await tx.production_output_items.findMany({
            where: {
              production_output_id: header.id,
              production_output_company: data.company_code,
              production_output_date: transactionDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_code: true,
            },
          });

          insertedItems.forEach(item => {
            itemCodeToIdMap.set(item.item_code, item.id);
          });

          log.info('Items replaced (delete all + insert all)', {
            totalItems: data.items.length,
            deletedCount: existingItems.length,
            createdCount: itemsData.length,
          });
        } else {
          // Date changed: insert all new items
          const itemsData = data.items.map((item) => ({
            production_output_id: header.id,
            production_output_company: data.company_code,
            production_output_date: transactionDate,
            item_type: item.item_type,
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
            qty: new Prisma.Decimal(item.qty),
            amount: item.amount ? new Prisma.Decimal(item.amount) : null,
          }));

          await tx.production_output_items.createMany({
            data: itemsData,
          });

          // Map created items
          const createdItems = await tx.production_output_items.findMany({
            where: {
              production_output_id: header.id,
              production_output_company: data.company_code,
              production_output_date: transactionDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_code: true,
            },
          });

          createdItems.forEach(item => {
            itemCodeToIdMap.set(item.item_code, item.id);
          });

          log.info('New items inserted (date change)', {
            insertedCount: itemsData.length,
          });
        }

        return { header, items: [], itemCodeToIdMap };
      });

      log.info('Items managed successfully', {
        totalItems: data.items.length,
        mappedItems: itemCodeToIdMap.size,
      });

      // Step 4: Create traceability records for work order to finished/semifinished goods
      // This links production outputs to their source work orders for PPKEK traceability
      if (result.header && itemCodeToIdMap && itemCodeToIdMap.size > 0) {
        // Delete existing traceability records for this production output
        // when updating, replace with new traceability data
        await prisma.work_order_fg_production.deleteMany({
          where: {
            production_output_id: result.header.id,
            company_code: data.company_code,
          },
        });

        try {
          for (const item of data.items) {
            if (item.work_order_numbers && item.work_order_numbers.length > 0 && itemCodeToIdMap.has(item.item_code)) {
              const itemId = itemCodeToIdMap.get(item.item_code)!;

              for (const woNumber of item.work_order_numbers) {
                await prisma.work_order_fg_production.upsert({
                  where: {
                    work_order_fg_production_unique: {
                      production_wms_id: data.wms_id,
                      work_order_number: woNumber,
                      item_code: item.item_code,
                    },
                  },
                  update: {
                    qty_produced: new Prisma.Decimal(item.qty),
                  },
                  create: {
                    production_output_id: result.header.id,
                    production_output_item_id: itemId,
                    production_wms_id: data.wms_id,
                    work_order_number: woNumber,
                    company_code: data.company_code,
                    item_type: item.item_type,
                    item_code: item.item_code,
                    qty_produced: new Prisma.Decimal(item.qty),
                    trx_date: transactionDate,
                  },
                });
              }
            }
          }

          log.info('Production traceability records created', {
            count: data.items.filter(i => i.work_order_numbers && i.work_order_numbers.length > 0).length,
          });
        } catch (err) {
          log.warn('Failed to create production traceability records', {
            error: (err as any).message,
          });
        }
      }

      // Step 5: Calculate item-level snapshots and cascade recalculation
      try {
        // =====================================================================
        // FIX: Removed snapshot deletion before recalculation
        // =====================================================================
        // REASON: upsert_item_stock_snapshot() SQL function now queries ALL
        // transaction sources on the snapshot_date and recalculates correctly:
        //   - incoming_good_items
        //   - outgoing_good_items
        //   - material_usage_items (with reversal handling: CASE WHEN reversal='Y' THEN -qty)
        //   - production_output_items (with reversal handling: CASE WHEN reversal='Y' THEN -qty)
        //   - adjustment_items (with GAIN/LOSS handling)
        //
        // For REVERSAL transactions:
        //   - Original: WO-001 (qty=50, reversal=NULL) → counts as +50
        //   - Reversal: WO-001-Reversal (qty=50, reversal='Y') → counts as -50
        //   - Result: production_qty = +50 + (-50) = 0 ✓ CORRECT
        //   - Closing balance = opening + 0 = opening (negates original) ✓
        //
        // Deletion was causing: snapshot deleted → recalc without previous value → wrong closing balance
        // Now: direct upsert with correct calculation on all sources
        // =====================================================================

        // Recalculate snapshots for each item on transaction_date
        // SQL function will aggregate ALL transactions and handle reversal logic
        for (const item of data.items) {
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

        log.info('Item-level snapshots recalculated (no pre-deletion)', {
          itemCount: data.items.length,
          reversal: data.reversal,
          reason: 'upsert_item_stock_snapshot aggregates all transaction sources correctly'
        });

        // Step 6: Cascade recalculation from transaction_date onwards
        // CRITICAL: Must cascade even on first insert (not just date change)
        // Production output affects closing_balance which rolls forward to future dates
        // Reversal handling: cascaded snapshots automatically consider reversal logic
        // Example: Production output on 2026-01-08 affects snapshots on 2026-01-09, 2026-01-10, etc.
        // For reversals: closing_balance will be DECREASED (negation), cascading correctly
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
          reversal: data.reversal,
          note: 'All future snapshots recalculated with correct opening_balance from previous closing'
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
   * Get production output by wms_id
   */
  async getByWmsId(
    wmsId: string,
    companyCode: number
  ): Promise<any | null> {
    try {
      return await prisma.production_outputs.findFirst({
        where: {
          wms_id: wmsId,
          company_code: companyCode,
        },
        include: {
          items: true,
        },
      });
    } catch (err) {
      logger.error('Error fetching production output', {
        wmsId,
        companyCode,
        error: (err as any).message,
      });
      return null;
    }
  }

  /**
   * Find many production outputs with pagination
   */
  async findMany(params: {
    where?: any;
    skip?: number;
    take?: number;
    orderBy?: any;
  }): Promise<any[]> {
    try {
      return await prisma.production_outputs.findMany({
        where: params.where,
        skip: params.skip,
        take: params.take,
        orderBy: params.orderBy,
        include: {
          items: true,
        },
      });
    } catch (err) {
      logger.error('Error finding production outputs', {
        error: (err as any).message,
      });
      return [];
    }
  }

  /**
   * Count production outputs
   */
  async count(params: { where?: any }): Promise<number> {
    try {
      return await prisma.production_outputs.count({
        where: params.where,
      });
    } catch (err) {
      logger.error('Error counting production outputs', {
        error: (err as any).message,
      });
      return 0;
    }
  }
}
