import { prisma } from '@/lib/db/prisma';
import { MaterialUsageBatch, MaterialUsageItem } from '@/lib/validators/material-usage.validator';
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
   * Batch upsert material usage with parallel processing
   * 
   * Optimization: Promise.allSettled for parallel inserts
   * - 100 records = ~10x faster than sequential
   * - Handles failures gracefully (continues on error)
   * 
   * Note: Items are inserted into material_usage_items table
   * Header (material_usages) is upserted once per batch
   */
  async batchUpsert(data: MaterialUsageBatch): Promise<void> {
    const log = logger.child({
      scope: 'MaterialUsageRepository.batchUpsert',
      wmsId: data.wms_id,
      companyCode: data.company_code,
    });

    try {
      const transactionDate = new Date(data.transaction_date);

      // Step 1: Upsert header (material_usages table)
      const header = await prisma.material_usages.upsert({
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

      log.info('Header upserted', { materialUsageId: header.id });

      // Step 2: Delete existing items and insert new ones
      await prisma.material_usage_items.deleteMany({
        where: {
          material_usage_id: header.id,
          material_usage_company: data.company_code,
          material_usage_date: transactionDate,
        },
      });

      // Insert all items in parallel
      const itemRecords = data.items.map((item) => ({
        material_usage_id: header.id,
        material_usage_company: data.company_code,
        material_usage_date: transactionDate,
        item_type: item.item_type,
        item_code: item.item_code,
        item_name: item.item_name,
        uom: item.uom,
        qty: item.qty,
        ppkek_number: item.ppkek_number || null,
      }));

      const results = await Promise.allSettled(
        itemRecords.map((record) =>
          prisma.material_usage_items.create({
            data: record,
          })
        )
      );

      // Extract successfully created items with their IDs
      const createdItems = results
        .map((result, index) => {
          if (result.status === 'fulfilled') {
            return { ...result.value, itemCode: itemRecords[index].item_code };
          }
          return null;
        })
        .filter((item): item is any => item !== null);

      const createdItemsMap = new Map(
        createdItems.map((item) => [item.item_code, item.id])
      );

      // Check for failures
      const failures = results.filter((r) => r.status === 'rejected');
      if (failures.length > 0) {
        log.warn('Some items failed to insert', {
          failureCount: failures.length,
          totalCount: itemRecords.length,
        });

        failures.forEach((failure, index) => {
          if (failure.status === 'rejected') {
            log.error('Item insert failed', {
              itemCode: itemRecords[index].item_code,
              error: failure.reason?.message,
            });
          }
        });
      }

      log.info('Batch upsert completed', {
        materialUsageId: header.id,
        successCount: results.filter((r) => r.status === 'fulfilled').length,
        failureCount: failures.length,
      });

      // Step 3: Create traceability records for work order material consumption
      // This links materials (with PPKEK) to their work orders for customs compliance
      if (data.work_order_number && createdItemsMap.size > 0) {
        const traceabilityRecords = data.items
          .filter((item) => item.ppkek_number && createdItemsMap.has(item.item_code)) // Only trace materials with PPKEK that were successfully created
          .map((item) => ({
            material_usage_id: header.id,
            material_usage_item_id: createdItemsMap.get(item.item_code)!,
            material_usage_wms_id: data.wms_id,
            work_order_number: data.work_order_number!,
            company_code: data.company_code,
            item_code: item.item_code,
            ppkek_number: item.ppkek_number!,
            qty_consumed: item.qty,
            trx_date: transactionDate,
          }));

        if (traceabilityRecords.length > 0) {
          try {
            // Insert traceability records using Prisma ORM
            for (const record of traceabilityRecords) {
              await prisma.work_order_material_consumption.upsert({
                where: {
                  material_usage_wms_id_work_order_number_item_code: {
                    material_usage_wms_id: record.material_usage_wms_id,
                    work_order_number: record.work_order_number,
                    item_code: record.item_code,
                  },
                },
                update: {
                  qty_consumed: record.qty_consumed,
                },
                create: {
                  material_usage_id: record.material_usage_id,
                  material_usage_item_id: record.material_usage_item_id,
                  material_usage_wms_id: record.material_usage_wms_id,
                  work_order_number: record.work_order_number,
                  company_code: record.company_code,
                  item_code: record.item_code,
                  ppkek_number: record.ppkek_number,
                  qty_consumed: record.qty_consumed,
                  trx_date: record.trx_date,
                },
              });
            }

            log.info('Traceability records created', {
              count: traceabilityRecords.length,
              workOrderNumber: data.work_order_number,
            });
          } catch (err) {
            log.warn('Failed to create traceability records', {
              error: (err as any).message,
              workOrderNumber: data.work_order_number,
            });
            // Don't fail the entire transaction if traceability fails
          }
        }
      }

      // Step 4: Queue snapshot recalculation if needed (backdated or same-day)
      await this.handleBackdatedTransaction(
        data.company_code,
        transactionDate,
        data.wms_id,
        'material_usage'
      );
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
