import { logger } from '@/lib/utils/logger';
import type { PrismaClient } from '@prisma/client';
import { boundedText } from '../insw-queue/contracts';
import { prisma } from '@/lib/prisma';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import {
  validateOutgoingGoodRequest,
  validateOutgoingGoodsDates,
  checkOutgoingGoodsDuplicateAllocations,
  validateItemTypes,
  validateOutgoingGoodsItemTypeConsistency,
  type OutgoingGoodRequestInput,
  type ValidationErrorDetail,
} from '@/lib/validators/schemas/outgoing-goods.schema';
import { OutgoingGoodsRepository } from '@/lib/repositories/outgoing-goods.repository';
import { logWmsAsyncFailure } from '@/lib/utils/wms-async-failure-log';
import { assertWmsIdNotExists } from '@/lib/services/wms-duplicate.service';
import { validateSezFreeMovementCustomsDocumentType } from '@/lib/validators/free-movement-customs-document';
import { validateNonFacilityMarker } from '@/lib/validators/non-facility-marker.validator';

// Tokens can only be minted inside the dormant private WMS completion seam.
// This is caller encapsulation, not persisted provenance or a security sandbox
// against trusted server code deliberately bypassing TypeScript private access.
type OutgoingCompletion = Readonly<{
  operation: 'OUTGOING'; companyCode: number; sourceId: number;
  businessDate: string; revision: 'ACCEPTED_WMS_ID'; requestedBy: string;
  completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED'; wmsReference: string;
}>;
const outgoingCompletions = new WeakMap<object, { db: PrismaClient; source: OutgoingCompletion }>();

/** Validation only: no exported token constructor or arbitrary-ID enrollment. */
export function authorizedOutgoingCompletion(db: PrismaClient, token: unknown): OutgoingCompletion | undefined {
  if (!token || typeof token !== 'object') return undefined;
  const entry = outgoingCompletions.get(token);
  return entry?.db === db ? entry.source : undefined;
}

export interface SuccessResponse {
  status: 'success';
  message: string;
  wms_id: string;
  queued_items_count: number;
  validated_at: string;
  is_revision?: boolean;
  warnings?: Array<{
    item_index: number;
    item_code: string;
    warning_type: string;
    message: string;
    // For new transactions
    current_stock?: number;
    outgoing_qty?: number;
    balance_after?: number;
    // For revisions with insufficient stock
    original_stock?: number;
    outgoing_before?: number;
    outgoing_after?: number;
    expected_balance_after?: number;
  }>;
  info?: Array<{
    item_index: number;
    item_code: string;
    message: string;
    balance_before: number;
    balance_after: number;
  }>;
}

export interface ErrorDetail {
  location: 'header' | 'item';
  field: string;
  code: string;
  message: string;
  item_index?: number;
  item_code?: string;
}

interface RevisionInfo {
  isRevision: boolean;
  previousItems?: Array<{
    item_code: string;
    qty: number;
  }>;
}

export class OutgoingGoodsService {
  /** Dormant: future wiring belongs at the existing insertOutgoingGoodsAsync
   * promise, never at HTTP acceptance/core commit. No live caller invokes this.
   * The private caller owns the genuine business promise and accepted scope.
   * Its void result requires a bounded exact reference/date lookup after resolve.
   */
  private async captureCompletedOutgoing(
    db: PrismaClient,
    businessCompletion: Promise<void>,
    scope: Readonly<{ companyCode: number; wmsReference: string; businessDate: string; requestedBy: string }>,
  ) {
    const expected = { ...scope }; // detach before awaiting the business promise
    await businessCompletion;
    try {
      if (![1370, 1380].includes(expected.companyCode)) throw new Error('SEZ_COMPANY_REQUIRED');
      boundedText(expected.wmsReference, 'WMS reference', 100);
      boundedText(expected.requestedBy, 'request actor', 100);
      const matches = await db.outgoing_goods.findMany({ where: {
        company_code: expected.companyCode, wms_id: expected.wmsReference, deleted_at: null,
        company: { company_type: 'SEZ' },
      }, take: 2, select: { id: true, outgoing_date: true, scrap_transaction_id: true } });
      if (matches.length !== 1) throw new Error('AMBIGUOUS_OR_MISSING_COMPLETED_OUTGOING');
      const row = matches[0];
      if (row.scrap_transaction_id !== null) throw new Error('SCRAP_SOURCE_EXCLUDED');
      if (row.outgoing_date.toISOString().slice(0, 10) !== expected.businessDate) throw new Error('SOURCE_DATE_OR_REVISION_MISMATCH');
      const input: OutgoingCompletion = Object.freeze({ operation: 'OUTGOING', companyCode: expected.companyCode,
        sourceId: row.id, businessDate: expected.businessDate, revision: 'ACCEPTED_WMS_ID',
        requestedBy: expected.requestedBy, completion: 'EXISTING_BUSINESS_COMPLETION_RESOLVED',
        wmsReference: expected.wmsReference });
      const token = Object.freeze({});
      outgoingCompletions.set(token, { db, source: input });
      try {
        const { captureCompletedWmsSource } = await import('../insw-worker/completed-source-capture');
        return await captureCompletedWmsSource(db, input, token);
      } finally { outgoingCompletions.delete(token); }
    } catch (error) {
      logger.error('Completed WMS Outgoing capture failed; no DIRECT fallback', {
        error: error instanceof Error ? error.message : String(error), wmsId: expected.wmsReference,
      });
      throw error;
    }
  }

