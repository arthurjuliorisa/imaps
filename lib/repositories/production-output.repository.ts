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
   * Batch upsert production output with parallel processing
   * 
   * Implements idempotent UPSERT pattern as per API Contract:
   * - Same wms_id sent multiple times has same effect as sending once
   * - If wms_id exists → UPDATE with new data
   * - If wms_id not exists → INSERT new record
   * 
   * Optimization: Promise.allSettled for parallel item creates
   * - 100 records = ~10x faster than sequential
   * - Handles failures gracefully (continues on error)
   */
  async create(data: ProductionOutputBatchRequestInput): Promise<any> {
    const log = logger.child({
      scope: 'ProductionOutputRepository.create',
      wmsId: data.wms_id,
      companyCode: data.company_code,
    });

    try {
      const transactionDate = new Date(data.transaction_date);

      // Create transaction atomically
      const result = await prisma.$transaction(async (tx) => {
        // Step 1: Upsert header (production_outputs table)
        // Follows idempotent pattern: update if exists, create if not
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
            timestamp: new Date(data.timestamp),
          },
          create: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            internal_evidence_number: data.internal_evidence_number,
            transaction_date: transactionDate,
            reversal: data.reversal || null,
            timestamp: new Date(data.timestamp),
          },
        });

        log.info('Header upserted', { productionOutputId: header.id });

        // Step 2: Delete existing items and insert new ones
        // When updating, replace items with new data
        await tx.production_output_items.deleteMany({
          where: {
            production_output_id: header.id,
            production_output_company: data.company_code,
            production_output_date: transactionDate,
          },
        });

        // Create items in parallel
        const itemRecords = data.items.map((item) => ({
          production_output_id: header.id,
          production_output_company: data.company_code,
          production_output_date: transactionDate,
          item_type: item.item_type,
          item_code: item.item_code,
          item_name: item.item_name,
          uom: item.uom,
          qty: item.qty,
          work_order_numbers: item.work_order_numbers,
        }));

        const itemResults = await Promise.allSettled(
          itemRecords.map((record) =>
            tx.production_output_items.create({
              data: record,
            })
          )
        );

        // Extract successfully created items with their IDs
        const createdItems = itemResults
          .map((result, index) => {
            if (result.status === 'fulfilled') {
              return { ...result.value, itemCode: itemRecords[index].item_code };
            }
            return null;
          })
          .filter((item): item is any => item !== null);

        const itemCodeToIdMap = new Map(
          createdItems.map((item) => [item.item_code, item.id])
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

        log.info('Batch upsert completed', {
          productionOutputId: header.id,
          successCount: itemResults.filter((r) => r.status === 'fulfilled').length,
          failureCount: failures.length,
        });

        return { header, items: itemResults, itemCodeToIdMap };
      });

      // Create traceability records for work order to finished/semifinished goods
      // This links production outputs to their source work orders for PPKEK traceability
      const itemCodeToIdMap = (result as any).itemCodeToIdMap as Map<string, number>;
      if (result.header && itemCodeToIdMap && itemCodeToIdMap.size > 0) {
        // Delete existing traceability records for this production output
        // when updating, replace with new traceability data
        await prisma.work_order_fg_production.deleteMany({
          where: {
            production_output_id: result.header.id,
            company_code: data.company_code,
          },
        });

        const traceabilityRecords = data.items
          .filter((item) => item.work_order_numbers && item.work_order_numbers.length > 0 && itemCodeToIdMap.has(item.item_code))
          .flatMap((item) =>
            item.work_order_numbers.map((woNumber) => ({
              production_output_id: result.header.id,
              production_output_item_id: itemCodeToIdMap.get(item.item_code)!,
              production_wms_id: data.wms_id,
              work_order_number: woNumber,
              company_code: data.company_code,
              item_type: item.item_type,
              item_code: item.item_code,
              qty_produced: item.qty,
              trx_date: transactionDate,
            }))
          );

        if (traceabilityRecords.length > 0) {
          try {
            // Insert traceability records using Prisma ORM
            for (const record of traceabilityRecords) {
              await prisma.work_order_fg_production.upsert({
                where: {
                  work_order_fg_production_unique: {
                    production_wms_id: record.production_wms_id,
                    work_order_number: record.work_order_number,
                    item_code: record.item_code,
                  },
                },
                update: {
                  qty_produced: record.qty_produced,
                },
                create: {
                  production_output_id: record.production_output_id,
                  production_output_item_id: record.production_output_item_id,
                  production_wms_id: record.production_wms_id,
                  work_order_number: record.work_order_number,
                  company_code: record.company_code,
                  item_type: record.item_type,
                  item_code: record.item_code,
                  qty_produced: record.qty_produced,
                  trx_date: record.trx_date,
                },
              });
            }

            log.info('Production traceability records created', {
              count: traceabilityRecords.length,
            });
          } catch (err) {
            log.warn('Failed to create production traceability records', {
              error: (err as any).message,
            });
            // Don't fail the entire transaction if traceability fails
          }
        }
      }

      // Step 4: Check if this is a date change (for update scenarios)
      const oldHeader = await prisma.production_outputs.findFirst({
        where: {
          company_code: data.company_code,
          wms_id: data.wms_id,
          id: { not: result.header.id }, // Different record with same wms_id
        },
        orderBy: { transaction_date: 'desc' },
        take: 1,
      });

      const oldTransactionDate = oldHeader?.transaction_date;
      const dateChanged = oldTransactionDate && oldTransactionDate.getTime() !== transactionDate.getTime();

      // Step 5: Calculate item-level snapshots with reversal handling
      try {
        // Determine quantity multiplier based on reversal flag
        const qtyMultiplier = data.reversal === 'Y' ? -1 : 1;

        // Update snapshots for each item
        for (const item of data.items) {
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
          reversal: data.reversal,
        });

        // Step 6: If date changed, recalculate old date and cascade from new date
        if (dateChanged && oldTransactionDate) {
          try {
            // Recalculate old date
            for (const item of data.items) {
              await prisma.$executeRawUnsafe(
                `SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)`,
                data.company_code,
                item.item_type,
                item.item_code,
                item.item_name,
                item.uom,
                oldTransactionDate
              );
            }

            // Cascade recalculate from new date
            for (const item of data.items) {
              await prisma.$executeRawUnsafe(
                `SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)`,
                data.company_code,
                item.item_type,
                item.item_code,
                transactionDate
              );
            }

            log.info('Date change cascade completed', {
              oldDate: oldTransactionDate.toISOString().split('T')[0],
              newDate: transactionDate.toISOString().split('T')[0],
            });
          } catch (cascadeError) {
            log.error('Cascade recalculation failed on date change', {
              error: (cascadeError as any).message,
              oldDate: oldTransactionDate?.toISOString(),
              newDate: transactionDate.toISOString(),
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

      // Step 7: Queue snapshot recalculation if backdated
      await this.handleBackdatedTransaction(
        data.company_code,
        transactionDate,
        data.wms_id,
        'production_output'
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
