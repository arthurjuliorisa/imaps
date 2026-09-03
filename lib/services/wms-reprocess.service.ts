import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db/prisma';
import { AdjustmentsRepository } from '@/lib/repositories/adjustments.repository';
import { IncomingGoodsRepository } from '@/lib/repositories/incoming-goods.repository';
import { MaterialUsageRepository } from '@/lib/repositories/material-usage.repository';
import { OutgoingGoodsRepository } from '@/lib/repositories/outgoing-goods.repository';
import { ProductionOutputRepository } from '@/lib/repositories/production-output.repository';
import { WipBalanceRepository } from '@/lib/repositories/wip-balance.repository';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import type { WipBalanceRecord } from '@/lib/types/wip-balance.types';
import {
  checkAdjustmentDuplicates,
  validateAdjustmentBatch,
  validateAdjustmentItemTypeConsistency,
  validateItemTypes as validateAdjustmentItemTypes,
} from '@/lib/validators/schemas/adjustment.schema';
import {
  checkIncomingGoodsDuplicates,
  validateIncomingGoodRequest,
  validateIncomingGoodsDates,
  validateIncomingGoodsItemTypeConsistency,
  validateItemTypes as validateIncomingItemTypes,
} from '@/lib/validators/schemas/incoming-goods.schema';
import {
  checkMaterialUsageDuplicates,
  validateMaterialUsageBatch,
  validateMaterialUsageItemTypeConsistency,
  validateItemTypes as validateMaterialUsageItemTypes,
} from '@/lib/validators/schemas/material-usage.schema';
import {
  checkOutgoingGoodsDuplicateAllocations,
  validateOutgoingGoodRequest,
  validateOutgoingGoodsDates,
  validateOutgoingGoodsItemTypeConsistency,
  validateItemTypes as validateOutgoingItemTypes,
} from '@/lib/validators/schemas/outgoing-goods.schema';
import {
  validateItemTypes as validateProductionOutputItemTypes,
  validateProductionOutputBatch,
  validateProductionOutputItemTypeConsistency,
} from '@/lib/validators/schemas/production-output.schema';
import {
  checkWipBalanceDuplicates,
  validateItemTypes as validateWipItemTypes,
  validateWIPBalanceBatch,
  validateWipBalanceItemTypeConsistency,
  validateWipBalanceRecord,
} from '@/lib/validators/schemas/wip-balance.schema';

export type RetryableWmsTransactionType =
  | 'incoming_goods'
  | 'outgoing_goods'
  | 'material_usage'
  | 'production_output'
  | 'adjustments'
  | 'wip_balance';

const retryableActions: Record<string, RetryableWmsTransactionType> = {
  WMS_PROCESS_INCOMING_GOODS: 'incoming_goods',
  WMS_PROCESS_OUTGOING_GOODS: 'outgoing_goods',
  WMS_PROCESS_MATERIAL_USAGE: 'material_usage',
  WMS_PROCESS_PRODUCTION_OUTPUT: 'production_output',
  WMS_PROCESS_ADJUSTMENTS: 'adjustments',
  WMS_PROCESS_WIP_BALANCE: 'wip_balance',
};

const retryableTypes = new Set<RetryableWmsTransactionType>(Object.values(retryableActions));

const inswTransactionTypes: Partial<Record<RetryableWmsTransactionType, string>> = {
  incoming_goods: 'incoming',
  outgoing_goods: 'outgoing',
  material_usage: 'material_usage',
  production_output: 'production_output',
  adjustments: 'adjustment',
};

export type PersistedWmsTransaction = {
  id: number;
  companyCode: number;
  wmsId: string;
};

export type WmsRetryInswResult = {
  attempted: boolean;
  status: 'not_applicable' | 'skipped' | 'success' | 'failed';
  message: string;
};

type ValidationErrorLike = { field: string; message: string };

