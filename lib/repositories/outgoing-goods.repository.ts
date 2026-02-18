import { logger } from '@/lib/utils/logger';
import { prisma } from '@/lib/prisma';
import type { OutgoingGoodRequestInput } from '@/lib/validators/schemas/outgoing-goods.schema';
import { Prisma } from '@prisma/client';
import { BaseTransactionRepository } from './base-transaction.repository';
import type { SnapshotItem } from './snapshot.repository';
import { ppkekResolutionService, resolvePPKEKToIncoming } from '@/lib/services/ppkek-resolution.service';
import { bomCalculationService } from '@/lib/services/bom-calculation.service';

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
   * Enrich traceability record with BOM calculation and PPKEK resolution
   *
   * This method:
   * 1. Resolves production WMS ID to work order number
   * 2. Calls BOM Calculation Service to calculate material allocations
   * 3. For each allocation, resolves PPKEK to incoming goods
   * 4. Returns enriched traceability data ready for database insertion
   * 
   * @param tx - Prisma transaction context
   * @param productionWmsId - Production output WMS ID
   * @param itemCode - FG item code
   * @param qtyFG - Quantity of FG exported
   * @param companyCode - Company code
   * @param outgoingDate - Outgoing goods date
   * @param outgoingWmsId - Outgoing goods WMS ID
   * @param ppkekNumbersArray - Optional PPKEK numbers from outgoing goods header
   * @returns Array of enriched allocations or null if calculation failed
   */
  private async enrichTraceability(
    tx: any, // Prisma transaction context
    productionWmsId: string,
    itemCode: string,
    qtyFG: Prisma.Decimal,
    companyCode: number,
    outgoingDate: Date,
    outgoingWmsId: string,
    ppkekNumbersArray?: string[]
  ): Promise<any> {
    const logger_sub = logger.child({
      method: 'enrichTraceability',
      productionWmsId,
      itemCode,
    });

    try {
      // ====================================================================
      // STEP 1: Resolve production WMS ID to work order number
      // ====================================================================
      const workOrderFG = await tx.work_order_fg_production.findFirst({
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

      const workOrderNumber = workOrderFG.work_order_number;

      // ====================================================================
      // STEP 2: Use BOM Calculation Service to calculate allocations
      // ====================================================================
      const bomResult = await bomCalculationService.calculateBOM(
        workOrderNumber,
        itemCode,
        qtyFG,
        companyCode
      );

      if (bomResult.calculation_status !== 'success') {
        logger_sub.debug('BOM calculation did not return success', {
          status: bomResult.calculation_status,
          message: bomResult.error_message,
        });
        
        // For identify_product = 'N', this is expected behavior
        if (bomResult.calculation_status === 'identified_product_n') {
          return null;
        }
        
        // For other failures, log and return null
        return null;
      }

      if (bomResult.allocations.length === 0) {
        logger_sub.debug('No allocations from BOM calculation');
        return null;
      }

      // ====================================================================
      // STEP 3: Resolve PPKEK numbers for each allocation and enrich
      // ====================================================================
      const traceAllocations: any[] = [];

      for (const allocation of bomResult.allocations) {
        let resolvedPPKEK = null;

        // Try to resolve PPKEK from material usage first
        if (allocation) {
          // Get the PPKEK from material usage
          const materialUsageWithPPKEK = await tx.$queryRaw<any[]>`
            SELECT mui.ppkek_number
            FROM material_usage_items mui
            JOIN material_usages mu ON 
              mui.material_usage_id = mu.id 
              AND mui.material_usage_company = mu.company_code 
              AND mui.material_usage_date = mu.transaction_date
            WHERE mu.work_order_number = ${workOrderNumber}
              AND mui.item_code = ${allocation.material_item_code}
              AND mu.company_code = ${companyCode}
              AND mui.component_demand_qty IS NOT NULL
              AND mui.deleted_at IS NULL
            ORDER BY mu.transaction_date DESC
            LIMIT 1
          `;

          if (materialUsageWithPPKEK && materialUsageWithPPKEK.length > 0) {
            const ppkekNumber = materialUsageWithPPKEK[0].ppkek_number;
            if (ppkekNumber) {
              // Resolve PPKEK using service
              resolvedPPKEK = await ppkekResolutionService.resolve(
                ppkekNumber,
                allocation.material_item_code,
                companyCode,
                outgoingDate
              );
            }
          }
        }

        // Fallback: try to resolve from outgoing goods header PPKEK array
        if (!resolvedPPKEK && ppkekNumbersArray && ppkekNumbersArray.length > 0) {
          resolvedPPKEK = await ppkekResolutionService.resolve(
            ppkekNumbersArray[0],
            allocation.material_item_code,
            companyCode,
            outgoingDate
          );
        }

        // Build enriched traceability record
        traceAllocations.push({
          work_order_number: allocation.work_order_number,
          material_item_code: allocation.material_item_code,
          material_item_name: allocation.material_item_name,
          material_qty_allocated: allocation.material_qty_allocated,
          consumption_ratio: allocation.consumption_ratio,
          ppkek_number_incoming: resolvedPPKEK?.ppkek_number || null,
          incoming_goods_id: resolvedPPKEK?.incoming_goods_id || null,
          customs_registration_date: resolvedPPKEK?.customs_registration_date || null,
          customs_document_type: resolvedPPKEK?.customs_document_type || null,
          incoming_date: resolvedPPKEK?.incoming_date || null,
        });

        logger_sub.debug('Enriched allocation with PPKEK resolution', {
          materialItemCode: allocation.material_item_code,
          hasPPKEK: !!resolvedPPKEK,
        });
      }

      logger_sub.debug('Traceability enrichment complete', {
        allocationCount: traceAllocations.length,
      });

      return traceAllocations;
    } catch (error) {
      logger_sub.error('Error enriching traceability', { error });
      return null;
    }
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

        // 3. Insert/update outgoing_fg_production_traceability for FERT and HALB items
        //    WITH BOM enrichment (work order, materials, PPKEK resolution)
        //
        // Data Flow:
        // - If work_order_allocations provided: Use them to resolve work order -> production_wms_id
        //   Each allocation has specific qty for that work order
        const traceabilityInserts: Promise<any>[] = [];

        // Process each outgoing item
        for (const originalItem of data.items) {
          const currentItem = itemCodeToCurrentItem.get(originalItem.item_code);
          if (!currentItem) continue;

          // Only create traceability for FERT and HALB items
          if (!['FERT', 'HALB'].includes(originalItem.item_type.toUpperCase())) {
            continue;
          }

          // Determine work order allocation source and process accordingly
          // PRIORITY 1: work_order_allocations (new API v3.3.0)
          if (originalItem.work_order_allocations && originalItem.work_order_allocations.length > 0) {
            // Process each work order allocation
            for (const allocation of originalItem.work_order_allocations) {
              let productionWmsId: string | null = null;
              let sourceType: 'production' | 'incoming' = 'production';

              // Step 1: Resolve allocation source (production WO or incoming PPKEK)
              if (allocation.work_order_number) {
                // Case 1: Production FERT/HALB from work order
                const workOrderProduction = await tx.work_order_fg_production.findFirst({
                  where: {
                    work_order_number: allocation.work_order_number,
                    item_code: originalItem.item_code,
                    company_code: data.company_code,
                  },
                  select: {
                    production_wms_id: true,
                  },
                });

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
                // Case 2: Incoming HALB from PPKEK (direct incoming goods traceability)
                // For incoming HALB, we store traceability directly without production WO
                repositoryLogger.debug('Processing allocation from incoming HALB', {
                  ppkekNumber: allocation.ppkek_number,
                  itemCode: originalItem.item_code,
                  qty: allocation.qty,
                });
                sourceType = 'incoming';
              } else {
                // Should not reach here due to XOR validation, but guard against it
                repositoryLogger.warn('Allocation has neither work_order_number nor ppkek_number, skipping', {
                  itemCode: originalItem.item_code,
                });
                continue;
              }

              // Step 2: Enrich with BOM calculation using ALLOCATION QTY (not total qty)
              let enrichedAllocations: any[] | null = null;
              if (sourceType === 'production' && productionWmsId) {
                // Production FERT/HALB: enrich with BOM calculation
                enrichedAllocations = await this.enrichTraceability(
                  tx,
                  productionWmsId,
                  originalItem.item_code,
                  new Prisma.Decimal(allocation.qty.toString()), // Use allocation qty for this WO
                  data.company_code,
                  outgoingDate,
                  data.wms_id
                );
              } else if (sourceType === 'incoming' && allocation.ppkek_number) {
                // Incoming HALB: create direct traceability without BOM enrichment
                // The ppkek_number itself IS the incoming traceability
                const incomingResolve = await resolvePPKEKToIncoming(
                  allocation.ppkek_number,
                  originalItem.item_code,
                  data.company_code,
                  outgoingDate
                );
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

              // Step 3: Create traceability records for the allocation
              if (sourceType === 'production' && productionWmsId) {
                // Production FERT/HALB traceability
                if (enrichedAllocations && enrichedAllocations.length > 0) {
                  // Delete existing traceability records for this allocation
                  traceabilityInserts.push(
                    tx.outgoing_fg_production_traceability.deleteMany({
                      where: {
                        outgoing_wms_id: data.wms_id,
                        production_wms_id: productionWmsId,
                        item_code: originalItem.item_code,
                        outgoing_good_item_id: currentItem.id,
                      },
                    })
                  );

                  // Create new traceability records for all enriched materials
                  const traceabilityCreateData = enrichedAllocations.map((enrichment) => ({
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
                    ppkek_number_incoming: enrichment.ppkek_number_incoming,
                    incoming_goods_id: enrichment.incoming_goods_id,
                    customs_registration_date: enrichment.customs_registration_date,
                    customs_document_type: enrichment.customs_document_type,
                    incoming_date: enrichment.incoming_date,
                  }));

                  traceabilityInserts.push(
                    tx.outgoing_fg_production_traceability.createMany({
                      data: traceabilityCreateData,
                    })
                  );
                } else {
                  // Fallback: simple record without BOM enrichment (identify_product != 'Y')
                  // Delete existing records first
                  traceabilityInserts.push(
                    tx.outgoing_fg_production_traceability.deleteMany({
                      where: {
                        outgoing_wms_id: data.wms_id,
                        production_wms_id: productionWmsId,
                        item_code: originalItem.item_code,
                        outgoing_good_item_id: currentItem.id,
                      },
                    })
                  );

                  // Create new record
                  traceabilityInserts.push(
                    tx.outgoing_fg_production_traceability.create({
                      data: {
                        outgoing_good_item_id: currentItem.id,
                        outgoing_wms_id: data.wms_id,
                        production_wms_id: productionWmsId,
                        company_code: data.company_code,
                        item_code: originalItem.item_code,
                        trx_date: outgoingDate,
                        allocated_qty: new Prisma.Decimal(allocation.qty.toString()),
                      },
                    })
                  );
                }
              } else if (sourceType === 'incoming' && enrichedAllocations && enrichedAllocations.length > 0) {
                // Incoming HALB traceability (direct from incoming goods)
                // Delete existing records and create new ones
                traceabilityInserts.push(
                  tx.outgoing_fg_production_traceability.deleteMany({
                    where: {
                      outgoing_wms_id: data.wms_id,
                      item_code: originalItem.item_code,
                      outgoing_good_item_id: currentItem.id,
                      ppkek_number_incoming: {
                        not: null,
                      },
                    },
                  })
                );

                // Create new records for incoming-based traceability
                const incomingTraceData = enrichedAllocations.map((enrichment) => ({
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
                }));

                traceabilityInserts.push(
                  tx.outgoing_fg_production_traceability.createMany({
                    data: incomingTraceData,
                  })
                );
              }
            }
          } else {
            // No allocations provided - nothing to process
            repositoryLogger.warn('No work_order_allocations provided for FERT/HALB item, skipping traceability', {
              itemCode: originalItem.item_code,
            });
          }
        }

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
