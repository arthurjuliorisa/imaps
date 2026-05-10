import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';

export const WMS_VALIDATION_STATUS = {
  RECEIVED: 'RECEIVED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  VALIDATED: 'VALIDATED',
} as const;

export const WMS_BACKEND_PROCESSING_STATUS = {
  NOT_STARTED: 'NOT_STARTED',
  QUEUED: 'QUEUED',
  PROCESSING: 'PROCESSING',
  PROCESSED_SUCCESS: 'PROCESSED_SUCCESS',
  PROCESSED_PARTIAL: 'PROCESSED_PARTIAL',
  PROCESSING_FAILED: 'PROCESSING_FAILED',
} as const;

type ProcessingLogId = bigint | number | string | null | undefined;

interface CreateProcessingLogParams {
  endpoint: string;
  httpMethod?: string;
  wmsId?: string | null;
  companyCode?: number | string | null;
  requestId?: string | null;
  payload?: unknown;
  transmittedItemCount?: number | null;
  validatedItemCount?: number | null;
  queuedItemCount?: number | null;
  wmsTransmissionLogId?: bigint | number | string | null;
}

interface MarkSuccessParams {
  insertedItemCount?: number | null;
  updatedItemCount?: number | null;
  failedItemCount?: number | null;
}

interface MarkPartialParams extends MarkSuccessParams {
  errorCode?: string | null;
  errorMessage?: string | null;
  errorTarget?: string | null;
}

interface MarkFailedParams {
  error: unknown;
  failedItemCount?: number | null;
  errorTarget?: string | null;
}

const auditLogger = logger.child({ scope: 'WmsProcessingAuditService' });

function toBigIntId(id: ProcessingLogId): bigint | null {
  if (id === null || id === undefined) return null;
  try {
    return BigInt(id);
  } catch {
    return null;
  }
}

function toNullableInt(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function truncate(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (typeof nestedValue === 'bigint') return nestedValue.toString();
    if (nestedValue && typeof nestedValue === 'object' && !Array.isArray(nestedValue)) {
      return Object.keys(nestedValue as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (nestedValue as Record<string, unknown>)[key];
          return acc;
        }, {});
    }
    return nestedValue;
  });
}