export function getRetryableWmsTransactionType(
  action: string,
  responsePayload?: unknown
): RetryableWmsTransactionType | null {
  const actionType = retryableActions[action];
  if (!actionType) return null;

  const responseType = (responsePayload as { transaction_type?: unknown } | null)?.transaction_type;
  if (
    typeof responseType === 'string' &&
    retryableTypes.has(responseType as RetryableWmsTransactionType) &&
    responseType !== actionType
  ) {
    return null;
  }

  return actionType;
}

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatValidationErrors(errors: ValidationErrorLike[]): string {
  return errors.map((error) => `${error.field}: ${error.message}`).join('; ');
}

function assertPayloadIdentity(
  payload: { company_code?: number; wms_id?: string },
  expected: { companyCode: number | null; wmsId: string | null }
): void {
  if (expected.companyCode !== null && payload.company_code !== expected.companyCode) {
    throw new Error('Retry payload company_code does not match the selected WMS log');
  }

  if (expected.wmsId && payload.wms_id !== expected.wmsId) {
    throw new Error('Retry payload wms_id does not match the selected WMS log');
  }
}

function assertWipPayloadIdentity(
  payload: { records?: Array<{ company_code?: number; wms_id?: string }> } | Array<{ company_code?: number; wms_id?: string }>,
  expected: { companyCode: number | null; wmsId: string | null }
): void {
  const records = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.records)
      ? payload.records
      : [payload as { company_code?: number; wms_id?: string }];

  if (expected.companyCode !== null && records.some((record) => record.company_code !== expected.companyCode)) {
    throw new Error('Retry payload company_code does not match the selected WMS log');
  }

  if (expected.wmsId && records.some((record) => record.wms_id !== expected.wmsId)) {
    throw new Error('Retry payload wms_id does not match the selected WMS log');
  }
}

function normalizeWipPayload(payload: unknown): WipBalanceRecord[] {
  const records = Array.isArray((payload as { records?: unknown[] })?.records)
    ? (payload as { records: unknown[] }).records
    : [payload];

  return records.map((record) => {
    const value = record as any;

    return {
      wms_id: value.wms_id,
      company_code: value.company_code,
      item_type: value.item_type,
      item_code: value.item_code,
      item_name: value.item_name,
      stock_date: toDate(value.stock_date),
      uom: value.uom,
      qty: value.qty,
      timestamp: toDate(value.timestamp),
    };
  });
}

