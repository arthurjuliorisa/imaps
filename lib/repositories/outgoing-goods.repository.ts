import { logger } from '@/lib/utils/logger';
import { prisma } from '@/lib/prisma';
import type { OutgoingGoodRequestInput } from '@/lib/validators/schemas/outgoing-goods.schema';
import { Prisma } from '@prisma/client';
import { BaseTransactionRepository } from './base-transaction.repository';
import type { SnapshotItem } from './snapshot.repository';

/**
 * Outgoing Goods Repository
 * 
 * Handles database operations for outgoing goods:
 * - Insert outgoing goods records (header + items)
 * - Insert traceability for FERT/HALB items
 * - Queue snapshot recalculation with backdated detection
 * - Support for backdated transaction immediate processing
 */

export class OutgoingGoodsRepository extends BaseTransactionRepository {
  constructor() {
    super();
  }
  /**
   * Insert outgoing goods asynchronously (non-blocking)
   * This is called AFTER the response is returned to the client
   */
  async insertOutgoingGoodsAsync(data: OutgoingGoodRequestInput): Promise<void> {
    const repositoryLogger = logger.child({
      repository: 'OutgoingGoodsRepository',
      method: 'insertOutgoingGoodsAsync',
      wmsId: data.wms_id,
    });

    try {
      // Parse dates
      const outgoingDate = new Date(data.outgoing_date);
      const customsRegistrationDate = new Date(data.customs_registration_date);
      const invoiceDate = new Date(data.invoice_date);

      // =========================================================================
      // STEP 1: Detect date change (check if this wms_id had previous record)
      // =========================================================================
      let isDateChanged = false;
      let oldDate: Date | null = null;
      let existing: any = null;

      const previousRecord = await prisma.outgoing_goods.findFirst({
        where: {
          company_code: data.company_code,
          wms_id: data.wms_id,
          deleted_at: null,
        },
        orderBy: { outgoing_date: 'desc' },
      });

      if (previousRecord) {
        existing = previousRecord;
        oldDate = previousRecord.outgoing_date;
        isDateChanged = oldDate.getTime() !== outgoingDate.getTime();

        if (isDateChanged) {
          repositoryLogger.info('Date change detected', {
            oldDate,
            newDate: outgoingDate,
            wmsId: data.wms_id,
          });
        }
      }

      // Build payload item set for comparison
      const payloadItemKeys = new Set(
        data.items.map(item => `${item.item_type}|${item.item_code}`)
      );

      // Detect deleted items (same date update only)
      let deletedItems: any[] = [];
      if (!isDateChanged && existing && oldDate) {
        const dbItems = await prisma.outgoing_good_items.findMany({
          where: {
            outgoing_good_id: existing.id,
            outgoing_good_company: data.company_code,
            outgoing_good_date: oldDate,
            deleted_at: null,
          },
        });

        deletedItems = dbItems
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
          repositoryLogger.info('Detected deleted items (same date)', {
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
        if (isDateChanged && existing && oldDate) {
          repositoryLogger.debug('Date changed, soft-deleting old items', {
            oldDate,
            newDate: outgoingDate,
            wmsId: data.wms_id,
          });

          // Soft delete old items (preserve data for audit trail & snapshot recalc)
          await tx.outgoing_good_items.updateMany({
            where: {
              outgoing_good_id: existing.id,
              outgoing_good_company: data.company_code,
              outgoing_good_date: oldDate,
              deleted_at: null,
            },
            data: {
              deleted_at: new Date(),
            },
          });

          await tx.outgoing_goods.delete({
            where: {
              company_code_wms_id_outgoing_date: {
                company_code: data.company_code,
                wms_id: data.wms_id,
                outgoing_date: oldDate!,
              },
            },
          });
        }

        // Upsert outgoing_goods header
        const outgoingGood = await tx.outgoing_goods.upsert({
          where: {
            company_code_wms_id_outgoing_date: {
              company_code: data.company_code,
              wms_id: data.wms_id,
              outgoing_date: outgoingDate,
            },
          },
          update: {
            owner: data.owner,
            customs_document_type: data.customs_document_type as any,
            ppkek_number: data.ppkek_number,
            customs_registration_date: customsRegistrationDate,
            outgoing_evidence_number: data.outgoing_evidence_number,
            invoice_number: data.invoice_number,
            invoice_date: invoiceDate,
            recipient_name: data.recipient_name,
            timestamp: new Date(data.timestamp),
            updated_at: new Date(),
            deleted_at: null,
          },
          create: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            owner: data.owner,
            customs_document_type: data.customs_document_type as any,
            ppkek_number: data.ppkek_number,
            customs_registration_date: customsRegistrationDate,
            outgoing_evidence_number: data.outgoing_evidence_number,
            outgoing_date: outgoingDate,
            invoice_number: data.invoice_number,
            invoice_date: invoiceDate,
            recipient_name: data.recipient_name,
            timestamp: new Date(data.timestamp),
          },
        });

        repositoryLogger.info('Outgoing goods header upserted', { outgoingGoodId: outgoingGood.id });

        // For update case (same date), intelligently manage items:
        // - Only soft-delete items that are no longer in payload
        // - Keep & update existing items that are still present
        // - Insert only new items
        if (!isDateChanged) {
          // Get existing items for this outgoing_good_id
          const existingItems = await tx.outgoing_good_items.findMany({
            where: {
              outgoing_good_id: outgoingGood.id,
              outgoing_good_company: data.company_code,
              outgoing_good_date: outgoingDate,
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

          // 1. Soft-delete items that are no longer in payload
          const itemsToDelete = existingItems.filter(
            item => !payloadItemKeys.has(`${item.item_type}|${item.item_code}`)
          );

          if (itemsToDelete.length > 0) {
            await tx.outgoing_good_items.updateMany({
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
              await tx.outgoing_good_items.update({
                where: { id: existing.id },
                data: {
                  item_name: item.item_name,
                  production_output_wms_ids: item.production_output_wms_ids || [],
                  incoming_ppkek_numbers: item.ppkek_number || [],
                  hs_code: item.hs_code || null,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty.toString()),
                  currency: item.currency as any,
                  amount: new Prisma.Decimal(item.amount.toString()),
                  updated_at: new Date(),
                },
              });
            } else {
              // New item, insert it
              await tx.outgoing_good_items.create({
                data: {
                  outgoing_good_id: outgoingGood.id,
                  outgoing_good_company: data.company_code,
                  outgoing_good_date: outgoingDate,
                  item_type: item.item_type,
                  item_code: item.item_code,
                  item_name: item.item_name,
                  production_output_wms_ids: item.production_output_wms_ids || [],
                  incoming_ppkek_numbers: item.ppkek_number || [],
                  hs_code: item.hs_code || null,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty.toString()),
                  currency: item.currency as any,
                  amount: new Prisma.Decimal(item.amount.toString()),
                },
              });
            }
          }
        } else {
          // Date changed: soft-delete all old items, insert all new
          // Create new items
          const itemsData = data.items.map((item) => ({
            outgoing_good_id: outgoingGood.id,
            outgoing_good_company: data.company_code,
            outgoing_good_date: outgoingDate,
            item_type: item.item_type,
            item_code: item.item_code,
            item_name: item.item_name,
            production_output_wms_ids: item.production_output_wms_ids || [],
            incoming_ppkek_numbers: item.ppkek_number || [],
            hs_code: item.hs_code || null,
            uom: item.uom,
            qty: new Prisma.Decimal(item.qty.toString()),
            currency: item.currency as any,
            amount: new Prisma.Decimal(item.amount.toString()),
          }));

          await tx.outgoing_good_items.createMany({
            data: itemsData,
          });
        }

        repositoryLogger.info('Outgoing good items managed', { itemCount: data.items.length });

        // 3. Insert/update outgoing_fg_production_traceability for FERT and HALB items
        const traceabilityInserts: Promise<any>[] = [];

        // Get the current (non-deleted) items to map with original items
        const currentItemsList = await tx.outgoing_good_items.findMany({
          where: {
            outgoing_good_id: outgoingGood.id,
            outgoing_good_company: data.company_code,
            outgoing_good_date: outgoingDate,
            deleted_at: null,
          },
          orderBy: { id: 'asc' },
        });

        // Build a map of item_code to current item
        const itemCodeToCurrentItem = new Map(currentItemsList.map((item) => [item.item_code, item]));

        data.items.forEach((originalItem) => {
          const currentItem = itemCodeToCurrentItem.get(originalItem.item_code);
          if (!currentItem) return;

          // Only create traceability for FERT and HALB with production_output_wms_ids
          if (
            ['FERT', 'HALB'].includes(originalItem.item_type.toUpperCase()) &&
            originalItem.production_output_wms_ids &&
            originalItem.production_output_wms_ids.length > 0
          ) {
            originalItem.production_output_wms_ids.forEach((productionWmsId) => {
              traceabilityInserts.push(
                tx.outgoing_fg_production_traceability.upsert({
                  where: {
                    outgoing_wms_id_production_wms_id_item_code: {
                      outgoing_wms_id: data.wms_id,
                      production_wms_id: productionWmsId,
                      item_code: originalItem.item_code,
                    },
                  },
                  update: {
                    allocated_qty: new Prisma.Decimal(originalItem.qty.toString()),
                    updated_at: new Date(),
                  },
                  create: {
                    outgoing_good_item_id: currentItem.id,
                    outgoing_wms_id: data.wms_id,
                    production_wms_id: productionWmsId,
                    company_code: data.company_code,
                    item_code: originalItem.item_code,
                    trx_date: outgoingDate,
                    allocated_qty: new Prisma.Decimal(originalItem.qty.toString()),
                  },
                })
              );
            });
          }
        });

        if (traceabilityInserts.length > 0) {
          await Promise.all(traceabilityInserts);
          repositoryLogger.info('Outgoing FG production traceability updated', {
            traceabilityCount: traceabilityInserts.length,
          });
        }

        return {
          outgoingGoodId: outgoingGood.id,
          itemCount: data.items.length,
          traceabilityCount: traceabilityInserts.length,
        };
      });

      repositoryLogger.info('Outgoing goods transaction completed successfully', result);

      // =========================================================================
      // STEP 4 & 5: Snapshot Updates (DIRECT, NO QUEUE, NON-BLOCKING)
      // =========================================================================

      // Prepare items for snapshot
      const newItems: SnapshotItem[] = data.items.map(item => ({
        item_type: item.item_type,
        item_code: item.item_code,
        item_name: item.item_name,
        uom: item.uom,
      }));

      // If date changed: recalc OLD date first (items removed from that date)
      if (isDateChanged && oldDate) {
        repositoryLogger.info('Recalculating snapshot for old date', {
          oldDate,
          items: deletedItems.length,
        });
        const oldItems = previousRecord ? await prisma.outgoing_good_items.findMany({
          where: {
            outgoing_good_id: previousRecord.id,
            outgoing_good_company: data.company_code,
            outgoing_good_date: oldDate,
          },
          select: { item_type: true, item_code: true, item_name: true, uom: true },
        }) : [];

        await this.updateItemSnapshots(data.company_code, oldItems.map(i => ({ item_type: i.item_type, item_code: i.item_code, item_name: i.item_name, uom: i.uom })), oldDate, data.wms_id, 'outgoing_goods_old');
        await this.cascadeRecalculateSnapshots(data.company_code, oldItems.map(i => ({ item_type: i.item_type, item_code: i.item_code, item_name: i.item_name, uom: i.uom })), oldDate);
      }

      // Recalc NEW date (items added to that date)
      repositoryLogger.info('Recalculating snapshot for new date', {
        newDate: outgoingDate,
        items: newItems.length,
      });
      await this.updateItemSnapshots(data.company_code, newItems, outgoingDate, data.wms_id, 'outgoing_goods_new');

      // Recalc DELETED items (same date, items removed)
      if (deletedItems.length > 0) {
        repositoryLogger.info('Recalculating snapshot for deleted items', {
          newDate: outgoingDate,
          items: deletedItems.length,
          deletedItemCodes: deletedItems.map(i => i.item_code),
        });
        await this.updateItemSnapshots(
          data.company_code,
          deletedItems,
          outgoingDate,
          data.wms_id,
          'outgoing_goods_deleted'
        );
      }

      // Cascade from new date
      await this.cascadeRecalculateSnapshots(data.company_code, newItems, outgoingDate);

      // Also cascade for deleted items if same date
      if (deletedItems.length > 0) {
        await this.cascadeRecalculateSnapshots(data.company_code, deletedItems, outgoingDate);
      }

      repositoryLogger.info('Outgoing goods and snapshots fully processed', {
        id: result.outgoingGoodId,
        wmsId: data.wms_id,
        outgoingDate: outgoingDate,
      });
    } catch (error) {
      repositoryLogger.error('Failed to insert outgoing goods', { error });
      throw error;
    }
  }
}
