import { logger } from '@/lib/utils/logger';
import { prisma } from '@/lib/prisma';
import {
  validateOutgoingGoodRequest,
  validateOutgoingGoodsDates,
  validateProductionTraceability,
  validateItemTypes,
  validateOutgoingGoodsItemTypeConsistency,
  type OutgoingGoodRequestInput,
  type ValidationErrorDetail,
} from '@/lib/validators/schemas/outgoing-goods.schema';
import { OutgoingGoodsRepository } from '@/lib/repositories/outgoing-goods.repository';

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

      // 2. Validate dates
      const dateErrors = validateOutgoingGoodsDates(data);
      if (dateErrors.length > 0) {
        requestLogger.warn(
          'Date validation failed',
          { errors: dateErrors }
        );
        return { success: false, errors: dateErrors as ErrorDetail[] };
      }

      // 3. Validate item types
      const itemTypeErrors = await validateItemTypes(data);
      if (itemTypeErrors.length > 0) {
        requestLogger.warn(
          'Item type validation failed',
          { errors: itemTypeErrors }
        );
        return { success: false, errors: itemTypeErrors as ErrorDetail[] };
      }

      // 4. Validate item_type consistency
      const itemTypeConsistencyErrors = await validateOutgoingGoodsItemTypeConsistency(data);
      if (itemTypeConsistencyErrors.length > 0) {
        requestLogger.warn(
          'Item type consistency validation failed',
          { errors: itemTypeConsistencyErrors }
        );
        return { success: false, errors: itemTypeConsistencyErrors as ErrorDetail[] };
      }

      // 5. Validate production traceability for FERT/HALB items
      // const traceabilityErrors = validateProductionTraceability(data);
      // if (traceabilityErrors.length > 0) {
      //   requestLogger.warn(
      //     'Production traceability validation failed',
      //     { errors: traceabilityErrors }
      //   );
      //   return { success: false, errors: traceabilityErrors as ErrorDetail[] };
      // }

      // 6. Detect if this is a revision (same wms_id already exists)
      const revisionInfo = await this.detectRevision(data);
      requestLogger.info('Revision detection', { isRevision: revisionInfo.isRevision, wmsId: data.wms_id });

      // 7. Business validations - verify production_output_wms_ids exist
      const productionValidationErrors = await this.validateProductionOutputs(data);
      if (productionValidationErrors.length > 0) {
        requestLogger.warn(
          'Production output validation failed',
          { errors: productionValidationErrors }
        );
        return { success: false, errors: productionValidationErrors };
      }

      // 8. Check stock and collect warnings (pass revision info)
      const stockCheckResult = await this.checkStockAndCollectWarnings(data, revisionInfo);

      // 9. Queue async database insert
      const repository = new OutgoingGoodsRepository();
      repository.insertOutgoingGoodsAsync(data).catch((error) => {
        requestLogger.error('Failed to insert outgoing goods', { error, wmsId: data.wms_id });
      });

      // 10. Return success response immediately (without waiting for DB insert)
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
   * Validate that production_output_wms_ids exist in database
   */
  private async validateProductionOutputs(data: OutgoingGoodRequestInput): Promise<ErrorDetail[]> {
    const errors: ErrorDetail[] = [];

    // Collect all production_output_wms_ids to validate
    const allProductionWmsIds = new Set<string>();
    data.items.forEach((item) => {
      if (item.production_output_wms_ids) {
        item.production_output_wms_ids.forEach((wmsId) => allProductionWmsIds.add(wmsId));
      }
    });

    if (allProductionWmsIds.size === 0) {
      return errors; // No production WMS IDs to validate
    }

    // Query database for existing production outputs
    const existingProductions = await prisma.production_outputs.findMany({
      where: {
        wms_id: {
          in: Array.from(allProductionWmsIds),
        },
      },
      select: {
        wms_id: true,
      },
    });

    const existingWmsIds = new Set(existingProductions.map((p) => p.wms_id));

    // Check each item's production_output_wms_ids
    data.items.forEach((item, itemIndex) => {
      if (item.production_output_wms_ids) {
        const missingWmsIds = item.production_output_wms_ids.filter((wmsId) => !existingWmsIds.has(wmsId));

        if (missingWmsIds.length > 0) {
          errors.push({
            location: 'item',
            field: 'production_output_wms_ids',
            code: 'INVALID_VALUE',
            message: `Production output WMS IDs not found: ${missingWmsIds.join(', ')}`,
            item_index: itemIndex,
            item_code: item.item_code,
          });
        }
      }
    });

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