export async function validateWmsRetryPayload(
  transactionType: RetryableWmsTransactionType,
  payload: unknown,
  expected: { companyCode: number | null; wmsId: string | null }
): Promise<void> {
  switch (transactionType) {
    case 'incoming_goods': {
      const validation = validateIncomingGoodRequest(payload);
      if (!validation.success || !validation.data) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(validation.errors || [])}`);
      }

      assertPayloadIdentity(validation.data, expected);
      const errors = [
        ...validateIncomingGoodsDates(validation.data),
        ...checkIncomingGoodsDuplicates(validation.data),
        ...(await validateIncomingItemTypes(validation.data)),
        ...(await validateIncomingGoodsItemTypeConsistency(validation.data)),
      ];

      if (errors.length > 0) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(errors)}`);
      }
      return;
    }

    case 'outgoing_goods': {
      const validation = validateOutgoingGoodRequest(payload);
      if (!validation.success || !validation.data) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(validation.errors || [])}`);
      }

      assertPayloadIdentity(validation.data, expected);
      const errors = [
        ...validateOutgoingGoodsDates(validation.data),
        ...checkOutgoingGoodsDuplicateAllocations(validation.data),
        ...(await validateOutgoingItemTypes(validation.data)),
        ...(await validateOutgoingGoodsItemTypeConsistency(validation.data)),
      ];

      if (errors.length > 0) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(errors)}`);
      }
      return;
    }

    case 'material_usage': {
      const validation = validateMaterialUsageBatch(payload);
      if (!validation.success || !validation.data) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(validation.errors || [])}`);
      }

      assertPayloadIdentity(validation.data, expected);
      const errors = [
        ...checkMaterialUsageDuplicates(validation.data),
        ...(await validateMaterialUsageItemTypes(validation.data)),
        ...(await validateMaterialUsageItemTypeConsistency(validation.data)),
      ];

      if (errors.length > 0) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(errors)}`);
      }
      return;
    }

    case 'production_output': {
      const validation = validateProductionOutputBatch(payload);
      if (!validation.success || !validation.data) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(validation.errors || [])}`);
      }

      assertPayloadIdentity(validation.data, expected);
      const errors = [
        ...(await validateProductionOutputItemTypes(validation.data)),
        ...(await validateProductionOutputItemTypeConsistency(validation.data)),
      ];

      if (errors.length > 0) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(errors)}`);
      }
      return;
    }

    case 'adjustments': {
      const validation = validateAdjustmentBatch(payload);
      if (!validation.success || !validation.data) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(validation.errors || [])}`);
      }

      assertPayloadIdentity(validation.data, expected);
      const errors = [
        ...checkAdjustmentDuplicates(validation.data),
        ...(await validateAdjustmentItemTypes(validation.data)),
        ...(await validateAdjustmentItemTypeConsistency(validation.data)),
      ];

      if (errors.length > 0) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(errors)}`);
      }
      return;
    }

    case 'wip_balance': {
      const validation = Array.isArray((payload as { records?: unknown[] })?.records)
        ? validateWIPBalanceBatch(payload)
        : validateWipBalanceRecord(payload);
      if (!validation.success || !validation.data) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(validation.errors || [])}`);
      }

      assertWipPayloadIdentity(validation.data as any, expected);
      const batchData = Array.isArray((payload as { records?: unknown[] })?.records)
        ? validation.data
        : { records: [validation.data] };
      const errors = [
        ...checkWipBalanceDuplicates(batchData as any),
        ...(await validateWipItemTypes(batchData as any)),
        ...(await validateWipBalanceItemTypeConsistency(batchData as any)),
      ];

      if (errors.length > 0) {
        throw new Error(`Retry payload validation failed: ${formatValidationErrors(errors)}`);
      }
      return;
    }
  }
}

export async function reprocessWmsPayload(
  transactionType: RetryableWmsTransactionType,
  payload: unknown
): Promise<{ itemCount: number; message: string }> {
  switch (transactionType) {
    case 'incoming_goods': {
      const result = await new IncomingGoodsRepository().createOrUpdate(payload as any);
      return {
        itemCount: result.items_count,
        message: `Incoming goods payload reprocessed for record ${result.id}`,
      };
    }

    case 'outgoing_goods':
      await new OutgoingGoodsRepository().insertOutgoingGoodsAsync(payload as any);
      return {
        itemCount: Array.isArray((payload as any)?.items) ? (payload as any).items.length : 0,
        message: 'Outgoing goods payload reprocessed',
      };

    case 'material_usage':
      await new MaterialUsageRepository().batchUpsert(payload as any);
      return {
        itemCount: Array.isArray((payload as any)?.items) ? (payload as any).items.length : 0,
        message: 'Material usage payload reprocessed',
      };

    case 'production_output': {
      const result = await new ProductionOutputRepository().create(payload as any);
      return {
        itemCount: Array.isArray((payload as any)?.items) ? (payload as any).items.length : 0,
        message: `Production output payload reprocessed for record ${result.header.id}`,
      };
    }

    case 'adjustments': {
      const result = await new AdjustmentsRepository().create(payload as any);
      return {
        itemCount: Array.isArray((payload as any)?.items) ? (payload as any).items.length : 0,
        message: `Adjustment payload reprocessed for record ${result.header.id}`,
      };
    }

    case 'wip_balance': {
      const records = normalizeWipPayload(payload);
      const result = await new WipBalanceRepository().batchUpsert(records);
      if (result.failed_count > 0) {
        throw new Error(
          `WIP balance retry failed for ${result.failed_count} record(s): ${result.failed_records
            .map((record) => `${record.wms_id}: ${record.error}`)
            .join('; ')}`
        );
      }

      return {
        itemCount: records.length,
        message: `WIP balance payload reprocessed for ${result.success_count} record(s)`,
      };
    }
  }
}

/**
 * Finds the exact persisted WMS transaction. A matching WMS ID on another
 * transaction date is deliberately rejected: repository replay paths can
 * treat that as a date-change update, which is unsafe for a retry.
 */
export async function findPersistedWmsTransaction(
  transactionType: RetryableWmsTransactionType,
  payload: unknown
): Promise<PersistedWmsTransaction | null> {
  const data = payload as { company_code: number; wms_id: string; incoming_date?: string | Date; outgoing_date?: string | Date; transaction_date?: string | Date };
  const companyCode = data.company_code;
  const wmsId = data.wms_id;
  if (!Number.isInteger(companyCode) || !wmsId) {
    throw new Error('local_exists_check: retry payload does not contain a resolvable company_code and wms_id');
  }

  if (transactionType === 'wip_balance') return null;

  const dateValue = transactionType === 'incoming_goods'
    ? data.incoming_date
    : transactionType === 'outgoing_goods'
      ? data.outgoing_date
      : data.transaction_date;
  const transactionDate = dateValue ? new Date(dateValue) : null;
  if (!transactionDate || Number.isNaN(transactionDate.getTime())) {
    throw new Error('local_exists_check: retry payload does not contain a valid transaction date');
  }

  const assertSingleExactMatch = <T extends { id: number }>(records: T[]): T | null => {
    if (records.length > 1) {
      throw new Error('local_exists_check: multiple active local transactions match this WMS identity');
    }
    return records[0] ?? null;
  };

  let record: { id: number } | null;
  let activeCount: number;
  switch (transactionType) {
    case 'incoming_goods': {
      const rows = await prisma.incoming_goods.findMany({ where: { company_code: companyCode, wms_id: wmsId, deleted_at: null }, select: { id: true, incoming_date: true } });
      activeCount = rows.length;
      record = assertSingleExactMatch(rows.filter(row => row.incoming_date.getTime() === transactionDate.getTime()));
      break;
    }
    case 'outgoing_goods': {
      const rows = await prisma.outgoing_goods.findMany({ where: { company_code: companyCode, wms_id: wmsId, deleted_at: null }, select: { id: true, outgoing_date: true } });
      activeCount = rows.length;
      record = assertSingleExactMatch(rows.filter(row => row.outgoing_date.getTime() === transactionDate.getTime()));
      break;
    }
    case 'material_usage': {
      const rows = await prisma.material_usages.findMany({ where: { company_code: companyCode, wms_id: wmsId, deleted_at: null }, select: { id: true, transaction_date: true } });
      activeCount = rows.length;
      record = assertSingleExactMatch(rows.filter(row => row.transaction_date.getTime() === transactionDate.getTime()));
      break;
    }
    case 'production_output': {
      const rows = await prisma.production_outputs.findMany({ where: { company_code: companyCode, wms_id: wmsId, deleted_at: null }, select: { id: true, transaction_date: true } });
      activeCount = rows.length;
      record = assertSingleExactMatch(rows.filter(row => row.transaction_date.getTime() === transactionDate.getTime()));
      break;
    }
    case 'adjustments': {
      const rows = await prisma.adjustments.findMany({ where: { company_code: companyCode, wms_id: wmsId, deleted_at: null }, select: { id: true, transaction_date: true } });
      activeCount = rows.length;
      record = assertSingleExactMatch(rows.filter(row => row.transaction_date.getTime() === transactionDate.getTime()));
      break;
    }
    default:
      return null;
  }

  // A same-domain WMS ID with a different date is ambiguous for retry and
  // must not be handed to repositories that implement date-change mutation.
  if (!record) {
    if (activeCount > 0) {
      throw new Error('local_exists_check: WMS ID exists locally with a different transaction date; refusing destructive replay');
    }
    return null;
  }
  return { id: record.id, companyCode, wmsId };
}

export async function continueWmsRetryToInsw(
  transactionType: RetryableWmsTransactionType,
  transaction: PersistedWmsTransaction
): Promise<WmsRetryInswResult> {
  const inswTransactionType = inswTransactionTypes[transactionType];
  if (!inswTransactionType) {
    return { attempted: false, status: 'not_applicable', message: 'This WMS transaction type does not auto-transmit to INSW' };
  }

  const company = await prisma.companies.findUnique({
    where: { code: transaction.companyCode },
    select: { company_type: true },
  });
  if (company?.company_type !== 'SEZ') {
    return { attempted: false, status: 'not_applicable', message: 'Local recovery complete; company is not SEZ' };
  }

  const previousSuccess = await prisma.insw_tracking_log.findFirst({
    where: {
      company_code: transaction.companyCode,
      transaction_type: inswTransactionType,
      insw_status: 'SUCCESS',
      ...(transactionType === 'outgoing_goods'
        ? { wms_id: transaction.wmsId }
        : { transaction_id: transaction.id }),
    },
    select: { id: true },
  });
  if (previousSuccess) {
    return { attempted: false, status: 'skipped', message: 'A successful INSW transmission is already recorded for this transaction' };
  }

  const service = new INSWTransmissionService();
  let result;
  switch (transactionType) {
    case 'incoming_goods': result = await service.transmitIncomingGoods(transaction.companyCode, [transaction.id]); break;
    case 'outgoing_goods': result = await service.transmitOutgoingGoodsByWmsIds(transaction.companyCode, [transaction.wmsId]); break;
    case 'material_usage': result = await service.transmitMaterialUsage(transaction.companyCode, [transaction.id], [transaction.wmsId]); break;
    case 'production_output': result = await service.transmitProductionOutput(transaction.companyCode, [transaction.id], [transaction.wmsId]); break;
    case 'adjustments': result = await service.transmitAdjustment(transaction.companyCode, transaction.id, transaction.wmsId); break;
    default: return { attempted: false, status: 'not_applicable', message: 'This WMS transaction type does not auto-transmit to INSW' };
  }
  return result.status === 'success'
    ? { attempted: true, status: 'success', message: result.message }
    : { attempted: true, status: 'failed', message: result.message };
}

export async function createWmsRetryAttemptLog(params: {
  originalLogId: bigint;
  action: string;
  companyCode: number | null;
  wmsId: string | null;
  status: 'SUCCESS' | 'ERROR';
  summary: string;
  payload: unknown;
  errorMessage?: string;
  itemCount: number | null;
}): Promise<bigint> {
  const activityLog = await prisma.activity_logs.create({
    data: {
      user_id: null,
      company_code: params.companyCode,
      action: `${params.action}_RETRY`,
      description: params.summary,
      status: params.status === 'SUCCESS' ? 'success' : 'error',
      metadata: {
        original_wms_log_id: params.originalLogId.toString(),
        wms_id: params.wmsId,
        company_code: params.companyCode,
        retry_status: params.status,
      },
    },
  });

  const retryLog = await prisma.wms_transmission_logs.create({
    data: {
      activity_log_id: activityLog.id,
      action: `${params.action}_RETRY`,
      wms_id: params.wmsId,
      company_code: params.companyCode,
      transmission_status: params.status,
      error_type: params.status === 'ERROR' ? 'ASYNC_RETRY_ERROR' : null,
      summary: params.summary,
      wms_request_payload: params.status === 'ERROR'
        ? JSON.parse(JSON.stringify(params.payload))
        : Prisma.JsonNull,
      imaps_error_response: params.status === 'ERROR'
        ? {
            status: 'failed',
            message: params.errorMessage,
            original_wms_log_id: params.originalLogId.toString(),
            timestamp: new Date().toISOString(),
          }
        : Prisma.JsonNull,
      item_count: params.itemCount,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });

  return retryLog.id;
}
