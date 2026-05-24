import { prisma } from '@/lib/db/prisma';

interface WmsAsyncFailureLogParams {
  action: string;
  transactionType: string;
  companyCode?: number | null;
  wmsId?: string | null;
  error: unknown;
  phase: string;
  payload?: unknown;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getItemCount(payload: unknown): number | null {
  const candidate = payload as { items?: unknown[]; records?: unknown[] } | null | undefined;

  if (Array.isArray(candidate?.items)) return candidate.items.length;
  if (Array.isArray(candidate?.records)) return candidate.records.length;

  return null;
}

export async function logWmsAsyncFailure(params: WmsAsyncFailureLogParams): Promise<void> {
  const errorMessage = getErrorMessage(params.error);
  const summary = `Async ${params.transactionType} processing failed during ${params.phase}: ${errorMessage}`;
  const metadata = {
    wms_id: params.wmsId,
    company_code: params.companyCode,
    transaction_type: params.transactionType,
    processing_phase: params.phase,
    error_type: 'ASYNC_PROCESSING_ERROR',
    error_message: errorMessage,
  };

  try {
    const activityLog = await prisma.activity_logs.create({
      data: {
        user_id: null,
        company_code: params.companyCode ?? null,
        action: params.action,
        description: summary,
        status: 'error',
        metadata,
      },
    });

    await prisma.wms_transmission_logs.create({
      data: {
        activity_log_id: activityLog.id,
        action: params.action,
        wms_id: params.wmsId ?? null,
        company_code: params.companyCode ?? null,
        transmission_status: 'ERROR',
        error_type: 'ASYNC_PROCESSING_ERROR',
        summary,
        wms_request_payload: params.payload
          ? JSON.parse(JSON.stringify(params.payload))
          : null,
        imaps_error_response: {
          status: 'failed',
          transaction_type: params.transactionType,
          processing_phase: params.phase,
          message: errorMessage,
          timestamp: new Date().toISOString(),
        },
        item_count: getItemCount(params.payload),
        expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
  } catch (logError) {
    console.error('[logWmsAsyncFailure] Failed to log async WMS failure:', {
      error: getErrorMessage(logError),
      originalError: errorMessage,
      transactionType: params.transactionType,
      wmsId: params.wmsId,
    });
  }
}