  /**
   * Process outgoing goods request
   */
  async processOutgoingGoods(
    payload: unknown
  ): Promise<{ success: true; data: SuccessResponse } | { success: false; errors: ErrorDetail[] }> {
    const requestLogger = logger.child({
      service: 'OutgoingGoodsService',
      method: 'processOutgoingGoods',
    });

    try {
      // 1. Validate payload structure
      const validationResult = validateOutgoingGoodRequest(payload);

      if (!validationResult.success) {
        requestLogger.warn(
          'Validation failed',
          { errors: validationResult.errors }
        );
        return { success: false, errors: validationResult.errors as ErrorDetail[] };
      }

      const data = validationResult.data!;
      requestLogger.info('Validation passed', { wmsId: data.wms_id });

      const nonFacilityMarkerErrors = validateNonFacilityMarker(data, 'outgoing goods');
      if (nonFacilityMarkerErrors.length > 0) {
        requestLogger.warn('Non-facility marker validation failed', {
          errors: nonFacilityMarkerErrors,
          wmsId: data.wms_id,
        });
        return { success: false, errors: nonFacilityMarkerErrors };
      }

      const freeMovementErrors = validateSezFreeMovementCustomsDocumentType(
        data.company_code,
        data.customs_document_type
      );
      if (freeMovementErrors.length > 0) {
        requestLogger.warn('Free movement customs document validation failed', {
          errors: freeMovementErrors,
          wmsId: data.wms_id,
        });
        return { success: false, errors: freeMovementErrors };
      }

      // 2. Validate dates
      const dateErrors = validateOutgoingGoodsDates(data);
      if (dateErrors.length > 0) {
        requestLogger.warn(
          'Date validation failed',
          { errors: dateErrors }
        );
        return { success: false, errors: dateErrors as ErrorDetail[] };
      }

      // 3. Check for duplicate item_code + uom + work_order_number allocations
      const duplicateAllocationErrors = checkOutgoingGoodsDuplicateAllocations(data);
      if (duplicateAllocationErrors.length > 0) {
        requestLogger.warn(
          'Duplicate outgoing goods allocations found',
          { errors: duplicateAllocationErrors }
        );
        return { success: false, errors: duplicateAllocationErrors as ErrorDetail[] };
      }

      // 4. Validate item types
      const itemTypeErrors = await validateItemTypes(data);
      if (itemTypeErrors.length > 0) {
        requestLogger.warn(
          'Item type validation failed',
          { errors: itemTypeErrors }
        );
        return { success: false, errors: itemTypeErrors as ErrorDetail[] };
      }

      // 5. Validate item_type consistency
      const itemTypeConsistencyErrors = await validateOutgoingGoodsItemTypeConsistency(data);
      if (itemTypeConsistencyErrors.length > 0) {
        requestLogger.warn(
          'Item type consistency validation failed',
          { errors: itemTypeConsistencyErrors }
        );
        return { success: false, errors: itemTypeConsistencyErrors as ErrorDetail[] };
      }

      // 6. Validate production traceability for FERT/HALB items
      // const traceabilityErrors = validateProductionTraceability(data);
      // if (traceabilityErrors.length > 0) {
      //   requestLogger.warn(
      //     'Production traceability validation failed',
      //     { errors: traceabilityErrors }
      //   );
      //   return { success: false, errors: traceabilityErrors as ErrorDetail[] };
      // }

      // 7. Prevent duplicate accepted WMS IDs before any revision/upsert side effects
      const duplicateWmsIdErrors = await assertWmsIdNotExists({
        transactionType: 'outgoing_goods',
        companyCode: data.company_code,
        wmsId: data.wms_id,
      });
      if (duplicateWmsIdErrors.length > 0) {
        requestLogger.warn('Duplicate WMS ID rejected', {
          wmsId: data.wms_id,
          companyCode: data.company_code,
        });
        return { success: false, errors: duplicateWmsIdErrors };
      }

      // 8. Detect if this is a revision (same wms_id already exists)
      const revisionInfo = await this.detectRevision(data);
      requestLogger.info('Revision detection', { isRevision: revisionInfo.isRevision, wmsId: data.wms_id });

      // 9. Business validations - log unresolved traceability references without blocking stock movement
      const allocationValidationErrors = await this.validateWorkOrderAllocations(data);
      if (allocationValidationErrors.length > 0) {
        requestLogger.warn(
          'Work order allocation validation failed',
          { errors: allocationValidationErrors }
        );
        return { success: false, errors: allocationValidationErrors };
      }

      // 10. Check stock and collect warnings (pass revision info)
      const stockCheckResult = await this.checkStockAndCollectWarnings(data, revisionInfo);

      // 11. Queue async database insert + INSW auto-transmit
      const repository = new OutgoingGoodsRepository();
      repository.insertOutgoingGoodsAsync(data)
        .then(async () => {
          try {
            // Check company type
            const company = await prisma.companies.findUnique({
              where: { code: data.company_code },
              select: { company_type: true },
            });

            // Only transmit if SEZ company
            if (company?.company_type === 'SEZ') {
              const inswService = new INSWTransmissionService();
              const result = await inswService.transmitOutgoingGoodsByWmsIds(data.company_code, [data.wms_id]);
              if (result.status !== 'success') {
                requestLogger.warn('Outgoing goods INSW transmission failed', { wmsId: data.wms_id });
              } else {
                requestLogger.info('Outgoing goods transmitted to INSW', { wmsId: data.wms_id });
              }
            } else {
              requestLogger.info('Outgoing goods NOT transmitted to INSW (non-SEZ company)', { wmsId: data.wms_id, companyType: company?.company_type });
            }
          } catch (inswErr: any) {
            requestLogger.error('INSW auto-transmit error for outgoing goods', { wmsId: data.wms_id, error: inswErr.message });
          }
        })
        .catch((error) => {
          requestLogger.error('Failed to insert outgoing goods', { error, wmsId: data.wms_id });
          void logWmsAsyncFailure({
            action: 'WMS_PROCESS_OUTGOING_GOODS',
            transactionType: 'outgoing_goods',
            companyCode: data.company_code,
            wmsId: data.wms_id,
            error,
            phase: 'db_persistence',
            payload: data,
          });
        });

      // 12. Return success response immediately (without waiting for DB insert)
      const response: SuccessResponse = {
        status: 'success',
        message: 'Transaction validated and queued for processing',
        wms_id: data.wms_id,
        queued_items_count: data.items.length,
        validated_at: new Date().toISOString(),
      };

      if (revisionInfo.isRevision) {
        response.is_revision = true;
      }

      if (stockCheckResult.warnings && stockCheckResult.warnings.length > 0) {
        response.warnings = stockCheckResult.warnings;
      }

      if (stockCheckResult.info && stockCheckResult.info.length > 0) {
        response.info = stockCheckResult.info;
      }

      requestLogger.info('Outgoing goods processed successfully', {
        wmsId: data.wms_id,
        itemCount: data.items.length,
        warningCount: stockCheckResult.warnings?.length || 0,
        infoCount: stockCheckResult.info?.length || 0,
      });

      return { success: true, data: response };
    } catch (error) {
      requestLogger.error('Failed to process outgoing goods', { error });
      throw error;
    }
  }