function hashPayload(payload: unknown): string | null {
  if (!payload) return null;
  try {
    return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex');
  } catch (error) {
    auditLogger.warn('Failed to hash WMS payload for processing audit', {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function sanitizeStack(stack: string | undefined): string | null {
  if (!stack) return null;
  return truncate(
    stack
      .split('\n')
      .slice(0, 8)
      .map((line) => line.replace(/(password|token|secret|apikey|api_key)=\S+/gi, '$1=[REDACTED]'))
      .join('\n'),
    4000
  );
}

function sanitizeError(error: unknown, fallbackTarget?: string | null) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      errorCode: error.code,
      errorMessage: truncate(error.message, 2000),
      errorTarget: truncate(
        fallbackTarget || JSON.stringify(error.meta?.target || error.meta || null),
        1000
      ),
      sanitizedErrorStack: sanitizeStack(error.stack),
    };
  }

  if (error instanceof Error) {
    const maybeCode = (error as any).code ? String((error as any).code) : error.name;
    return {
      errorCode: truncate(maybeCode, 80),
      errorMessage: truncate(error.message, 2000),
      errorTarget: truncate(fallbackTarget || (error as any).target || null, 1000),
      sanitizedErrorStack: sanitizeStack(error.stack),
    };
  }

  return {
    errorCode: 'UNKNOWN',
    errorMessage: truncate(String(error), 2000),
    errorTarget: truncate(fallbackTarget || null, 1000),
    sanitizedErrorStack: null,
  };
}

export function getWmsPayloadItemCount(payload: any): number | null {
  if (!payload || typeof payload !== 'object') return null;
  if (Array.isArray(payload.items)) return payload.items.length;
  if (Array.isArray(payload.records)) return payload.records.length;
  return null;
}

export async function createWmsProcessingLogSafe(
  params: CreateProcessingLogParams
): Promise<bigint | null> {
  try {
    const count = params.transmittedItemCount ?? getWmsPayloadItemCount(params.payload);
    const log = await prisma.wms_processing_logs.create({
      data: {
        wms_transmission_log_id: toBigIntId(params.wmsTransmissionLogId),
        endpoint: params.endpoint,
        http_method: params.httpMethod || 'POST',
        wms_id: params.wmsId || null,
        company_code: toNullableInt(params.companyCode),
        request_id: params.requestId || null,
        payload_hash: hashPayload(params.payload),
        validation_status: WMS_VALIDATION_STATUS.VALIDATED,
        backend_processing_status: WMS_BACKEND_PROCESSING_STATUS.QUEUED,
        transmitted_item_count: count,
        validated_item_count: params.validatedItemCount ?? count,
        queued_item_count: params.queuedItemCount ?? count,
      },
      select: { id: true },
    });

    return log.id;
  } catch (error) {
    auditLogger.error('Failed to create WMS processing audit log', {
      endpoint: params.endpoint,
      wmsId: params.wmsId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function markWmsProcessingStartedSafe(id: ProcessingLogId): Promise<void> {
  const logId = toBigIntId(id);
  if (!logId) return;

  try {
    await prisma.wms_processing_logs.updateMany({
      where: {
        id: logId,
        backend_processing_finished_at: null,
      },
      data: {
        backend_processing_status: WMS_BACKEND_PROCESSING_STATUS.PROCESSING,
        backend_processing_started_at: new Date(),
      },
    });
  } catch (error) {
    auditLogger.error('Failed to mark WMS processing audit as started', {
      processingLogId: logId.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function markWmsProcessingSuccessSafe(
  id: ProcessingLogId,
  params: MarkSuccessParams = {}
): Promise<void> {
  const logId = toBigIntId(id);
  if (!logId) return;

  try {
    await prisma.wms_processing_logs.update({
      where: { id: logId },
      data: {
        backend_processing_status: WMS_BACKEND_PROCESSING_STATUS.PROCESSED_SUCCESS,
        backend_processing_finished_at: new Date(),
        inserted_item_count: params.insertedItemCount ?? undefined,
        updated_item_count: params.updatedItemCount ?? undefined,
        failed_item_count: params.failedItemCount ?? undefined,
      },
    });
  } catch (error) {
    auditLogger.error('Failed to mark WMS processing audit as success', {
      processingLogId: logId.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function markWmsProcessingPartialSafe(
  id: ProcessingLogId,
  params: MarkPartialParams
): Promise<void> {
  const logId = toBigIntId(id);
  if (!logId) return;

  try {
    await prisma.wms_processing_logs.update({
      where: { id: logId },
      data: {
        backend_processing_status: WMS_BACKEND_PROCESSING_STATUS.PROCESSED_PARTIAL,
        backend_processing_finished_at: new Date(),
        inserted_item_count: params.insertedItemCount ?? undefined,
        updated_item_count: params.updatedItemCount ?? undefined,
        failed_item_count: params.failedItemCount ?? undefined,
        error_code: truncate(params.errorCode || null, 80),
        error_message: truncate(params.errorMessage || null, 2000),
        error_target: truncate(params.errorTarget || null, 1000),
      },
    });
  } catch (error) {
    auditLogger.error('Failed to mark WMS processing audit as partial', {
      processingLogId: logId.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function markWmsProcessingFailedSafe(
  id: ProcessingLogId,
  params: MarkFailedParams
): Promise<void> {
  const logId = toBigIntId(id);
  if (!logId) return;

  const sanitized = sanitizeError(params.error, params.errorTarget);

  try {
    await prisma.wms_processing_logs.update({
      where: { id: logId },
      data: {
        backend_processing_status: WMS_BACKEND_PROCESSING_STATUS.PROCESSING_FAILED,
        backend_processing_finished_at: new Date(),
        failed_item_count: params.failedItemCount ?? undefined,
        error_code: sanitized.errorCode,
        error_message: sanitized.errorMessage,
        error_target: sanitized.errorTarget,
        sanitized_error_stack: sanitized.sanitizedErrorStack,
      },
    });
  } catch (error) {
    auditLogger.error('Failed to mark WMS processing audit as failed', {
      processingLogId: logId.toString(),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
