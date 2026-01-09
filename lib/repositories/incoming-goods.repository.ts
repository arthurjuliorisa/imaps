import { Prisma } from '@prisma/client';
import { prisma } from '../db/prisma';
import { BaseTransactionRepository } from './base-transaction.repository';
import { SnapshotItem } from './snapshot.repository';
import { logger } from '../utils/logger';
import type { IncomingGoodRequestInput } from '../validators/schemas/incoming-goods.schema';

export interface IncomingGoodsCreateResult {
  id: number;
  wms_id: string;
  company_code: number;
  incoming_date: Date;
  items_count: number;
}

export class IncomingGoodsRepository extends BaseTransactionRepository {
  /**
   * Create or update incoming goods with items (Upsert pattern for idempotency)
   * 
   * =========================================================================
   * NEW FLOW: Direct Snapshot Recalculation (No Queue)
   * =========================================================================
   * STEP 1: Find existing by wms_id (ANY date) to detect date change
   * STEP 2: If date changed, DELETE old, then INSERT new
   * STEP 3: Update/Insert header and items
   * STEP 4: Direct recalculate snapshot on transaction date
   * STEP 5: Cascade recalculate snapshots from transaction date onwards
   *
   * Date Change Scenarios:
   * - Same date: UPSERT → Recalc same date → Cascade
   * - Different date: DELETE old + INSERT new → Recalc both → Cascade from earlier date
   */
  async createOrUpdate(data: IncomingGoodRequestInput): Promise<IncomingGoodsCreateResult> {
    const requestLogger = logger.child({ wmsId: data.wms_id });

    try {
      const incomingDate = new Date(data.incoming_date);
      const customsRegDate = new Date(data.customs_registration_date);
      const invoiceDate = new Date(data.invoice_date);
      const timestamp = new Date(data.timestamp);

      // =========================================================================
      // STEP 1: Find existing by wms_id (ANY date) to detect date change
      // =========================================================================
      const existing = await prisma.incoming_goods.findFirst({
        where: {
          company_code: data.company_code,
          wms_id: data.wms_id,
          deleted_at: null,
        },
      });

      const oldDate = existing?.incoming_date;
      const isDateChanged = existing && oldDate?.getTime() !== incomingDate.getTime();

      // Prepare old items for later recalculation
      let oldItems: SnapshotItem[] = [];
      let datesToRecalculate: Date[] = [];
      let deletedItems: SnapshotItem[] = []; // Track items removed from same date

      // Query existing items BEFORE any deletion (untuk detect deleted items)
      let existingItemRecords: any[] = [];
      if (existing) {
        existingItemRecords = await prisma.incoming_good_items.findMany({
          where: {
            incoming_good_id: existing.id,
            incoming_good_company: data.company_code,
            incoming_good_date: existing.incoming_date, // Use existing date
            deleted_at: null,
          },
        });
      }

      if (isDateChanged && existing && oldDate) {
        // Query old items untuk snapshot recalculation (different date)
        const oldItemRecords = await prisma.incoming_good_items.findMany({
          where: {
            incoming_good_id: existing.id,
            incoming_good_company: data.company_code,
            incoming_good_date: oldDate,
            deleted_at: null,
          },
        });

        oldItems = oldItemRecords.map(item => ({
          item_type: item.item_type,
          item_code: item.item_code,
          item_name: item.item_name,
          uom: item.uom,
        }));

        datesToRecalculate.push(oldDate);
      } else if (existing && !isDateChanged) {
        // SAME DATE: Identify deleted items (in DB but not in payload)
        const payloadItemKeys = new Set(
          data.items.map(item => `${item.item_type}|${item.item_code}`)
        );

        deletedItems = existingItemRecords
          .filter(
            dbItem =>
              !payloadItemKeys.has(`${dbItem.item_type}|${dbItem.item_code}`)
          )
          .map(item => ({
            item_type: item.item_type,
            item_code: item.item_code,
            item_name: item.item_name,
            uom: item.uom,
          }));

        if (deletedItems.length > 0) {
          requestLogger.info('Detected deleted items (same date)', {
            deletedCount: deletedItems.length,
            deletedItems: deletedItems.map(i => i.item_code),
          });
        }
      }

      // =========================================================================
      // STEP 2, 3: Transaction - Delete old if date changed, then Upsert new
      // =========================================================================
      const result = await prisma.$transaction(async (tx) => {
        // If date changed, delete old record first
        // (because unique key includes date, UPSERT won't work for date change)
        if (isDateChanged && existing && oldDate) {
          requestLogger.debug('Date changed, soft-deleting old items', {
            oldDate,
            newDate: incomingDate,
            wmsId: data.wms_id,
          });

          // Soft delete old items (preserve data for audit trail & snapshot recalc)
          await tx.incoming_good_items.updateMany({
            where: {
              incoming_good_id: existing.id,
              incoming_good_company: data.company_code,
              incoming_good_date: oldDate,
              deleted_at: null,
            },
            data: {
              deleted_at: new Date(),
            },
          });

          await tx.incoming_goods.delete({
            where: {
              company_code_wms_id_incoming_date: {
                company_code: data.company_code,
                wms_id: data.wms_id,
                incoming_date: oldDate!,
              },
            },
          });
        }

        // Upsert incoming goods header
        const incomingGood = await tx.incoming_goods.upsert({
          where: {
            company_code_wms_id_incoming_date: {
              company_code: data.company_code,
              wms_id: data.wms_id,
              incoming_date: incomingDate,
            },
          },
          update: {
            owner: data.owner,
            customs_document_type: data.customs_document_type as any,
            ppkek_number: data.ppkek_number,
            customs_registration_date: customsRegDate,
            incoming_evidence_number: data.incoming_evidence_number,
            invoice_number: data.invoice_number,
            invoice_date: invoiceDate,
            shipper_name: data.shipper_name,
            timestamp: timestamp,
            updated_at: new Date(),
            deleted_at: null,
          },
          create: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            owner: data.owner,
            customs_document_type: data.customs_document_type as any,
            ppkek_number: data.ppkek_number,
            customs_registration_date: customsRegDate,
            incoming_evidence_number: data.incoming_evidence_number,
            incoming_date: incomingDate,
            invoice_number: data.invoice_number,
            invoice_date: invoiceDate,
            shipper_name: data.shipper_name,
            timestamp: timestamp,
          },
        });

        // For update case (same date), intelligently manage items:
        // - Only soft-delete items that are no longer in payload
        // - Keep & update existing items that are still present
        // - Insert only new items
        if (!isDateChanged) {
          // Get existing items for this incoming_good_id
          const existingItems = await tx.incoming_good_items.findMany({
            where: {
              incoming_good_id: incomingGood.id,
              incoming_good_company: data.company_code,
              incoming_good_date: incomingDate,
              deleted_at: null,
            },
            select: {
              id: true,
              item_type: true,
              item_code: true,
              qty: true,
            },
          });

          const existingItemMap = new Map(
            existingItems.map(i => [`${i.item_type}|${i.item_code}`, i])
          );
          const payloadItemSet = new Set(
            data.items.map(i => `${i.item_type}|${i.item_code}`)
          );

          // 1. Soft-delete items that are no longer in payload
          const itemsToDelete = existingItems.filter(
            item => !payloadItemSet.has(`${item.item_type}|${item.item_code}`)
          );

          if (itemsToDelete.length > 0) {
            await tx.incoming_good_items.updateMany({
              where: {
                id: {
                  in: itemsToDelete.map(i => i.id),
                },
              },
              data: {
                deleted_at: new Date(),
              },
            });
          }

          // 2. Update existing items with new quantities/details
          for (const item of data.items) {
            const key = `${item.item_type}|${item.item_code}`;
            const existing = existingItemMap.get(key);

            if (existing) {
              // Item exists, update it
              await tx.incoming_good_items.update({
                where: { id: existing.id },
                data: {
                  item_name: item.item_name,
                  hs_code: item.hs_code || null,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty),
                  currency: item.currency as any,
                  amount: new Prisma.Decimal(item.amount),
                  updated_at: new Date(),
                },
              });
            } else {
              // New item, insert it
              await tx.incoming_good_items.create({
                data: {
                  incoming_good_id: incomingGood.id,
                  incoming_good_company: data.company_code,
                  incoming_good_date: incomingDate,
                  item_type: item.item_type,
                  item_code: item.item_code,
                  item_name: item.item_name,
                  hs_code: item.hs_code || null,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty),
                  currency: item.currency as any,
                  amount: new Prisma.Decimal(item.amount),
                },
              });
            }
          }
        } else {
          // Date changed: soft-delete all old items, insert all new
          // Create new items
          const itemsData = data.items.map((item) => ({
            incoming_good_id: incomingGood.id,
            incoming_good_company: data.company_code,
            incoming_good_date: incomingDate,
            item_type: item.item_type,
            item_code: item.item_code,
            item_name: item.item_name,
            hs_code: item.hs_code || null,
            uom: item.uom,
            qty: new Prisma.Decimal(item.qty),
            currency: item.currency as any,
            amount: new Prisma.Decimal(item.amount),
          }));

          await tx.incoming_good_items.createMany({
            data: itemsData,
          });
        }

        requestLogger.info('Incoming goods saved successfully', {
          incomingGoodId: incomingGood.id,
          itemsCount: data.items.length,
          companyCode: data.company_code,
          incomingDate: incomingDate,
          dateChanged: isDateChanged,
        });

        return {
          id: incomingGood.id,
          wms_id: incomingGood.wms_id,
          company_code: incomingGood.company_code,
          incoming_date: incomingGood.incoming_date,
          items_count: data.items.length,
        };
      });

      // Prepare new items for snapshot
      const newItems: SnapshotItem[] = data.items.map(item => ({
        item_type: item.item_type,
        item_code: item.item_code,
        item_name: item.item_name,
        uom: item.uom,
      }));

      // =========================================================================
      // STEP 4 & 5: Snapshot Updates (DIRECT, NO QUEUE, NON-BLOCKING)
      // =========================================================================

      // If date changed: recalc OLD date first (items removed from that date)
      if (isDateChanged && oldDate) {
        requestLogger.info('Recalculating snapshot for old date', {
          oldDate,
          items: oldItems.length,
        });
        await this.updateItemSnapshots(data.company_code, oldItems, oldDate, data.wms_id, 'incoming_goods_old');

        // Cascade from old date
        await this.cascadeRecalculateSnapshots(data.company_code, oldItems, oldDate);
      }

      // Recalc NEW date (items added to that date)
      requestLogger.info('Recalculating snapshot for new date', {
        newDate: result.incoming_date,
        items: newItems.length,
      });
      await this.updateItemSnapshots(data.company_code, newItems, result.incoming_date, data.wms_id, 'incoming_goods_new');

      // Recalc DELETED items (same date, items removed)
      // Need to recalc them too because incoming_good_items were deleted
      // Snapshot incoming_qty should become 0 for deleted items
      if (deletedItems.length > 0) {
        requestLogger.info('Recalculating snapshot for deleted items', {
          newDate: result.incoming_date,
          items: deletedItems.length,
          deletedItemCodes: deletedItems.map(i => i.item_code),
        });
        await this.updateItemSnapshots(
          data.company_code,
          deletedItems,
          result.incoming_date,
          data.wms_id,
          'incoming_goods_deleted'
        );
      }

      // Cascade from new date
      await this.cascadeRecalculateSnapshots(data.company_code, newItems, result.incoming_date);

      // Also cascade for deleted items if same date
      if (deletedItems.length > 0) {
        await this.cascadeRecalculateSnapshots(data.company_code, deletedItems, result.incoming_date);
      }

      requestLogger.info('Incoming goods and snapshots fully processed', {
        id: result.id,
        wmsId: data.wms_id,
        incomingDate: result.incoming_date,
      });

      return result;
    } catch (error) {
      requestLogger.error('Failed to save incoming goods', { error });
      throw error;
    }
  }

  /**
   * Find incoming goods by wms_id
   */
  async findByWmsId(
    company_code: number,
    wms_id: string,
    incoming_date: Date
  ): Promise<any | null> {
    // Validasi incoming_date adalah Date
    if (!(incoming_date instanceof Date) || isNaN(incoming_date.getTime())) {
      throw new Error('incoming_date must be a valid Date object');
    }

    return await prisma.incoming_goods.findUnique({
      where: {
        company_code_wms_id_incoming_date: {
          company_code,
          wms_id,
          incoming_date,
        },
      },
      include: {
        // companies: true, // Removed as it does not exist in the model
      },
    });
  }

  /**
   * Batch query companies by code (optimization)
   * Fetch multiple companies in one query instead of individual lookups
   */
  async getCompaniesByCode(companyCodes: number[]) {
    try {
      const companies = await prisma.companies.findMany({
        where: {
          code: {
            in: companyCodes,
          },
        },
        select: {
          code: true,
          status: true,
        },
      });
      return companies;
    } catch (error) {
      logger.error('Error in IncomingGoodsRepository.getCompaniesByCode:', { error, companyCodes });
      return [];
    }
  }
  /**
   * Check if company exists and is active
   */
  async companyExists(company_code: number): Promise<boolean> {
    try {
      const company = await prisma.companies.findUnique({ // Change 'company' to 'companies'
        where: { code: company_code },
      });
      return company !== null && company.status === 'ACTIVE';
    } catch (error) {
      logger.error({ error, company_code });
      return false;
    }
  }
}