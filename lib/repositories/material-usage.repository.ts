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

        // For update case (same date), intelligently manage items
        if (!isDateChanged) {
          // Get existing items for this material_usage_id
          // NOTE: Include ppkek_number in selection for proper matching
          const existingItems = await tx.material_usage_items.findMany({
            where: {
              material_usage_id: header.id,
              material_usage_company: data.company_code,
              material_usage_date: transactionDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_type: true,
              item_code: true,
              ppkek_number: true,
              qty: true,
            },
          });

          // Create map using composite key: item_type|item_code|ppkek_number
          // This handles case where same item code has multiple PPKEK entries
          const existingItemMap = new Map(
            existingItems.map(i => [
              `${i.item_type}|${i.item_code}|${i.ppkek_number || 'no-ppkek'}`,
              i,
            ])
          );

          // Create set from payload items with same composite key
          const payloadItemSet = new Set(
            data.items.map(i => `${i.item_type}|${i.item_code}|${i.ppkek_number || 'no-ppkek'}`)
          );

          // 1. Soft-delete items that are no longer in payload
          const itemsToDelete = existingItems.filter(
            item =>
              !payloadItemSet.has(
                `${item.item_type}|${item.item_code}|${item.ppkek_number || 'no-ppkek'}`
              )
          );

          if (itemsToDelete.length > 0) {
            await tx.material_usage_items.updateMany({
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
              deletedItems: itemsToDelete.map(i => ({
                item_code: i.item_code,
                ppkek_number: i.ppkek_number,
              })),
            });
          }

          // 2. Update existing items and 3. Insert new items
          for (const item of data.items) {
            const key = `${item.item_type}|${item.item_code}|${item.ppkek_number || 'no-ppkek'}`;
            const existingItem = existingItemMap.get(key);

            if (existingItem) {
              // Item exists, update it
              await tx.material_usage_items.update({
                where: { id: existingItem.id },
                data: {
                  item_name: item.item_name,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty),
                  ppkek_number: item.ppkek_number || null,
                  updated_at: new Date(),
                  deleted_at: null,
                },
              });
              // Track by composite key for traceability
              createdItemsMap.set(
                `${item.item_code}|${item.ppkek_number || 'no-ppkek'}`,
                existingItem.id
              );
            } else {
              // New item, insert it
              const newItem = await tx.material_usage_items.create({
                data: {
                  material_usage_id: header.id,
                  material_usage_company: data.company_code,
                  material_usage_date: transactionDate,
                  item_type: item.item_type,
                  item_code: item.item_code,
                  item_name: item.item_name,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty),
                  ppkek_number: item.ppkek_number || null,
                },
              });
              // Track by composite key for traceability
              createdItemsMap.set(
                `${item.item_code}|${item.ppkek_number || 'no-ppkek'}`,
                newItem.id
              );
            }
          }

          log.info('Items updated/inserted intelligently', {
            totalItems: data.items.length,
            deletedCount: itemsToDelete.length,
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
        // Delete existing snapshots ONLY FOR AFFECTED ITEMS to avoid overwriting other transactions' data
        // Fix: Previous logic deleted ALL snapshots for the date, which could override incoming goods
        // Now: Only delete snapshots for items that appear in this material usage transaction
        for (const item of snapshotItems) {
          await prisma.stock_daily_snapshot.deleteMany({
            where: {
              company_code: data.company_code,
              item_type: item.item_type,
              item_code: item.item_code,
              snapshot_date: transactionDate,
            },
          });
        }

        log.info('Cleared snapshots for affected items only', {
          company_code: data.company_code,
          snapshot_date: transactionDate.toISOString().split('T')[0],
          affectedItemCount: snapshotItems.length,
          affectedItems: snapshotItems.map(i => i.item_code).join(', '),
        });

        // Update snapshots for each item on transaction_date
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

        log.info('Item-level snapshots calculated', {
          itemCount: snapshotItems.length,
          reversal: data.reversal,
        });

        // Step 5: Cascade recalculation from transaction_date onwards
        // CRITICAL: Must cascade even on first insert (not just date change)
        // Material usage can affect snapshots on transaction_date and ALL future dates
        // Example: Material usage on 2026-01-08 affects snapshots on 2026-01-09, 2026-01-10, etc.
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
