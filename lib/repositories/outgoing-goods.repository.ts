import { logger } from '@/lib/utils/logger';
import { prisma } from '@/lib/prisma';
import type { OutgoingGoodsRequest } from '@/lib/validators/outgoing-goods.validator';
import { Prisma } from '@prisma/client';
import { BaseTransactionRepository } from './base-transaction.repository';

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
  async insertOutgoingGoodsAsync(data: OutgoingGoodsRequest): Promise<void> {
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

      // Use Prisma transaction for atomicity
      const result = await prisma.$transaction(async (tx) => {
        // 1. Upsert outgoing_goods header (idempotent on wms_id)
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

        // Delete existing items (for update case)
        await tx.outgoing_good_items.deleteMany({
          where: {
            outgoing_good_id: outgoingGood.id,
            outgoing_good_company: data.company_code,
            outgoing_good_date: outgoingDate,
          },
        });

        // Create items
        const itemsData = data.items.map((item) => ({
          outgoing_good_id: outgoingGood.id,
          outgoing_good_company: data.company_code,
          outgoing_good_date: outgoingDate,
          item_type: item.item_type,
          item_code: item.item_code,
          item_name: item.item_name,
          production_output_wms_ids: item.production_output_wms_ids || [],
          hs_code: item.hs_code || null,
          uom: item.uom,
          qty: new Prisma.Decimal(item.qty.toString()),
          currency: item.currency as any,
          amount: new Prisma.Decimal(item.amount.toString()),
        }));

        const createdItems = await tx.outgoing_good_items.createMany({
          data: itemsData,
        });

        repositoryLogger.info('Outgoing good items created', { itemCount: itemsData.length });

        // 3. Insert outgoing_fg_production_traceability for FERT and HALB items
        const traceabilityInserts: Promise<any>[] = [];

        // Get the created items to map with original items
        const createdItemsList = await tx.outgoing_good_items.findMany({
          where: {
            outgoing_good_id: outgoingGood.id,
            outgoing_good_company: data.company_code,
            outgoing_good_date: outgoingDate,
          },
          orderBy: { id: 'asc' },
        });

        // Build a map of item_code to created item
        const itemCodeToCreatedItem = new Map(createdItemsList.map((item) => [item.item_code, item]));

        data.items.forEach((originalItem) => {
          const createdItem = itemCodeToCreatedItem.get(originalItem.item_code);
          if (!createdItem) return;

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
                    outgoing_good_item_id: createdItem.id,
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
          repositoryLogger.info('Outgoing FG production traceability inserted', {
            traceabilityCount: traceabilityInserts.length,
          });
        }

        return {
          outgoingGoodId: outgoingGood.id,
          itemCount: itemsData.length,
          traceabilityCount: traceabilityInserts.length,
        };
      });

      repositoryLogger.info('Outgoing goods transaction completed successfully', result);

      // 4. Handle backdated transaction AFTER Prisma transaction
      // This will:
      // - Detect if backdated (date < today)
      // - Queue snapshot recalculation for all items with proper priority
      // - Immediately process if backdated, or queue for end-of-day if same-day
      await this.handleBackdatedTransaction(
        data.company_code,
        outgoingDate,
        data.wms_id,
        'outgoing_goods'
      );
    } catch (error) {
      repositoryLogger.error('Failed to insert outgoing goods', { error });
      throw error;
    }
  }
}
