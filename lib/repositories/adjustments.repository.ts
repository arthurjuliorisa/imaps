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

      // Calculate reconciliation data BEFORE transaction (Phase 5)
      const reconciliationDataMap = await this.calculateReconciliationDataMap(
        data.company_code,
        data.items,
        transactionDate
      );

      log.info('Reconciliation data calculated before transaction', {
        itemCount: reconciliationDataMap.size,
      });

      // =========================================================================
      // SEGREGATE ITEMS: TYPE 1 vs TYPE 2 BEFORE TRANSACTION
      // =========================================================================
      // Type 1 = has stockcount_order_number (STO-related, update wms_stock_opname_items)
      // Type 2 = NO stockcount_order_number (Standalone, NO update to wms_stock_opname_items)
      // MIXED payloads are ALLOWED - each item is handled independently
      const type1Items = data.items.filter(item => !!item.stockcount_order_number);
      const type2Items = data.items.filter(item => !item.stockcount_order_number);
      const hasType1 = type1Items.length > 0;
      const hasType2 = type2Items.length > 0;
      
      // Automatic wms_doc_type mapping based on what's present
      const automappedDocType = hasType1 && !hasType2
        ? 'Stock Opname Adjustment' 
        : hasType2 && !hasType1
        ? 'Standalone Adjustment'
        : 'Mixed Adjustment';  // NEW: For mixed payloads

      log.debug('Adjustment items segregated by type', {
        type1Count: type1Items.length,
        type2Count: type2Items.length,
        automappedDocType: automappedDocType,
      });

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
            wms_doc_type: automappedDocType,  // UPDATED: Use auto-mapped type
            internal_evidence_number: data.internal_evidence_number,
            timestamp: new Date(data.timestamp),
            updated_at: new Date(),
            deleted_at: null,
          },
          create: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            owner: data.owner,
            wms_doc_type: automappedDocType,  // UPDATED: Use auto-mapped type
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
              const reconciliation = reconciliationDataMap.get(item.item_code);
              
              // ✅ v3.4.0 Type 2: Calculate variance tracking (Type 2 only, no stockcount_order_number)
              const isType2 = !item.stockcount_order_number;
              let original_beginning_qty_val: Prisma.Decimal | null = null;
              let original_system_qty_val: Prisma.Decimal | null = null;
              let variance_vs_original_val: Prisma.Decimal | null = null;
              let actual_qty_count_val: Prisma.Decimal | null = null;
              
              if (isType2 && reconciliation) {
                const multiplier = item.adjustment_type === 'LOSS' ? -1 : 1;
                const adjustment_qty_signed = new Prisma.Decimal(item.qty * multiplier);
                original_beginning_qty_val = reconciliation.beginning_qty;
                original_system_qty_val = reconciliation.system_qty;
                actual_qty_count_val = reconciliation.system_qty.plus(adjustment_qty_signed);
                variance_vs_original_val = reconciliation.system_qty.minus(actual_qty_count_val);
              }
              
              await tx.adjustment_items.update({
                where: { id: existingItem.id },
                data: {
                  item_name: item.item_name,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty),
                  reason: item.reason || null,
                  stockcount_order_number: item.stockcount_order_number || null, // NEW for v3.4.0
                  amount: item.amount ? new Prisma.Decimal(item.amount) : null, // NEW for v3.4.0
                  // Phase 5: Add reconciliation fields
                  beginning_qty: reconciliation?.beginning_qty || null,
                  incoming_qty_on_date: reconciliation?.incoming_qty_on_date || null,
                  outgoing_qty_on_date: reconciliation?.outgoing_qty_on_date || null,
                  system_qty: reconciliation?.system_qty || null,
                  adjusted_qty: reconciliation?.adjusted_qty || null,
                  // ✅ v3.4.0: Type 2 history and variance tracking
                  original_beginning_qty: original_beginning_qty_val,
                  original_system_qty: original_system_qty_val,
                  variance_vs_original: variance_vs_original_val,
                  actual_qty_count: actual_qty_count_val,
                  updated_at: new Date(),
                  deleted_at: null,
                },
              });
            } else {
              // New item, insert it
              const reconciliation = reconciliationDataMap.get(item.item_code);
              
              // ✅ v3.4.0 Type 2: Calculate variance tracking (Type 2 only, no stockcount_order_number)
              const isType2 = !item.stockcount_order_number;
              let original_beginning_qty_val: Prisma.Decimal | null = null;
              let original_system_qty_val: Prisma.Decimal | null = null;
              let variance_vs_original_val: Prisma.Decimal | null = null;
              let actual_qty_count_val: Prisma.Decimal | null = null;
              
              if (isType2 && reconciliation) {
                const multiplier = item.adjustment_type === 'LOSS' ? -1 : 1;
                const adjustment_qty_signed = new Prisma.Decimal(item.qty * multiplier);
                original_beginning_qty_val = reconciliation.beginning_qty;
                original_system_qty_val = reconciliation.system_qty;
                actual_qty_count_val = reconciliation.system_qty.plus(adjustment_qty_signed);
                variance_vs_original_val = reconciliation.system_qty.minus(actual_qty_count_val);
              }
              
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
                  stockcount_order_number: item.stockcount_order_number || null, // NEW for v3.4.0
                  amount: item.amount ? new Prisma.Decimal(item.amount) : null, // NEW for v3.4.0
                  // Phase 5: Add reconciliation fields
                  beginning_qty: reconciliation?.beginning_qty || null,
                  incoming_qty_on_date: reconciliation?.incoming_qty_on_date || null,
                  outgoing_qty_on_date: reconciliation?.outgoing_qty_on_date || null,
                  system_qty: reconciliation?.system_qty || null,
                  adjusted_qty: reconciliation?.adjusted_qty || null,
                  // ✅ v3.4.0: Type 2 history and variance tracking
                  original_beginning_qty: original_beginning_qty_val,
                  original_system_qty: original_system_qty_val,
                  variance_vs_original: variance_vs_original_val,
                  actual_qty_count: actual_qty_count_val,
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
          const itemsData = data.items.map((item) => {
            const reconciliation = reconciliationDataMap.get(item.item_code);
            return {
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
              stockcount_order_number: item.stockcount_order_number || null, // NEW for v3.4.0
              amount: item.amount ? new Prisma.Decimal(item.amount) : null, // NEW for v3.4.0
              // Phase 5: Add reconciliation fields
              beginning_qty: reconciliation?.beginning_qty || null,
              incoming_qty_on_date: reconciliation?.incoming_qty_on_date || null,
              outgoing_qty_on_date: reconciliation?.outgoing_qty_on_date || null,
              system_qty: reconciliation?.system_qty || null,
              adjusted_qty: reconciliation?.adjusted_qty || null,
            };
          });

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

      // =========================================================================
      // STEP 6: Update wms_stock_opname_items (TYPE 1 ONLY)
      // =========================================================================
      // CRITICAL: Only Type 1 items (those with stockcount_order_number)
      // should update wms_stock_opname_items. Type 2 (standalone) items remain separate.
      // SUPPORTS MIXED: If payload has both, segregated items are processed independently
      
      try {
        if (hasType1) {
          // DEFENSIVE: Verify type1Items before passing to updateStockOpnameItems
          const allType1ItemsHaveReference = type1Items.every(item => !!item.stockcount_order_number);
          if (!allType1ItemsHaveReference) {
            log.error('Critical bug: type1Items contains items without stockcount_order_number', {
              type1ItemCount: type1Items.length,
            });
            throw new Error('Type 1 item segregation failed - critical bug');
          }

          // Create data object with only Type 1 items for update
          const type1AdjustmentData = { ...data, items: type1Items };
          
          // Pass adjustment_id from header to link Type 1 adjustments
          await this.updateStockOpnameItems(type1AdjustmentData, transactionDate, result.header.id);
          
          log.info('Stock opname items updated (Type 1 only)', {
            type1Count: type1Items.length,
            adjustmentId: result.header.id,
          });
        }
        if (hasType2) {
          // Type 2: Standalone adjustment items - do NOT touch wms_stock_opname_items
          log.debug('Type 2 items will NOT update wms_stock_opname_items', {
            type2Count: type2Items.length,
          });
        }
      } catch (stoError) {
        log.error('Stock opname items update failed', {
          error: (stoError as any).message,
          updatedType: 'TYPE_1',
        });
        // Don't fail the entire transaction if STO update fails
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

  /**
   * Update wms_stock_opname_items with adjustment_qty_signed
   * 
   * ⚠️  TYPE 1 ONLY - This method is called ONLY for adjustments with stockcount_order_number
   * Type 2 (Standalone) adjustments MUST NOT call this method to maintain data integrity
   * 
   * After adjustment items are created, find matching STO items and update them
   * with the adjustment quantity. Matching is based on:
   * - company_code
   * - item_code
   * - item_name
   * - uom
   * - adjustment_type (GAIN/LOSS) should match the variance type in STO
   * 
   * PHASE 5: NEW FEATURE
   * - Link adjustment_id FK for Type 1 adjustments (those with stockcount_order_number)
   * - Enables audit trail from STO items → adjustments
   * 
   * IDEMPOTENCY HANDLING:
   * - First transmit: STO items have adjustment_qty_signed = NULL → UPDATE new data
   * - Resubmit (same wms_id + date): STO items already updated → RESET first, then UPDATE new data
   * 
   * OPTIMIZED: Batch update instead of per-row loop for performance
   * For each item+uom+adjustment_type combination, find the MOST RECENT (by created_at DESC)
   * unprocessed STO item and update in batch
   * 
   * @param data AdjustmentBatchRequestInput (MUST have stockcount_order_number for each item)
   * @param transactionDate Adjustment transaction date
   * @param adjustmentId Adjustment header ID for FK linkage
   */
  private async updateStockOpnameItems(
    data: AdjustmentBatchRequestInput,
    transactionDate: Date,
    adjustmentId: number  // NEW: adjustment header ID for FK linkage
  ): Promise<void> {
    const log = logger.child({
      scope: 'updateStockOpnameItems',
      wmsId: data.wms_id,
      companyCode: data.company_code,
      adjustmentId: adjustmentId,  // NEW: log adjustment ID
    });

    if (data.items.length === 0) {
      return;
    }

    // =========================================================================
    // SAFEGUARD: TYPE 1 ONLY - Verify all items have stockcount_order_number
    // =========================================================================
    // CRITICAL: This method MUST ONLY process items with stockcount_order_number
    // TYPE 2 items (standalone, no stockcount_order_number) MUST NEVER reach this code
    // If they do, abort immediately to prevent corrupting wms_stock_opname_items
    
    const itemsWithoutStockCount = data.items.filter(item => !item.stockcount_order_number);
    
    if (itemsWithoutStockCount.length > 0) {
      log.error('TYPE 2 items detected in updateStockOpnameItems - aborting', {
        type2Count: itemsWithoutStockCount.length,
      });
      return;
    }

    if (data.items.length === 0) {
      return;
    }

    try {
      // Step 1: Get all unique combinations of (item_code, uom) ONLY
      // NOTE: Do NOT include adjustment_type in matching key because:
      // - When STO is first created, adjustment_type = NULL in wms_stock_opname_items
      // - When adjustment is transmitted, adjustment_type is populated
      // - So we match by item_code + uom only, then update adjustment_type field
      const uniqueCombinations = new Map<string, typeof data.items[0]>();
      for (const item of data.items) {
        const key = `${item.item_code}:${item.uom}`;  // NO adjustment_type in key!
        if (!uniqueCombinations.has(key)) {
          uniqueCombinations.set(key, item);
        }
      }

      const uniqueItems = Array.from(uniqueCombinations.values());

      // Step 2: Query matching STO items using Prisma OR conditions
      // Match ONLY by item_code and uom (NOT by adjustment_type, which is NULL until this adjustment)
      // Include system_qty for final_adjusted_qty calculation
      // For idempotency (resubmit): also get STO items that are ALREADY updated (adjustment_qty_signed NOT NULL)
      // This allows reset + re-update on resubmit
      const orConditions = uniqueItems.map((item) => ({
        AND: [
          { item_code: item.item_code },
          { uom: item.uom },
          // REMOVED: { adjustment_type: item.adjustment_type } - This was causing NO MATCH!
        ],
      }));

      const allMatchingStoItems = await prisma.wms_stock_opname_items.findMany({
        where: {
          company_code: data.company_code,
          OR: orConditions,
        },
        select: {
          id: true,
          item_code: true,
          uom: true,
          adjustment_type: true,
          system_qty: true,
          adjustment_qty_signed: true,
          created_at: true,
        },
        orderBy: [
          { item_code: 'asc' },
          { uom: 'asc' },
          { adjustment_type: 'asc' },
          { created_at: 'desc' },
        ],
      });

      if (allMatchingStoItems.length === 0) {
        log.debug('No matching STO items found for adjustment', {
          adjustmentItemCount: data.items.length,
          companyCode: data.company_code,
        });
        return;
      }

      // Step 3: Select ONLY the most recent (latest created_at) for each combination
      // Key is now ONLY (item_code, uom) - NO adjustment_type
      // Prioritize items with NULL adjustment_qty_signed (first transmit) but also accept already-updated ones (resubmit)
      const mostRecentMap = new Map<string, typeof allMatchingStoItems[0]>();
      for (const stoItem of allMatchingStoItems) {
        const key = `${stoItem.item_code}:${stoItem.uom}`;  // NO adjustment_type in key!
        // Since we ordered by created_at DESC, first match is the most recent
        if (!mostRecentMap.has(key)) {
          mostRecentMap.set(key, stoItem);
        }
      }



      // Step 4: Build mapping: (item_code, uom) -> {qty, reason, stockcount_order_number, adjustment_type}
      const adjDataMap = new Map<string, { qty: number; reason: string | null; stockcount_order_number: string | null; adjustment_type: string }>();
      for (const item of data.items) {
        const key = `${item.item_code}:${item.uom}`;  // NO adjustment_type in key!
        adjDataMap.set(key, {
          qty: item.qty,
          reason: item.reason || null,
          stockcount_order_number: item.stockcount_order_number || null,  // Need to check if Type 1
          adjustment_type: item.adjustment_type,  // NEW: Track adjustment type (GAIN/LOSS)
        });
      }



      // Step 5: Prepare batch updates with final_adjusted_qty calculation
      // Respect adjustment_type sign: LOSS = negative, GAIN = positive
      // adjustment_qty_signed = signed qty based on type
      // final_adjusted_qty = system_qty + adjustment_qty_signed
      // Phase 5: Also include adjustment_id if this is a Type 1 adjustment (has stockcount_order_number)
      // Phase 6: Also update adjustment_type field (GAIN/LOSS)
      const updates: Array<{
        id: bigint;
        qty: Prisma.Decimal;
        finalAdjustedQty: Prisma.Decimal;
        reason: string | null;
        adjustmentType: string;  // NEW: Track adjustment type
        isType1: boolean;  // NEW: Track if Type 1 (for adjustment_id linking)
      }> = [];

      for (const [key, stoItem] of mostRecentMap) {
        const adjData = adjDataMap.get(key);
        if (adjData !== undefined) {
          // Apply sign based on adjustment_type from PAYLOAD (stoItem.adjustment_type may be NULL)
          // LOSS = -1, GAIN = +1
          const multiplier = adjData.adjustment_type === 'LOSS' ? -1 : 1;
          const signedQty = new Prisma.Decimal(adjData.qty * multiplier);

          // Calculate final_adjusted_qty = system_qty + adjustment_qty_signed
          const finalQty = stoItem.system_qty.plus(signedQty);

          // Type 1 = has stockcount_order_number (linking back to STO)
          const isType1 = !!adjData.stockcount_order_number;

          updates.push({
            id: stoItem.id,
            qty: signedQty,
            finalAdjustedQty: finalQty,
            reason: adjData.reason,
            adjustmentType: adjData.adjustment_type,  // NEW: From adjustment payload
            isType1: isType1,  // NEW
          });
        }
      }

      if (updates.length === 0) {
        log.debug('No updates to apply after deduplication', {
          matchingCombinations: mostRecentMap.size,
          adjustmentCombinations: data.items.length,
        });
        return;
      }



      // Step 6: Batch update using CASE statements in single UPDATE query
      // Update fields: adjustment_qty_signed, final_adjusted_qty, reason, adjustment_type, adjustment_id
      // AND NEW for v3.4.0: actual_qty_count, variance_qty, variance_vs_original
      const qtyStatements = updates
        .map((u) => `WHEN ${u.id}::bigint THEN ${u.qty.toString()}::decimal(15,3)`)
        .join('\n');

      const finalQtyStatements = updates
        .map((u) => `WHEN ${u.id}::bigint THEN ${u.finalAdjustedQty.toString()}::decimal(15,3)`)
        .join('\n');

      const reasonStatements = updates
        .map((u) => {
          const reasonSql = u.reason ? `'${u.reason.replace(/'/g, "''")}'` : 'NULL';
          return `WHEN ${u.id}::bigint THEN ${reasonSql}`;
        })
        .join('\n');

      // adjustment_type SET for all items (GAIN/LOSS from adjustment payload)
      const adjustmentTypeStatements = updates
        .map((u) => `WHEN ${u.id}::bigint THEN '${u.adjustmentType}'`)
        .join('\n');

      // adjustment_id SET only for Type 1 adjustments
      const adjustmentIdStatements = updates
        .filter(u => u.isType1)  // Only Type 1
        .map((u) => `WHEN ${u.id}::bigint THEN ${adjustmentId}::int`)
        .join('\n');

      // ✅ NEW v3.4.0: actual_qty_count = final_adjusted_qty (same value)
      const actualQtyCountStatements = updates
        .map((u) => `WHEN ${u.id}::bigint THEN ${u.finalAdjustedQty.toString()}::decimal(15,3)`)
        .join('\n');

      // ✅ NEW v3.4.0: variance_qty = |original_system_qty - actual_qty_count|
      const varianceQtyStatements = updates
        .map((u) => `WHEN ${u.id}::bigint THEN ABS(COALESCE(soi.original_system_qty, 0) - ${u.finalAdjustedQty.toString()}::decimal(15,3))`)
        .join('\n');

      // ✅ NEW v3.4.0: variance_vs_original = original_system_qty - actual_qty_count
      const varianceVsOriginalStatements = updates
        .map((u) => `WHEN ${u.id}::bigint THEN (COALESCE(soi.original_system_qty, 0) - ${u.finalAdjustedQty.toString()}::decimal(15,3))::decimal(15,3)`)
        .join('\n');

      const idList = updates.map((u) => `${u.id}::bigint`).join(',');

      const hasType1 = updates.some(u => u.isType1);
      const adjustmentIdUpdateClause = hasType1
        ? `adjustment_id = CASE id
            ${adjustmentIdStatements}
            ELSE adjustment_id
          END,`
        : '';

      // ✅ UPDATED: Include actual_qty_count, variance_qty, variance_vs_original
      await prisma.$executeRawUnsafe(`
        UPDATE wms_stock_opname_items soi
        SET 
          adjustment_qty_signed = CASE id
            ${qtyStatements}
            ELSE adjustment_qty_signed
          END,
          final_adjusted_qty = CASE id
            ${finalQtyStatements}
            ELSE final_adjusted_qty
          END,
          actual_qty_count = CASE id
            ${actualQtyCountStatements}
            ELSE actual_qty_count
          END,
          variance_qty = CASE id
            ${varianceQtyStatements}
            ELSE variance_qty
          END,
          variance_vs_original = CASE id
            ${varianceVsOriginalStatements}
            ELSE variance_vs_original
          END,
          reason = CASE id
            ${reasonStatements}
            ELSE reason
          END,
          adjustment_type = CASE id
            ${adjustmentTypeStatements}
            ELSE adjustment_type
          END,
          ${adjustmentIdUpdateClause}
          updated_at = NOW()
        WHERE id IN (${idList})
      `);

      log.info('STO items updated with Step 3 adjustment data', {
        updatedCount: updates.length,
        adjustmentIdLinked: hasType1,
      });
    } catch (err) {
      log.error('Batch update failed', {
        error: (err as any).message,
        adjustmentItemCount: data.items.length,
      });
      // Don't throw - allow adjustment to complete even if STO update fails
    }
  }

  /**
   * Get Stock Opname records by wms_ids (NEW for v3.4.0)
   * Used to validate stockcount_order_number references
   */
  async getStockOpnamesByWmsIds(
    wmsIds: string[],
    companyCode: number
  ): Promise<Array<{ wms_id: string; status: string }>> {
    return prisma.wms_stock_opnames.findMany({
      where: {
        company_code: companyCode,
        wms_id: { in: wmsIds },
      },
      select: {
        wms_id: true,
        status: true,
      },
    });
  }

  /**
   * Get stock snapshot data for specific date (Phase 3: Stock Data Fetcher)
   * 
   * Retrieves reconciliation data from stock_daily_snapshot table:
   * - opening_balance (beginning_qty on adjustment date)
   * - incoming_qty (incoming goods on adjustment date)
   * - outgoing_qty (outgoing goods on adjustment date)
   * 
   * @param companyCode Company code
   * @param itemCode Item code to lookup
   * @param snapshotDate Date to fetch snapshot for
   * @returns {Promise<StockSnapshot|null>} Snapshot data or null if no record exists
   */
  async getStockSnapshot(
    companyCode: number,
    itemCode: string,
    snapshotDate: Date
  ): Promise<{
    opening_balance: number;
    incoming_qty: number;
    outgoing_qty: number;
  } | null> {
    try {
      const snapshot = await prisma.stock_daily_snapshot.findFirst({
        where: {
          company_code: companyCode,
          item_code: itemCode,
          snapshot_date: snapshotDate,
        },
        select: {
          opening_balance: true,
          incoming_qty: true,
          outgoing_qty: true,
        },
      });

      if (!snapshot) {
        return null;
      }

      return {
        opening_balance: Number(snapshot.opening_balance),
        incoming_qty: Number(snapshot.incoming_qty),
        outgoing_qty: Number(snapshot.outgoing_qty),
      };
    } catch (err) {
      logger.error('Error fetching stock snapshot', {
        companyCode,
        itemCode,
        snapshotDate: snapshotDate.toISOString().split('T')[0],
        error: (err as any).message,
      });
      return null;
    }
  }

  /**
   * Get latest stock snapshot before specific date (Phase 3: Stock Data Fetcher)
   * 
   * Fallback method to find stock data when exact date doesn't exist.
   * Queries for the closest snapshot_date BEFORE the provided date.
   * 
   * Useful for:
   * - Adjustments made without prior snapshot calculation
   * - Retrieving most recent known stock state before adjustment date
   * 
   * @param companyCode Company code
   * @param itemCode Item code to lookup
   * @param beforeDate Find snapshot with snapshot_date < this date
   * @returns {Promise<StockSnapshot|null>} Snapshot data or null if no record exists
   */
  async getLatestStockSnapshotBefore(
    companyCode: number,
    itemCode: string,
    beforeDate: Date
  ): Promise<{
    snapshot_date: Date;
    opening_balance: number;
    incoming_qty: number;
    outgoing_qty: number;
  } | null> {
    try {
      const snapshot = await prisma.stock_daily_snapshot.findFirst({
        where: {
          company_code: companyCode,
          item_code: itemCode,
          snapshot_date: {
            lt: beforeDate,
          },
        },
        select: {
          snapshot_date: true,
          opening_balance: true,
          incoming_qty: true,
          outgoing_qty: true,
        },
        orderBy: {
          snapshot_date: 'desc',
        },
      });

      if (!snapshot) {
        return null;
      }

      return {
        snapshot_date: snapshot.snapshot_date,
        opening_balance: Number(snapshot.opening_balance),
        incoming_qty: Number(snapshot.incoming_qty),
        outgoing_qty: Number(snapshot.outgoing_qty),
      };
    } catch (err) {
      logger.error('Error fetching latest stock snapshot before date', {
        companyCode,
        itemCode,
        beforeDate: beforeDate.toISOString().split('T')[0],
        error: (err as any).message,
      });
      return null;
    }
  }

  /**
   * Calculate reconciliation data for adjustment items (Phase 5: Helper)
   * 
   * For each adjustment item, fetch stock snapshot and calculate:
   * - beginning_qty: Opening balance on adjustment date
   * - incoming_qty_on_date: Incoming goods on adjustment date  
   * - outgoing_qty_on_date: Outgoing goods on adjustment date
   * - system_qty: Expected system quantity (beginning + incoming - outgoing)
   * - adjusted_qty: Final quantity after adjustment (system_qty + variance_qty)
   * 
   * This helper method is called during adjustment creation to populate
   * reconciliation fields in adjustment_items table.
   * 
   * @param companyCode Company code
   * @param items Array of adjustment items with qty variance
   * @param adjustmentDate Adjustment transaction date
   * @returns Map of item_code -> reconciliation data
   */
  private async calculateReconciliationDataMap(
    companyCode: number,
    items: Array<{
      item_code: string;
      item_type: string;
      item_name: string;
      uom: string;
      qty: number;
      adjustment_type: string;
    }>,
    adjustmentDate: Date
  ): Promise<Map<string, {
    beginning_qty: Prisma.Decimal;
    incoming_qty_on_date: Prisma.Decimal;
    outgoing_qty_on_date: Prisma.Decimal;
    system_qty: Prisma.Decimal;
    adjusted_qty: Prisma.Decimal;
  }>> {
    const log = logger.child({
      scope: 'calculateReconciliationDataMap',
      companyCode,
      itemCount: items.length,
    });

    const reconciliationMap = new Map<string, {
      beginning_qty: Prisma.Decimal;
      incoming_qty_on_date: Prisma.Decimal;
      outgoing_qty_on_date: Prisma.Decimal;
      system_qty: Prisma.Decimal;
      adjusted_qty: Prisma.Decimal;
    }>();

    for (const item of items) {
      try {
        // Step 1: Fetch stock snapshot for exact adjustment date
        let snapshot = await this.getStockSnapshot(
          companyCode,
          item.item_code,
          adjustmentDate
        );

        // Step 2: If no exact date, fallback to latest before adjustment date
        if (!snapshot) {
          const snapshotBefore = await this.getLatestStockSnapshotBefore(
            companyCode,
            item.item_code,
            adjustmentDate
          );
          if (snapshotBefore) {
            snapshot = snapshotBefore;
          }
        }

        if (!snapshot) {
          log.warn('No stock snapshot found for item', {
            item_code: item.item_code,
            adjustmentDate: adjustmentDate.toISOString().split('T')[0],
          });

          // Use zeros if no snapshot exists
          snapshot = {
            opening_balance: 0,
            incoming_qty: 0,
            outgoing_qty: 0,
          };
        }

        // Step 3: Calculate reconciliation fields
        const beginning_qty = new Prisma.Decimal(snapshot.opening_balance || 0);
        const incoming_qty_on_date = new Prisma.Decimal(snapshot.incoming_qty || 0);
        const outgoing_qty_on_date = new Prisma.Decimal(snapshot.outgoing_qty || 0);

        // system_qty = beginning + incoming - outgoing
        const system_qty = beginning_qty.plus(incoming_qty_on_date).minus(outgoing_qty_on_date);

        // adjusted_qty = system_qty + variance (respect sign of adjustment_type)
        const multiplier = item.adjustment_type === 'LOSS' ? -1 : 1;
        const signedVariance = new Prisma.Decimal(item.qty * multiplier);
        const adjusted_qty = system_qty.plus(signedVariance);

        reconciliationMap.set(item.item_code, {
          beginning_qty,
          incoming_qty_on_date,
          outgoing_qty_on_date,
          system_qty,
          adjusted_qty,
        });

        log.debug('Reconciliation calculated for item', {
          item_code: item.item_code,
          beginning_qty: beginning_qty.toString(),
          incoming_qty_on_date: incoming_qty_on_date.toString(),
          outgoing_qty_on_date: outgoing_qty_on_date.toString(),
          system_qty: system_qty.toString(),
          adjusted_qty: adjusted_qty.toString(),
        });
      } catch (err) {
        log.error('Failed to calculate reconciliation for item', {
          item_code: item.item_code,
          error: (err as any).message,
        });

        // Use zeros if calculation fails
        reconciliationMap.set(item.item_code, {
          beginning_qty: new Prisma.Decimal(0),
          incoming_qty_on_date: new Prisma.Decimal(0),
          outgoing_qty_on_date: new Prisma.Decimal(0),
          system_qty: new Prisma.Decimal(0),
          adjusted_qty: new Prisma.Decimal(item.qty),
        });
      }
    }

    log.info('Reconciliation calculation completed', {
      successCount: reconciliationMap.size,
      itemCount: items.length,
    });

    return reconciliationMap;
  }
}
