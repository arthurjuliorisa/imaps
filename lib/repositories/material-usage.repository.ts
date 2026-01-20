import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import type { MaterialUsageBatchRequestInput, MaterialUsageItemInput } from '@/lib/validators/schemas/material-usage.schema';
import { logger } from '@/lib/utils/logger';
import { BaseTransactionRepository } from './base-transaction.repository';

/**
 * Material Usage Repository
 * 
 * Handles database operations for material usage:
 * - Batch insert/upsert material usage records
 * - Company existence validation
 * - Parallel processing for performance
 * - Snapshot recalculation queuing for backdated/same-day transactions
 * 
 * Note: Work order and cost center validation not needed
 * because all data from WMS is already valid
 */

export class MaterialUsageRepository extends BaseTransactionRepository {
  constructor() {
    super();
  }

  /**
   * Batch upsert material usage with date change detection
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
  async batchUpsert(data: MaterialUsageBatchRequestInput): Promise<void> {
    const log = logger.child({
      scope: 'MaterialUsageRepository.batchUpsert',
      wmsId: data.wms_id,
      companyCode: data.company_code,
    });

    try {
      const transactionDate = new Date(data.transaction_date);

      // =========================================================================
      // STEP 1: Find existing by wms_id (ANY date) to detect date change
      // =========================================================================
      const existing = await prisma.material_usages.findFirst({
        where: {
          company_code: data.company_code,
          wms_id: data.wms_id,
          deleted_at: null,
        },
      });

      const oldDate = existing?.transaction_date;
      const isDateChanged = existing && oldDate?.getTime() !== transactionDate.getTime();

      // Query existing items BEFORE any deletion (untuk detect deleted items)
      let existingItemRecords: any[] = [];
      if (existing) {
        existingItemRecords = await prisma.material_usage_items.findMany({
          where: {
            material_usage_id: existing.id,
            material_usage_company: data.company_code,
            material_usage_date: existing.transaction_date,
            deleted_at: null,
          },
        });
      }

      let deletedItems: any[] = [];
      if (isDateChanged && existing && oldDate) {
        // DIFFERENT DATE: Track deleted items for snapshot recalculation
        deletedItems = existingItemRecords;
      } else if (existing && !isDateChanged) {
        // SAME DATE: Identify deleted items (in DB but not in payload)
        const payloadItemKeys = new Set(
          data.items.map(item => `${item.item_type}|${item.item_code}`)
        );

        deletedItems = existingItemRecords.filter(
          dbItem =>
            !payloadItemKeys.has(`${dbItem.item_type}|${dbItem.item_code}`)
        );

        if (deletedItems.length > 0) {
          log.info('Detected deleted items (same date)', {
            deletedCount: deletedItems.length,
            deletedItems: deletedItems.map(i => i.item_code),
          });
        }
      }

      // =========================================================================
      // STEP 2, 3: Transaction - Delete old if date changed, then Upsert new
      // =========================================================================
      const createdItemsMap = new Map<string, number>();
      let header: any; // Declare outside transaction to access after

      // Always use transaction to ensure consistency
      await prisma.$transaction(async (tx) => {
        // If date changed, delete old record first
        if (isDateChanged && existing && oldDate) {
          log.debug('Date changed, soft-deleting old items and header', {
            oldDate,
            newDate: transactionDate,
            wmsId: data.wms_id,
          });

          // Soft delete old items
          await tx.material_usage_items.updateMany({
            where: {
              material_usage_id: existing.id,
              material_usage_company: data.company_code,
              material_usage_date: oldDate,
              deleted_at: null,
            },
            data: {
              deleted_at: new Date(),
            },
          });

          // Delete old header
          await tx.material_usages.delete({
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
        const headerResult = await tx.material_usages.upsert({
          where: {
            company_code_wms_id_transaction_date: {
              company_code: data.company_code,
              wms_id: data.wms_id,
              transaction_date: transactionDate,
            },
          },
          update: {
            work_order_number: data.work_order_number || null,
            cost_center_number: data.cost_center_number || null,
            internal_evidence_number: data.internal_evidence_number,
            reversal: data.reversal || null,
            timestamp: new Date(data.timestamp),
            updated_at: new Date(),
            deleted_at: null,
          },
          create: {
            company_code: data.company_code,
            wms_id: data.wms_id,
            work_order_number: data.work_order_number || null,
            cost_center_number: data.cost_center_number || null,
            internal_evidence_number: data.internal_evidence_number,
            transaction_date: transactionDate,
            reversal: data.reversal || null,
            timestamp: new Date(data.timestamp),
          },
        });

        header = headerResult; // Assign to outer scope variable

        log.info('Header upserted', { materialUsageId: header.id });

        // For update case (same date), use idempotent replace strategy
        // =====================================================================
        // FIX: Delete ALL old items + insert ALL new items for same-date
        // REASON: Eliminates composite key ambiguity when same item_code appears
        //         multiple times (e.g., qty 0.999 + qty 2.001)
        // SAFE: snapshot cascade correctly aggregates all items via upsert_item_stock_snapshot()
        // =====================================================================
        if (!isDateChanged) {
          // Get existing items for deletion
          const existingItems = await tx.material_usage_items.findMany({
            where: {
              material_usage_id: header.id,
              material_usage_company: data.company_code,
              material_usage_date: transactionDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_code: true,
              ppkek_number: true,
            },
          });

          // Soft-delete ALL existing items
          if (existingItems.length > 0) {
            await tx.material_usage_items.updateMany({
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
              reason: 'Same-date idempotency: delete all + insert all to handle duplicate item_codes',
            });
          }

          // Insert ALL new items fresh
          const itemsData = data.items.map((item) => ({
            material_usage_id: header.id,
            material_usage_company: data.company_code,
            material_usage_date: transactionDate,
            item_type: item.item_type,
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
            qty: new Prisma.Decimal(item.qty),
            ppkek_number: item.ppkek_number || null,
          }));

          const createdItems = await tx.material_usage_items.createMany({
            data: itemsData,
            skipDuplicates: false,
          });

          // Map created items for traceability (by composite key)
          const insertedItems = await tx.material_usage_items.findMany({
            where: {
              material_usage_id: header.id,
              material_usage_company: data.company_code,
              material_usage_date: transactionDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_code: true,
              ppkek_number: true,
            },
          });

          insertedItems.forEach(item => {
            // Track by composite key for traceability
            createdItemsMap.set(
              `${item.item_code}|${item.ppkek_number || 'no-ppkek'}`,
              item.id
            );
          });

          log.info('Items replaced (delete all + insert all)', {
            totalItems: data.items.length,
            deletedCount: existingItems.length,
            createdCount: itemsData.length,
          });
        } else {
          // Date changed: insert all new items
          const itemsData = data.items.map((item) => ({
            material_usage_id: header.id,
            material_usage_company: data.company_code,
            material_usage_date: transactionDate,
            item_type: item.item_type,
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
            qty: new Prisma.Decimal(item.qty),
            ppkek_number: item.ppkek_number || null,
          }));

          await tx.material_usage_items.createMany({
            data: itemsData,
          });

          // Map created items for traceability
          const createdItems = await tx.material_usage_items.findMany({
            where: {
              material_usage_id: header.id,
              material_usage_company: data.company_code,
              material_usage_date: transactionDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_code: true,
              ppkek_number: true,
            },
          });

          createdItems.forEach(item => {
            // Track by composite key for traceability
            createdItemsMap.set(
              `${item.item_code}|${item.ppkek_number || 'no-ppkek'}`,
              item.id
            );
          });

          log.info('New items inserted (date change)', {
            insertedCount: itemsData.length,
          });
        }
      });

      log.info('Items managed successfully', {
        totalItems: data.items.length,
        mappedItems: createdItemsMap.size,
      });

      // Prepare items for snapshot recalculation
      const snapshotItems = data.items.map(item => ({
        item_type: item.item_type,
        item_code: item.item_code,
        item_name: item.item_name,
        uom: item.uom,
      }));

      // Step 4: Create traceability records for work order material consumption
      // This links materials (with PPKEK) to their work orders for customs compliance
      if (data.work_order_number && createdItemsMap.size > 0) {
        try {
          for (const item of data.items) {
            if (item.ppkek_number) {
              // Use composite key for lookup
              const itemIdKey = `${item.item_code}|${item.ppkek_number}`;
              const itemId = createdItemsMap.get(itemIdKey);

              if (itemId) {
                await prisma.work_order_material_consumption.upsert({
                  where: {
                    material_usage_wms_id_work_order_number_item_code_ppkek_number: {
                      material_usage_wms_id: data.wms_id,
                      work_order_number: data.work_order_number,
                      item_code: item.item_code,
                      ppkek_number: item.ppkek_number,
                    },
                  },
                  update: {
                    material_usage_id: header.id,
                    material_usage_item_id: itemId,
                    qty_consumed: new Prisma.Decimal(item.qty),
                  },
                  create: {
                    material_usage_id: header.id,
                    material_usage_item_id: itemId,
                    material_usage_wms_id: data.wms_id,
                    work_order_number: data.work_order_number,
                    company_code: data.company_code,
                    item_code: item.item_code,
                    ppkek_number: item.ppkek_number,
                    qty_consumed: new Prisma.Decimal(item.qty),
                    trx_date: transactionDate,
                  },
                });
              }
            }
          }

          const itemsWithPpkek = data.items.filter(
            i => i.ppkek_number && createdItemsMap.has(`${i.item_code}|${i.ppkek_number}`)
          ).length;
          log.info('Traceability records created', {
            count: itemsWithPpkek,
            workOrderNumber: data.work_order_number,
            materialUsageId: header.id,
          });
        } catch (err) {
          log.warn('Failed to create traceability records', {
            error: (err as any).message,
            workOrderNumber: data.work_order_number,
            materialUsageId: header.id,
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
        //   - production_output_items (with reversal handling)
        //   - adjustment_items (with GAIN/LOSS handling)
        //
        // For REVERSAL transactions:
        //   - Original: PHC0126011000001 (qty=10, reversal=NULL) → counts as +10
        //   - Reversal: PHC0126011000001-Reversal (qty=10, reversal='Y') → counts as -10
        //   - Result: material_usage_qty = +10 + (-10) = 0 ✓ CORRECT
        //   - Closing balance = opening + 0 = opening (negates original) ✓
        //
        // Deletion was causing: snapshot deleted → recalc without previous value → wrong closing balance
        // Now: direct upsert with correct calculation on all sources
        // =====================================================================

        // Recalculate snapshots for each item on transaction_date
        // SQL function will aggregate ALL transactions and handle reversal logic
        for (const item of snapshotItems) {
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
          itemCount: snapshotItems.length,
          reversal: data.reversal,
          reason: 'upsert_item_stock_snapshot aggregates all transaction sources correctly'
        });

        // Step 6: Cascade recalculation from transaction_date onwards
        // CRITICAL: Must cascade even on first insert (not just date change)
        // Material usage affects closing_balance which rolls forward to future dates
        // Reversal handling: cascaded snapshots automatically consider reversal logic
        // Example: Material usage on 2026-01-08 affects snapshots on 2026-01-09, 2026-01-10, etc.
        // For reversals: closing_balance will be DECREASED (negation), cascading correctly
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
            // Recalculate old date snapshots (items removed from that date)
            for (const item of snapshotItems) {
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

            // Cascade from old date too (in case old date is after transaction date in future operations)
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
        log.error('Snapshot calculation or cascade failed', {
          error: (snapshotError as any).message,
          itemCount: snapshotItems.length,
        });
        // Don't fail the entire transaction if snapshot fails
      }
    } catch (err: any) {
      log.error('Batch upsert failed', {
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
}