  /**
   * Detect if this is a revision by checking if wms_id already exists
   */
  private async detectRevision(data: OutgoingGoodRequestInput): Promise<RevisionInfo> {
    const existingOutgoing = await prisma.outgoing_goods.findFirst({
      where: {
        wms_id: data.wms_id,
      },
      include: {
        items: {
          select: {
            item_code: true,
            qty: true,
          },
        },
      },
    });

    if (!existingOutgoing) {
      return { isRevision: false };
    }

    // Extract previous items qty mapping
    const previousItems = existingOutgoing.items.map((item: any) => ({
      item_code: item.item_code,
      qty: Number(item.qty),
    }));

    return {
      isRevision: true,
      previousItems,
    };
  }
  /**
   * Validate that work_order_allocations reference valid work orders or PPKEK numbers
   * 
   * API Contract v3.3.0 § 5.5:
   * - FERT items: work_order_allocations REQUIRED
   * - Non-FERT items: work_order_allocations OPTIONAL (can be from beginning_balance or purchase)
   * 
   * Traceability Model:
   * 1. FERT (Production): Validate work_order references valid production records
   * 2. HALB/ROH/HIBE (Purchased): Validate ppkek_number if provided (can be beginning_balance if not)
   * 3. Beginning balance items: Allowed without allocation (historical inventory)
   */
  private async validateWorkOrderAllocations(data: OutgoingGoodRequestInput): Promise<ErrorDetail[]> {
    const errors: ErrorDetail[] = [];

    // Log each item's work_order_allocations gaps without blocking
    for (let itemIndex = 0; itemIndex < data.items.length; itemIndex++) {
      const item = data.items[itemIndex];

      if (!item.work_order_allocations || item.work_order_allocations.length === 0) {
        logger.warn('Accepted with missing traceability allocation. Stock movement is processed, but BOM / PPKEK / WO traceability may be incomplete.', {
          endpoint: 'POST /api/v1/outgoing-goods',
          wms_id: data.wms_id,
          company_code: data.company_code,
          item_code: item.item_code,
          item_type: item.item_type,
          qty: item.qty,
        });
        continue;
      }

      // If allocations provided: log missing/unresolved references without blocking
      for (let allocIndex = 0; allocIndex < item.work_order_allocations.length; allocIndex++) {
        const allocation = item.work_order_allocations[allocIndex];

        if (allocation.work_order_number) {
          // Check work order existence for warning/logging only
          const workOrder = await prisma.work_order_fg_production.findFirst({
            where: {
              work_order_number: allocation.work_order_number,
              item_code: item.item_code,
              company_code: data.company_code,
            },
          });

          if (!workOrder) {
            logger.warn('Accepted with unresolved traceability reference. Stock movement is processed, but BOM / PPKEK / WO traceability may be incomplete.', {
              endpoint: 'POST /api/v1/outgoing-goods',
              wms_id: data.wms_id,
              company_code: data.company_code,
              item_code: item.item_code,
              item_type: item.item_type,
              work_order_number: allocation.work_order_number,
              ppkek_number: allocation.ppkek_number,
              qty: allocation.qty,
              reason: 'WORK_ORDER_NOT_FOUND',
            });
          }
        } else if (allocation.ppkek_number) {
          // Check PPKEK existence for warning/logging only
          const incoming = await prisma.incoming_goods.findFirst({
            where: {
              ppkek_number: allocation.ppkek_number,
              company_code: data.company_code,
            },
          });

          if (!incoming) {
            logger.warn('Accepted with unresolved traceability reference. Stock movement is processed, but BOM / PPKEK / WO traceability may be incomplete.', {
              endpoint: 'POST /api/v1/outgoing-goods',
              wms_id: data.wms_id,
              company_code: data.company_code,
              item_code: item.item_code,
              item_type: item.item_type,
              work_order_number: allocation.work_order_number,
              ppkek_number: allocation.ppkek_number,
              qty: allocation.qty,
              reason: 'PPKEK_NOT_FOUND',
            });
          }
        } else {
          logger.warn('Accepted with missing traceability reference. Stock movement is processed, but BOM / PPKEK / WO traceability may be incomplete.', {
            endpoint: 'POST /api/v1/outgoing-goods',
            wms_id: data.wms_id,
            company_code: data.company_code,
            item_code: item.item_code,
            item_type: item.item_type,
            work_order_number: allocation.work_order_number,
            ppkek_number: allocation.ppkek_number,
            qty: allocation.qty,
            reason: 'MISSING_WORK_ORDER_AND_PPKEK',
          });
        }
      }
    }

    return errors;
  }

