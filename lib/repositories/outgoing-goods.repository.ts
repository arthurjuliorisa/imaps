import { logger } from '@/lib/utils/logger';
import { prisma } from '@/lib/prisma';
import type { OutgoingGoodRequestInput } from '@/lib/validators/schemas/outgoing-goods.schema';
import { Prisma } from '@prisma/client';
import { BaseTransactionRepository } from './base-transaction.repository';
import type { SnapshotItem } from './snapshot.repository';
import {
  makePPKEKResolutionKey,
  ppkekResolutionService,
  resolvePPKEKToIncoming,
} from '@/lib/services/ppkek-resolution.service';
import { bomCalculationService } from '@/lib/services/bom-calculation.service';
import { mapCustomsDocumentType } from '@/lib/customs/customs-document-type-mapper';
import { isCompleteNonFacilityMarker } from '@/lib/validators/non-facility-marker.validator';
import type { CustomsDocumentTypeValue } from '@/lib/validators/constants/customs-document-types';

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
   * Rebuild the persisted traceability snapshot for exactly one outgoing
   * transaction. This deliberately only writes the traceability table: it
   * never re-posts the outgoing transaction or queues stock/INSW work.
   */
  async recalculateTraceabilityForOutgoing(
    outgoingGoodId: number,
    companyCode: number
  ): Promise<{ outgoingWmsId: string; oldRowCount: number; newRowCount: number }> {
    const repositoryLogger = logger.child({
      repository: 'OutgoingGoodsRepository',
      method: 'recalculateTraceabilityForOutgoing',
      outgoingGoodId,
      companyCode,
    });

    const outgoing = await prisma.outgoing_goods.findFirst({
      where: { id: outgoingGoodId, company_code: companyCode, deleted_at: null },
      include: {
        items: {
          where: { deleted_at: null },
          include: { outgoing_work_order_allocations: true },
          orderBy: { id: 'asc' },
        },
      },
    });

    if (!outgoing) {
      throw new Error('Outgoing transaction not found');
    }
    const outgoingItemIds = outgoing.items.map((item) => item.id);

    // Direct PPKEK allocations are not normalized into the work-order table.
    // Keep their persisted quantity split as the rebuild input, which is the
    // same representation used by the original outgoing write.
    const existingRows = await prisma.outgoing_fg_production_traceability.findMany({
      where: {
        outgoing_wms_id: outgoing.wms_id,
        company_code: companyCode,
        outgoing_good_item_id: { in: outgoingItemIds },
      },
      select: {
        outgoing_good_item_id: true,
        production_wms_id: true,
        ppkek_number_incoming: true,
        allocated_qty: true,
        material_item_code: true,
      },
    });
    const directAllocationsByItem = new Map<number, Array<{ ppkek_number: string; qty: number }>>();
    const directKeys = new Set<string>();
    for (const row of existingRows) {
      if (!row.production_wms_id.startsWith('INCOMING_') || !row.ppkek_number_incoming || row.material_item_code) continue;
      const key = `${row.outgoing_good_item_id}|${row.ppkek_number_incoming}`;
      if (directKeys.has(key)) continue;
      directKeys.add(key);
      const allocations = directAllocationsByItem.get(row.outgoing_good_item_id) || [];
      allocations.push({ ppkek_number: row.ppkek_number_incoming, qty: Number(row.allocated_qty || 0) });
      directAllocationsByItem.set(row.outgoing_good_item_id, allocations);
    }

    const rebuildInput = {
      wms_id: outgoing.wms_id,
      company_code: companyCode,
      items: outgoing.items.map((item) => {
        const workOrderAllocations = item.outgoing_work_order_allocations.map((allocation) => ({
          work_order_number: allocation.work_order_number,
          qty: Number(allocation.qty),
        }));
        const directAllocations = directAllocationsByItem.get(item.id) || [];
        return {
          item_type: item.item_type,
          item_code: item.item_code,
          work_order_allocations: [...workOrderAllocations, ...directAllocations],
        };
      }),
    } as OutgoingGoodRequestInput;

    const result = await prisma.$transaction(async (tx) => {
      // Delete only after all target/input reads have succeeded; transaction
      // rollback preserves the active snapshot if rebuilding fails.
      const deleted = await tx.outgoing_fg_production_traceability.deleteMany({
        where: {
          outgoing_wms_id: outgoing.wms_id,
          company_code: companyCode,
          outgoing_good_item_id: { in: outgoingItemIds },
        },
      });
      const newRowCount = await this.processTraceabilityAfterCoreCommit(
        tx,
        rebuildInput,
        outgoing.outgoing_date,
        outgoing.items,
        repositoryLogger
      );
      const inserted = await tx.outgoing_fg_production_traceability.count({
        where: {
          outgoing_wms_id: outgoing.wms_id,
          company_code: companyCode,
          outgoing_good_item_id: { in: outgoingItemIds },
        },
      });
      repositoryLogger.info('Outgoing traceability recalculated', {
        outgoingWmsId: outgoing.wms_id,
        oldRowCount: deleted.count,
        traceabilityWriteCount: newRowCount,
        newRowCount: inserted,
      });
      return { oldRowCount: deleted.count, newRowCount: inserted };
    });

    return { outgoingWmsId: outgoing.wms_id, ...result };
  }

  /**
   * Enrich traceability record with BOM calculation and PPKEK resolution
   *
   * This method:
   * 1. Resolves production WMS ID to work order number
   * 2. Calls BOM Calculation Service to calculate material allocations
   * 3. For each allocation, resolves PPKEK to incoming goods
   * 4. Returns enriched traceability data ready for database insertion
   * 
   * @param db - Prisma client or transaction context
   * @param productionWmsId - Production output WMS ID
   * @param itemCode - FG item code
   * @param qtyFG - Quantity of FG exported
   * @param companyCode - Company code
   * @param outgoingDate - Outgoing goods date
   * @param outgoingWmsId - Outgoing goods WMS ID
   * @param resolvedWorkOrderNumber - Work Order number already resolved by caller
   * @returns Array of enriched allocations or null if calculation failed
   */
  private async enrichTraceability(
    db: any,
    productionWmsId: string,
    itemCode: string,
    qtyFG: Prisma.Decimal,
    companyCode: number,
    outgoingDate: Date,
    outgoingWmsId: string,
    resolvedWorkOrderNumber?: string
  ): Promise<any> {
    const logger_sub = logger.child({
      method: 'enrichTraceability',
      productionWmsId,
      itemCode,
      outgoingWmsId,
    });

    try {
      // ====================================================================
      // STEP 1: Resolve production WMS ID to work order number
      // ====================================================================
      let workOrderNumber = resolvedWorkOrderNumber;

      if (!workOrderNumber) {
        const workOrderFG = await db.work_order_fg_production.findFirst({
          where: {
            production_wms_id: productionWmsId,
            item_code: itemCode,
          },
          orderBy: { id: 'desc' },
        });

        if (!workOrderFG) {
          logger_sub.warn('No work order FG production found', { productionWmsId, itemCode });
          return null;
        }

        workOrderNumber = workOrderFG.work_order_number;
      }

      if (!workOrderNumber) {
        logger_sub.warn('Work order number could not be resolved', { productionWmsId, itemCode });
        return null;
      }

      const calculationWorkOrderNumber = workOrderNumber;

      // ====================================================================
      // STEP 2: Use BOM Calculation Service to calculate allocations
      // ====================================================================
      const bomResult = await bomCalculationService.calculateBOM(
        calculationWorkOrderNumber,
        itemCode,
        qtyFG,
        companyCode
      );

      if (bomResult.calculation_status !== 'success' && bomResult.calculation_status !== 'identified_product_n') {
        logger_sub.debug('BOM calculation did not return success', {
          status: bomResult.calculation_status,
          message: bomResult.error_message,
        });
        
        // For other failures (not_found, error), return null
        return null;
      }

      if (bomResult.allocations.length === 0) {
        logger_sub.debug('No allocations from BOM calculation');
        return null;
      }

      // ====================================================================
      // STEP 3: Resolve explicit PPKEK numbers for each detail row and enrich
      // ====================================================================
      const traceAllocations: any[] = [];
      const resolutionKeys = bomResult.allocations.flatMap((allocation) =>
        allocation.detail_rows
          .filter((detail) =>
            Boolean(detail.display_ppkek_number) &&
            detail.ppkek_bucket_key.startsWith('PPKEK:')
          )
          .map((detail) => ({
            ppkekNumber: detail.display_ppkek_number!,
            itemCode: allocation.material_item_code,
          }))
      );
      const resolvedPPKEKByKey = await ppkekResolutionService.resolveMany(
        resolutionKeys,
        companyCode,
        outgoingDate
      );

      for (const allocation of bomResult.allocations) {
        for (const detail of allocation.detail_rows) {
          let resolvedPPKEK = null;

          if (detail.display_ppkek_number && detail.ppkek_bucket_key.startsWith('PPKEK:')) {
            resolvedPPKEK = resolvedPPKEKByKey.get(makePPKEKResolutionKey(
              detail.display_ppkek_number,
              allocation.material_item_code,
              companyCode,
              outgoingDate
            )) || null;
          }

          traceAllocations.push({
            work_order_number: allocation.work_order_number,
            material_item_code: allocation.material_item_code,
            material_item_name: allocation.material_item_name,
            material_qty_allocated: detail.final_allocated_qty,
            consumption_ratio: allocation.consumption_ratio,
            component_demand_qty: allocation.component_demand_qty,
            planned_production_qty: allocation.planned_production_qty,
            ppkek_number_incoming: resolvedPPKEK?.ppkek_number || null,
            incoming_goods_id: resolvedPPKEK?.incoming_goods_id || null,
            customs_registration_date: resolvedPPKEK?.customs_registration_date || null,
            customs_document_type: resolvedPPKEK?.customs_document_type || null,
            incoming_date: resolvedPPKEK?.incoming_date || null,
            source_material_usage_item_id: detail.source_material_usage_item_id,
            source_material_usage_wms_id: detail.source_material_usage_wms_id,
            trace_row_type: detail.trace_row_type,
            display_ppkek_number: detail.display_ppkek_number,
            ppkek_bucket_key: detail.ppkek_bucket_key,
            actual_qty: detail.actual_qty,
            signed_qty: detail.signed_qty,
            material_net_usage_total: detail.material_net_usage_total,
            raw_allocated_qty: detail.raw_allocated_qty,
            final_allocated_qty: detail.final_allocated_qty,
            rounding_adjustment: detail.rounding_adjustment,
            material_uom: detail.material_uom,
          });

          logger_sub.debug('Enriched allocation detail with PPKEK resolution', {
            materialItemCode: allocation.material_item_code,
            bucket: detail.ppkek_bucket_key,
            hasPPKEK: !!resolvedPPKEK,
          });
        }
      }

      // Consolidations already done in BOM Calculation Service
      // Each allocation here represents a unique consolidated material
      // No further consolidation needed
      logger_sub.debug('Traceability enrichment complete', {
        allocationCount: traceAllocations.length,
      });

      return traceAllocations;
    } catch (error) {
      logger_sub.error('Error enriching traceability', { error });
      return null;
    }
  }

  /**
   * Build and persist BOM/traceability data inside the outgoing transaction.
   */
  private async processTraceabilityAfterCoreCommit(
    db: any,
    data: OutgoingGoodRequestInput,
    outgoingDate: Date,
    currentItemsList: any[],
    repositoryLogger: any
  ): Promise<number> {
    const itemCodeToCurrentItem = new Map(currentItemsList.map((item) => [item.item_code, item]));
    const traceabilityWrites: Array<{
      deleteWhere: any;
      createData: any[];
      createSingle?: boolean;
    }> = [];
    const workOrderLookupKeys = data.items.flatMap((item) =>
      ['FERT', 'HALB'].includes(item.item_type.toUpperCase())
        ? (item.work_order_allocations || [])
            .filter((allocation) => Boolean(allocation.work_order_number))
            .map((allocation) => ({
              work_order_number: allocation.work_order_number!,
              item_code: item.item_code,
            }))
        : []
    );
    const uniqueWorkOrderLookupKeys = Array.from(
      new Map(
        workOrderLookupKeys.map((key) => [
          `${key.work_order_number}|${key.item_code}`,
          key,
        ])
      ).values()
    );
    const workOrderProductionRows = uniqueWorkOrderLookupKeys.length > 0
      ? await db.work_order_fg_production.findMany({
          where: {
            company_code: data.company_code,
            OR: uniqueWorkOrderLookupKeys.map((key) => ({
              work_order_number: key.work_order_number,
              item_code: key.item_code,
            })),
          },
          select: {
            id: true,
            work_order_number: true,
            item_code: true,
            production_wms_id: true,
          },
          orderBy: { id: 'desc' },
        })
      : [];
    const workOrderProductionByKey = new Map<string, { production_wms_id: string }>();
    for (const row of workOrderProductionRows) {
      const key = `${row.work_order_number}|${row.item_code}`;
      if (!workOrderProductionByKey.has(key)) {
        workOrderProductionByKey.set(key, row);
      }
    }
    const directPPKEKCache = new Map<string, Awaited<ReturnType<typeof resolvePPKEKToIncoming>>>();

    for (const originalItem of data.items) {
      const currentItem = itemCodeToCurrentItem.get(originalItem.item_code);
      if (!currentItem) continue;

      // Only create traceability for FERT and HALB items
      if (!['FERT', 'HALB'].includes(originalItem.item_type.toUpperCase())) {
        continue;
      }

      if (originalItem.work_order_allocations && originalItem.work_order_allocations.length > 0) {
        for (const allocation of originalItem.work_order_allocations) {
          let productionWmsId: string | null = null;
          let sourceType: 'production' | 'incoming' = 'production';

          if (allocation.work_order_number) {
            const workOrderProduction = workOrderProductionByKey.get(
              `${allocation.work_order_number}|${originalItem.item_code}`
            );

            if (!workOrderProduction) {
              repositoryLogger.warn('Work order production not found, skipping allocation', {
                workOrderNumber: allocation.work_order_number,
                itemCode: originalItem.item_code,
              });
              continue;
            }

            productionWmsId = workOrderProduction.production_wms_id;
            sourceType = 'production';
          } else if (allocation.ppkek_number) {
            repositoryLogger.debug('Processing allocation from incoming HALB', {
              ppkekNumber: allocation.ppkek_number,
              itemCode: originalItem.item_code,
              qty: allocation.qty,
            });
            sourceType = 'incoming';
          } else {
            repositoryLogger.warn('Allocation has neither work_order_number nor ppkek_number, skipping', {
              itemCode: originalItem.item_code,
            });
            continue;
          }

          let enrichedAllocations: any[] | null = null;
          if (sourceType === 'production' && productionWmsId) {
            enrichedAllocations = await this.enrichTraceability(
              db,
              productionWmsId,
              originalItem.item_code,
              new Prisma.Decimal(allocation.qty.toString()),
              data.company_code,
              outgoingDate,
              data.wms_id,
              allocation.work_order_number || undefined
            );
          } else if (sourceType === 'incoming' && allocation.ppkek_number) {
            const directPPKEKCacheKey = makePPKEKResolutionKey(
              allocation.ppkek_number,
              originalItem.item_code,
              data.company_code,
              outgoingDate
            );
            if (!directPPKEKCache.has(directPPKEKCacheKey)) {
              directPPKEKCache.set(
                directPPKEKCacheKey,
                await resolvePPKEKToIncoming(
                  allocation.ppkek_number,
                  originalItem.item_code,
                  data.company_code,
                  outgoingDate
                )
              );
            }
            const incomingResolve = directPPKEKCache.get(directPPKEKCacheKey);

            if (incomingResolve) {
              enrichedAllocations = [{
                work_order_number: null,
                material_item_code: null,
                material_item_name: null,
                material_qty_allocated: null,
                consumption_ratio: null,
                ppkek_number_incoming: incomingResolve.ppkek_number,
                incoming_goods_id: incomingResolve.incoming_goods_id,
                customs_registration_date: incomingResolve.customs_registration_date,
                customs_document_type: incomingResolve.customs_document_type,
                incoming_date: incomingResolve.incoming_date,
              }];
            }
          }

          if (sourceType === 'production' && productionWmsId) {
            const deleteWhere = {
              outgoing_wms_id: data.wms_id,
              production_wms_id: productionWmsId,
              item_code: originalItem.item_code,
              outgoing_good_item_id: currentItem.id,
            };

            if (enrichedAllocations && enrichedAllocations.length > 0) {
              traceabilityWrites.push({
                deleteWhere,
                createData: enrichedAllocations.map((enrichment) => ({
                  outgoing_good_item_id: currentItem.id,
                  outgoing_wms_id: data.wms_id,
                  production_wms_id: productionWmsId,
                  company_code: data.company_code,
                  item_code: originalItem.item_code,
                  trx_date: outgoingDate,
                  allocated_qty: new Prisma.Decimal(allocation.qty.toString()),
                  work_order_number: enrichment.work_order_number,
                  material_item_code: enrichment.material_item_code,
                  material_item_name: enrichment.material_item_name,
                  material_qty_allocated: enrichment.material_qty_allocated,
                  consumption_ratio: enrichment.consumption_ratio,
                  component_demand_qty: enrichment.component_demand_qty,
                  planned_production_qty: enrichment.planned_production_qty,
                  ppkek_number_incoming: enrichment.ppkek_number_incoming,
                  incoming_goods_id: enrichment.incoming_goods_id,
                  customs_registration_date: enrichment.customs_registration_date,
                  customs_document_type: enrichment.customs_document_type,
                  incoming_date: enrichment.incoming_date,
                  source_material_usage_item_id: enrichment.source_material_usage_item_id,
                  source_material_usage_wms_id: enrichment.source_material_usage_wms_id,
                  trace_row_type: enrichment.trace_row_type,
                  display_ppkek_number: enrichment.display_ppkek_number,
                  ppkek_bucket_key: enrichment.ppkek_bucket_key,
                  actual_qty: enrichment.actual_qty,
                  signed_qty: enrichment.signed_qty,
                  material_net_usage_total: enrichment.material_net_usage_total,
                  raw_allocated_qty: enrichment.raw_allocated_qty,
                  final_allocated_qty: enrichment.final_allocated_qty,
                  rounding_adjustment: enrichment.rounding_adjustment,
                  material_uom: enrichment.material_uom,
                })),
              });
            } else {
              traceabilityWrites.push({
                deleteWhere,
                createSingle: true,
                createData: [{
                  outgoing_good_item_id: currentItem.id,
                  outgoing_wms_id: data.wms_id,
                  production_wms_id: productionWmsId,
                  company_code: data.company_code,
                  item_code: originalItem.item_code,
                  trx_date: outgoingDate,
                  allocated_qty: new Prisma.Decimal(allocation.qty.toString()),
                }],
              });
            }
          } else if (sourceType === 'incoming' && enrichedAllocations && enrichedAllocations.length > 0) {
            traceabilityWrites.push({
              deleteWhere: {
                outgoing_wms_id: data.wms_id,
                item_code: originalItem.item_code,
                outgoing_good_item_id: currentItem.id,
                ppkek_number_incoming: {
                  not: null,
                },
              },
              createData: enrichedAllocations.map((enrichment) => ({
                outgoing_good_item_id: currentItem.id,
                outgoing_wms_id: data.wms_id,
                production_wms_id: `INCOMING_${enrichment.incoming_goods_id}`,
                company_code: data.company_code,
                item_code: originalItem.item_code,
                trx_date: outgoingDate,
                allocated_qty: new Prisma.Decimal(allocation.qty.toString()),
                incoming_goods_id: enrichment.incoming_goods_id,
                ppkek_number_incoming: enrichment.ppkek_number_incoming,
                customs_registration_date: enrichment.customs_registration_date,
                customs_document_type: enrichment.customs_document_type,
                incoming_date: enrichment.incoming_date,
              })),
            });
          }
        }
      } else {
        repositoryLogger.warn('No work_order_allocations provided for FERT/HALB item, skipping traceability', {
          itemCode: originalItem.item_code,
        });
      }
    }

    if (traceabilityWrites.length === 0) {
      return 0;
    }

    for (const write of traceabilityWrites) {
      await db.outgoing_fg_production_traceability.deleteMany({
        where: write.deleteWhere,
      });

      if (write.createSingle) {
        await db.outgoing_fg_production_traceability.create({
          data: write.createData[0],
        });
      } else if (write.createData.length > 0) {
        await db.outgoing_fg_production_traceability.createMany({
          data: write.createData,
        });
      }
    }

    repositoryLogger.info('Outgoing FG production traceability updated', {
      traceabilityCount: traceabilityWrites.length,
    });

    return traceabilityWrites.length;
  }

  
  async insertOutgoingGoodsAsync(data: OutgoingGoodRequestInput): Promise<void> {
    const repositoryLogger = logger.child({
      repository: 'OutgoingGoodsRepository',
      method: 'insertOutgoingGoodsAsync',
      wmsId: data.wms_id,
    });

    try {
      // Parse dates
      const outgoingDate = new Date(data.outgoing_date);
      const isNonFacility = isCompleteNonFacilityMarker(data);
      const customsRegistrationDate = isNonFacility ? null : new Date(data.customs_registration_date);
      const invoiceDate = new Date(data.invoice_date);
      const customsDocumentType = isNonFacility
        ? null
        : mapCustomsDocumentType(data.customs_document_type as CustomsDocumentTypeValue);

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
            customs_document_type: customsDocumentType,
            ppkek_number: data.ppkek_number,
            customs_registration_date: customsRegistrationDate,
            is_non_facility: isNonFacility,
            outgoing_evidence_number: data.outgoing_evidence_number,
            invoice_number: data.invoice_number,
            invoice_date: invoiceDate,
            recipient_name: data.recipient_name,
            timestamp: new Date(data.timestamp),
            updated_at: new Date(),
            deleted_at: null,
          } as any,
          create: {
            wms_id: data.wms_id,
            company_code: data.company_code,
            owner: data.owner,
            customs_document_type: customsDocumentType,
            ppkek_number: data.ppkek_number,
            customs_registration_date: customsRegistrationDate,
            is_non_facility: isNonFacility,
            outgoing_evidence_number: data.outgoing_evidence_number,
            outgoing_date: outgoingDate,
            invoice_number: data.invoice_number,
            invoice_date: invoiceDate,
            recipient_name: data.recipient_name,
            timestamp: new Date(data.timestamp),
          } as any,
        });

        repositoryLogger.info('Outgoing goods header upserted', { outgoingGoodId: outgoingGood.id });

        const existingOutgoingItemIds = await tx.outgoing_good_items.findMany({
          where: {
            outgoing_good_id: outgoingGood.id,
            outgoing_good_company: data.company_code,
            outgoing_good_date: outgoingDate,
          },
          select: { id: true },
        });

        const existingOutgoingItemIdList = existingOutgoingItemIds.map((item) => item.id);

        // Re-submit/idempotency cleanup: remove only traceability/allocation
        // rows owned by this outgoing transaction before rebuilding from the
        // latest accepted payload. Never delete by work_order_number alone.
        await tx.outgoing_fg_production_traceability.deleteMany({
          where: {
            OR: [
              {
                outgoing_wms_id: data.wms_id,
                company_code: data.company_code,
              },
              ...(existingOutgoingItemIdList.length > 0
                ? [{ outgoing_good_item_id: { in: existingOutgoingItemIdList } }]
                : []),
            ],
          },
        });

        if (existingOutgoingItemIdList.length > 0) {
          await tx.outgoing_work_order_allocations.deleteMany({
            where: {
              outgoing_good_item_id: { in: existingOutgoingItemIdList },
            },
          });
        }

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
              // Extract incoming PPKEK numbers from work_order_allocations (if ppkek_number is used)
              const incomingPPKEKNumbers: string[] = [];
              if (item.work_order_allocations && item.work_order_allocations.length > 0) {
                for (const allocation of item.work_order_allocations) {
                  if (allocation.ppkek_number && !incomingPPKEKNumbers.includes(allocation.ppkek_number)) {
                    incomingPPKEKNumbers.push(allocation.ppkek_number);
                  }
                }
              }

              await tx.outgoing_good_items.update({
                where: { id: existing.id },
                data: {
                  item_name: item.item_name,
                  hs_code: item.hs_code || null,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty.toString()),
                  currency: item.currency as any,
                  amount: new Prisma.Decimal(item.amount.toString()),
                  incoming_ppkek_numbers: incomingPPKEKNumbers.length > 0 ? incomingPPKEKNumbers : [],
                  updated_at: new Date(),
                },
              });
            } else {
              // New item, insert it
              // Extract incoming PPKEK numbers from work_order_allocations (if ppkek_number is used)
              const incomingPPKEKNumbers: string[] = [];
              if (item.work_order_allocations && item.work_order_allocations.length > 0) {
                for (const allocation of item.work_order_allocations) {
                  if (allocation.ppkek_number && !incomingPPKEKNumbers.includes(allocation.ppkek_number)) {
                    incomingPPKEKNumbers.push(allocation.ppkek_number);
                  }
                }
              }

              await tx.outgoing_good_items.create({
                data: {
                  outgoing_good_id: outgoingGood.id,
                  outgoing_good_company: data.company_code,
                  outgoing_good_date: outgoingDate,
                  item_type: item.item_type,
                  item_code: item.item_code,
                  item_name: item.item_name,
                  hs_code: item.hs_code || null,
                  uom: item.uom,
                  qty: new Prisma.Decimal(item.qty.toString()),
                  currency: item.currency as any,
                  amount: new Prisma.Decimal(item.amount.toString()),
                  incoming_ppkek_numbers: incomingPPKEKNumbers.length > 0 ? incomingPPKEKNumbers : [],
                },
              });
            }
          }
        } else {
          // Date changed: soft-delete all old items, insert all new
          // Create new items
          const itemsData = data.items.map((item) => {
            // Extract incoming PPKEK numbers from work_order_allocations (if ppkek_number is used)
            const incomingPPKEKNumbers: string[] = [];
            if (item.work_order_allocations && item.work_order_allocations.length > 0) {
              for (const allocation of item.work_order_allocations) {
                if (allocation.ppkek_number && !incomingPPKEKNumbers.includes(allocation.ppkek_number)) {
                  incomingPPKEKNumbers.push(allocation.ppkek_number);
                }
              }
            }

            return {
              outgoing_good_id: outgoingGood.id,
              outgoing_good_company: data.company_code,
              outgoing_good_date: outgoingDate,
              item_type: item.item_type,
              item_code: item.item_code,
              item_name: item.item_name,
              hs_code: item.hs_code || null,
              uom: item.uom,
              qty: new Prisma.Decimal(item.qty.toString()),
              currency: item.currency as any,
              amount: new Prisma.Decimal(item.amount.toString()),
              incoming_ppkek_numbers: incomingPPKEKNumbers.length > 0 ? incomingPPKEKNumbers : [],
            };
          });

          await tx.outgoing_good_items.createMany({
            data: itemsData,
          });
        }

        repositoryLogger.info('Outgoing good items managed', { itemCount: data.items.length });

        // Get the current (non-deleted) items to map with original items (used for both allocations and traceability)
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

        // 2.5: Insert/update work_order_allocations for items that have work order allocations
        const workOrderAllocationInserts: Promise<any>[] = [];

        for (const originalItem of data.items) {
          const currentItem = itemCodeToCurrentItem.get(originalItem.item_code);
          if (!currentItem) continue;

          // Only create allocations for FERT and HALB items with work_order_allocations
          if (!['FERT', 'HALB'].includes(originalItem.item_type.toUpperCase())) {
            continue;
          }

          if (originalItem.work_order_allocations && originalItem.work_order_allocations.length > 0) {
            // Delete existing allocations for this item first
            await tx.outgoing_work_order_allocations.deleteMany({
              where: {
                outgoing_good_item_id: currentItem.id,
              },
            });

            // Create new allocations
            for (const allocation of originalItem.work_order_allocations) {
              if (allocation.work_order_number) {
                workOrderAllocationInserts.push(
                  tx.outgoing_work_order_allocations.create({
                    data: {
                      outgoing_good_item_id: currentItem.id,
                      work_order_number: allocation.work_order_number,
                      qty: new Prisma.Decimal(allocation.qty.toString()),
                    },
                  })
                );
              }
            }
          }
        }

        if (workOrderAllocationInserts.length > 0) {
          await Promise.all(workOrderAllocationInserts);
          repositoryLogger.info('Work order allocations created', {
            allocationCount: workOrderAllocationInserts.length,
          });
        }

        const traceabilityCount = await this.processTraceabilityAfterCoreCommit(
          tx,
          data,
          outgoingDate,
          currentItemsList,
          repositoryLogger
        );

        repositoryLogger.info('Outgoing goods traceability processing completed', {
          outgoingGoodId: outgoingGood.id,
          traceabilityCount,
        });

        return {
          outgoingGoodId: outgoingGood.id,
          itemCount: data.items.length,
          currentItemsList,
          traceabilityCount,
        };
      });

      repositoryLogger.info('Outgoing goods core transaction completed successfully', {
        outgoingGoodId: result.outgoingGoodId,
        itemCount: result.itemCount,
      });

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

      await this.syncItemDescriptionsFromPayload(
        data.company_code,
        newItems,
        data.wms_id,
        'outgoing_goods'
      );

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
