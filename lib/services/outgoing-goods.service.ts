import { logger } from '@/lib/utils/logger';
import { prisma } from '@/lib/prisma';
import {
  validateOutgoingGoodRequest,
  validateOutgoingGoodsDates,
  validateProductionTraceability,
  validateItemTypes,
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
  warnings?: Array<{
    item_index: number;
    item_code: string;
    warning_type: string;
    message: string;
    current_stock: number;
    outgoing_qty: number;
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

      // 4. Validate production traceability for FERT/HALB items
      // const traceabilityErrors = validateProductionTraceability(data);
      // if (traceabilityErrors.length > 0) {
      //   requestLogger.warn(
      //     'Production traceability validation failed',
      //     { errors: traceabilityErrors }
      //   );
      //   return { success: false, errors: traceabilityErrors as ErrorDetail[] };
      // }

      // 5. Business validations - verify production_output_wms_ids exist
      const productionValidationErrors = await this.validateProductionOutputs(data);
      if (productionValidationErrors.length > 0) {
        requestLogger.warn(
          'Production output validation failed',
          { errors: productionValidationErrors }
        );
        return { success: false, errors: productionValidationErrors };
      }

      // 6. Check stock and collect warnings
      const warnings = await this.checkStockAndCollectWarnings(data);

      // 7. Queue async database insert
      const repository = new OutgoingGoodsRepository();
      repository.insertOutgoingGoodsAsync(data).catch((error) => {
        requestLogger.error('Failed to insert outgoing goods', { error, wmsId: data.wms_id });
      });

      // 7. Return success response immediately (without waiting for DB insert)
      const response: SuccessResponse = {
        status: 'success',
        message: 'Transaction validated and queued for processing',
        wms_id: data.wms_id,
        queued_items_count: data.items.length,
        validated_at: new Date().toISOString(),
      };

      if (warnings && warnings.length > 0) {
        response.warnings = warnings;
      }

      requestLogger.info('Outgoing goods processed successfully', {
        wmsId: data.wms_id,
        itemCount: data.items.length,
        warningCount: warnings?.length || 0,
      });

      return { success: true, data: response };
    } catch (error) {
      requestLogger.error('Failed to process outgoing goods', { error });
      throw error;
    }
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
   */
  private async checkStockAndCollectWarnings(
    data: OutgoingGoodRequestInput
  ): Promise<
    Array<{
      item_index: number;
      item_code: string;
      warning_type: string;
      message: string;
      current_stock: number;
      outgoing_qty: number;
      balance_after: number;
    }> | undefined
  > {
    const warnings: Array<{
      item_index: number;
      item_code: string;
      warning_type: string;
      message: string;
      current_stock: number;
      outgoing_qty: number;
      balance_after: number;
    }> = [];

    const outgoingDate = new Date(data.outgoing_date);

    for (let itemIndex = 0; itemIndex < data.items.length; itemIndex++) {
      const item = data.items[itemIndex];

      // Query stock_daily_snapshot for current stock
      // Use snapshot from the PREVIOUS day since today's snapshot is created at end-of-day
      // For same-day transactions, we need yesterday's closing balance as today's opening
      const previousDay = new Date(outgoingDate);
      previousDay.setDate(previousDay.getDate() - 1);

      const snapshot = await prisma.stock_daily_snapshot.findFirst({
        where: {
          company_code: data.company_code,
          item_code: item.item_code,
          snapshot_date: previousDay,
        },
        select: {
          closing_balance: true,
        },
        orderBy: {
          snapshot_date: 'desc', // In case multiple snapshots exist, get the latest
        },
      });

      const currentStock = snapshot?.closing_balance ? Number(snapshot.closing_balance) : 0;
      const outgoingQty = Number(item.qty);
      const balanceAfter = currentStock - outgoingQty;

      // If insufficient stock, create warning
      if (balanceAfter < 0) {
        warnings.push({
          item_index: itemIndex,
          item_code: item.item_code,
          warning_type: 'INSUFFICIENT_STOCK',
          message: `Insufficient stock: Current stock ${currentStock} units, outgoing ${outgoingQty} units, resulting balance ${balanceAfter} units`,
          current_stock: currentStock,
          outgoing_qty: outgoingQty,
          balance_after: balanceAfter,
        });
      }
    }

    return warnings.length > 0 ? warnings : undefined;
  }
}