  /**
   * Check current stock and collect warnings for items with insufficient stock
   * For revisions, calculate delta qty and check against stock
   */
  private async checkStockAndCollectWarnings(
    data: OutgoingGoodRequestInput,
    revisionInfo: RevisionInfo
  ): Promise<{
    warnings?: Array<{
      item_index: number;
      item_code: string;
      warning_type: string;
      message: string;
      current_stock: number;
      outgoing_qty: number;
      balance_after: number;
    }>;
    info?: Array<{
      item_index: number;
      item_code: string;
      message: string;
      balance_before: number;
      balance_after: number;
    }>;
  }> {
    const warnings: Array<{
      item_index: number;
      item_code: string;
      warning_type: string;
      message: string;
      // For new transactions
      current_stock?: number;
      outgoing_qty?: number;
      balance_after?: number;
      // For revisions with insufficient stock
      original_stock?: number;
      outgoing_before?: number;
      outgoing_after?: number;
      expected_balance_after?: number;
    }> = [];

    const info: Array<{
      item_index: number;
      item_code: string;
      message: string;
      balance_before: number;
      balance_after: number;
    }> = [];

    const outgoingDate = new Date(data.outgoing_date);

    // Collect all unique item codes to query in batch (avoid N+1)
    const uniqueItemCodes = Array.from(new Set(data.items.map((item) => item.item_code)));

    // For all cases (new or revision), get snapshot AS OF outgoing date (on or before)
    // This gives us the "original stock" at the time of transaction
    const snapshotDateCondition = { lte: outgoingDate };

    // Batch query all snapshots in one go
    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        company_code: data.company_code,
        item_code: {
          in: uniqueItemCodes,
        },
        snapshot_date: snapshotDateCondition,
      },
      select: {
        item_code: true,
        closing_balance: true,
        snapshot_date: true,
      },
      orderBy: {
        snapshot_date: 'desc',
      },
    });

    // Create a map of item_code -> latest snapshot
    // Since we ordered by snapshot_date DESC, first occurrence of each item_code is the latest
    const snapshotMap = new Map<string, { closing_balance: any; snapshot_date: Date }>();
    snapshots.forEach((snapshot) => {
      if (!snapshotMap.has(snapshot.item_code)) {
        snapshotMap.set(snapshot.item_code, {
          closing_balance: snapshot.closing_balance,
          snapshot_date: snapshot.snapshot_date,
        });
      }
    });

    // Process each item
    for (let itemIndex = 0; itemIndex < data.items.length; itemIndex++) {
      const item = data.items[itemIndex];

      const snapshotData = snapshotMap.get(item.item_code);
      const originalStock = snapshotData?.closing_balance ? Number(snapshotData.closing_balance) : 0;
      const newOutgoingQty = Number(item.qty);

      // Check if this is a revision
      if (revisionInfo.isRevision && revisionInfo.previousItems) {
        const previousItem = revisionInfo.previousItems.find((p) => p.item_code === item.item_code);
        
        if (previousItem) {
          const oldQty = previousItem.qty;
          
          // For revision: snapshot represents stock AFTER the old transaction
          // To get original stock before any transaction: snapshot + old_qty
          // Balance after new outgoing = (snapshot + old_qty) - new_qty
          const originalStockBeforeTransaction = originalStock + oldQty;
          const balanceAfterRevision = originalStockBeforeTransaction - newOutgoingQty;

          // Check if revision is OK (balance >= 0) or causes insufficient stock
          if (balanceAfterRevision < 0) {
            // Revision causes negative balance → WARNING
            warnings.push({
              item_index: itemIndex,
              item_code: item.item_code,
              warning_type: 'INSUFFICIENT_STOCK',
              message: `Outgoing qty revised from ${oldQty} to ${newOutgoingQty} units, expected balance ${balanceAfterRevision} units`,
              original_stock: originalStockBeforeTransaction,
              outgoing_before: oldQty,
              outgoing_after: newOutgoingQty,
              expected_balance_after: balanceAfterRevision,
            });
          } else {
            // Revision is OK → INFO
            info.push({
              item_index: itemIndex,
              item_code: item.item_code,
              message: `Outgoing qty revised from ${oldQty} to ${newOutgoingQty} units, expected balance ${balanceAfterRevision} units`,
              balance_before: originalStock,
              balance_after: balanceAfterRevision,
            });
          }
          continue;
        }
      }

      // For new transactions (not revision or item not found in revision)
      const balanceAfter = originalStock - newOutgoingQty;

      if (balanceAfter < 0) {
        warnings.push({
          item_index: itemIndex,
          item_code: item.item_code,
          warning_type: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock: Current stock ${originalStock} units, outgoing ${newOutgoingQty} units, resulting balance ${balanceAfter} units`,
          current_stock: originalStock,
          outgoing_qty: newOutgoingQty,
          balance_after: balanceAfter,
        });
      }
    }

    return {
      ...(warnings.length > 0 && { warnings }),
      ...(info.length > 0 && { info }),
    } as ReturnType<typeof this.checkStockAndCollectWarnings>;
  }
}
