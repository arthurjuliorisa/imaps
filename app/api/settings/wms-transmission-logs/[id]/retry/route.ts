import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import {
  createWmsRetryAttemptLog,
  getRetryableWmsTransactionType,
  reprocessWmsPayload,
  validateWmsRetryPayload,
} from '@/lib/services/wms-reprocess.service';

function getSafeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function getItemCount(payload: unknown): number | null {
  const candidate = payload as { items?: unknown[]; records?: unknown[] } | null | undefined;

  if (Array.isArray(candidate?.items)) return candidate.items.length;
  if (Array.isArray(candidate?.records)) return candidate.records.length;
  return payload ? 1 : null;
}

function buildPreviousFailure(log: {
  transmission_status: string;
  error_type: string | null;
  summary: string | null;
  imaps_error_response: any;
  created_at: Date;
}) {
  return {
    status: log.transmission_status,
    error_type: log.error_type,
    summary: log.summary,
    imaps_error_response: log.imaps_error_response,
    failed_at: log.created_at.toISOString(),
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const authCheck = await checkAuth();
  if (!authCheck.authenticated) {
    return authCheck.response;
  }

  const session = authCheck.session as any;
  const userRole = session?.user?.role;
  const userCompanyCode = session?.user?.companyCode
    ? parseInt(String(session.user.companyCode), 10)
    : null;
  const isSuperAdmin = userRole === 'SUPER_ADMIN';

  const { id } = await params;
  let logId: bigint;

  try {
    logId = BigInt(id);
  } catch {
    return NextResponse.json(
      { success: false, message: 'Invalid WMS log id' },
      { status: 400 }
    );
  }

  const log = await prisma.wms_transmission_logs.findFirst({
    where: {
      id: logId,
      ...(isSuperAdmin || !userCompanyCode ? {} : { company_code: userCompanyCode }),
    },
  });

  if (!log) {
    return NextResponse.json(
      { success: false, message: 'WMS log not found' },
      { status: 404 }
    );
  }

  if (!['FAILED', 'ERROR'].includes(log.transmission_status)) {
    return NextResponse.json(
      { success: false, message: 'Only FAILED or ERROR WMS logs can be retried' },
      { status: 400 }
    );
  }

  if (!['ASYNC_PROCESSING_ERROR', 'ASYNC_RETRY_ERROR'].includes(log.error_type || '')) {
    return NextResponse.json(
      { success: false, message: 'Only failed async WMS processing logs can be retried' },
      { status: 400 }
    );
  }

  const transactionType = getRetryableWmsTransactionType(
    log.action,
    log.imaps_error_response
  );

  if (!transactionType) {
    return NextResponse.json(
      { success: false, message: 'This WMS log action is not retryable' },
      { status: 400 }
    );
  }

  if (!log.wms_request_payload) {
    return NextResponse.json(
      {
        success: false,
        message: 'Retry unavailable because original payload was not stored for this log.',
      },
      { status: 400 }
    );
  }

  const payload = log.wms_request_payload;
  const itemCount = getItemCount(payload);
  const retryPreviousError = buildPreviousFailure(log);

  const retryStart = await prisma.wms_transmission_logs.updateMany({
    where: {
      id: logId,
      transmission_status: { in: ['FAILED', 'ERROR'] },
    },
    data: {
      transmission_status: 'RETRYING',
      summary: `Retrying ${transactionType} WMS payload`,
    },
  });

  if (retryStart.count !== 1) {
    return NextResponse.json(
      { success: false, message: 'This WMS log is already being retried or is no longer retryable' },
      { status: 409 }
    );
  }

  try {
    await validateWmsRetryPayload(transactionType, payload, {
      companyCode: log.company_code,
      wmsId: log.wms_id,
    });

    const result = await reprocessWmsPayload(transactionType, payload);
    const summary = `${result.message} via WMS log retry`;
    let retryAttemptLogId: string | null = null;

    try {
      const retryLogId = await createWmsRetryAttemptLog({
        originalLogId: logId,
        action: log.action,
        companyCode: log.company_code,
        wmsId: log.wms_id,
        status: 'SUCCESS',
        summary,
        payload,
        itemCount: result.itemCount || itemCount,
      });
      retryAttemptLogId = retryLogId.toString();
    } catch (retryLogError) {
      console.error('[WMS retry] Failed to create success retry attempt log:', {
        logId: logId.toString(),
        transactionType,
        wmsId: log.wms_id,
        error: retryLogError,
      });
    }

    await prisma.wms_transmission_logs.update({
      where: { id: logId },
      data: {
        transmission_status: 'SUCCESS',
        error_type: null,
        summary,
        imaps_error_response: {
          status: 'success',
          message: summary,
          transaction_type: transactionType,
          retry_previous_error: retryPreviousError,
          retry_result: {
            status: 'success',
            retried_at: new Date().toISOString(),
            retry_attempt_log_id: retryAttemptLogId,
          },
        },
        item_count: result.itemCount || itemCount,
      },
    });

    return NextResponse.json({
      success: true,
      message: summary,
      transaction_type: transactionType,
    });
  } catch (error) {
    const safeMessage = getSafeErrorMessage(error);
    const summary = `Retry failed for ${transactionType}: ${safeMessage}`;
    let retryAttemptLogId: string | null = null;

    console.error('[WMS retry] Reprocess failed:', {
      logId: logId.toString(),
      transactionType,
      wmsId: log.wms_id,
      error,
    });

    try {
      const retryLogId = await createWmsRetryAttemptLog({
        originalLogId: logId,
        action: log.action,
        companyCode: log.company_code,
        wmsId: log.wms_id,
        status: 'ERROR',
        summary,
        payload,
        errorMessage: safeMessage,
        itemCount,
      });
      retryAttemptLogId = retryLogId.toString();
    } catch (retryLogError) {
      console.error('[WMS retry] Failed to create failed retry attempt log:', {
        logId: logId.toString(),
        transactionType,
        wmsId: log.wms_id,
        error: retryLogError,
      });
    }

    await prisma.wms_transmission_logs.update({
      where: { id: logId },
      data: {
        transmission_status: 'ERROR',
        error_type: 'ASYNC_RETRY_ERROR',
        summary,
        imaps_error_response: {
          status: 'failed',
          message: safeMessage,
          transaction_type: transactionType,
          retry_previous_error: retryPreviousError,
          retry_result: {
            status: 'failed',
            retried_at: new Date().toISOString(),
            retry_attempt_log_id: retryAttemptLogId,
          },
        },
      },
    });

    return NextResponse.json(
      { success: false, message: safeMessage },
      { status: 500 }
    );
  }
}
