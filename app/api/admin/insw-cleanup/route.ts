/**
 * API Route: Admin - INSW Cleanup
 * POST /api/admin/insw-cleanup - Clean up temporary transaction data from INSW (test mode only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { logActivity } from '@/lib/log-activity';
import { resolveInswCompanyConfig } from '@/lib/config/insw-company-config';
import {
  resolveCleanupCompanyContext,
  CleanupCompanyContextError,
} from '@/lib/cleanup/cleanup-company-context';
import { deleteINSWTrackingLogsForCompany } from '@/lib/repositories/insw-tracking-log.repository';
import { assertINSWCleanupIdle, deleteINSWOperationalData, includesINSWQueueCleanup, hasKnownINSWCleanupPhase, INSWCleanupBusyError, INSWCleanupResidualError } from '@/lib/insw-queue/cleanup';

function inswCleanupErrorResponse(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    { status }
  );
}

/**
 * Handler: POST /api/admin/insw-cleanup
 * Clean up temporary INSW transaction data
 */
export async function POST(request: NextRequest) {
  try {
    const { user, company, companyCode } = await resolveCleanupCompanyContext();
    const inswConfig = resolveInswCompanyConfig(companyCode);
    if (!inswConfig.useTestMode) {
      return inswCleanupErrorResponse(
        403,
        'INSW_CLEANUP_TEST_MODE_REQUIRED',
        `INSW cleanup is only available when company ${companyCode} is configured in test mode`
      );
    }

    if (!hasKnownINSWCleanupPhase()) {
      return inswCleanupErrorResponse(403, 'INSW_CLEANUP_PHASE_REQUIRED',
        'A known, matching server DATABASE_PHASE is required before INSW cleanup.');
    }
    const includeQueue = includesINSWQueueCleanup();
    let confirmation;
    if (includeQueue) {
      // Browser same-origin JSON action protects the explicit confirmation from
      // cross-site form submission. Scope always comes from the DB/session.
      if (request.headers.get('origin') !== new URL(request.url).origin
        || !request.headers.get('content-type')?.startsWith('application/json')
        || request.headers.get('sec-fetch-site') === 'cross-site') {
        return inswCleanupErrorResponse(403, 'INSW_CLEANUP_CONFIRMATION_REQUIRED', 'Use the same-origin Admin cleanup confirmation.');
      }
      const body = await request.json().catch(() => null);
      if (!body || body.confirmation !== `RESET ${companyCode}` || body.producersStopped !== true
        || (body.companyCode !== undefined && body.companyCode !== companyCode)) {
        return inswCleanupErrorResponse(400, 'INSW_CLEANUP_CONFIRMATION_REQUIRED',
          `Confirm RESET ${companyCode} and attest all workers/producers are stopped with no active transmissions.`);
      }
      confirmation = { operator: user.id, companyCode, discardTestData: true, producersStopped: true };
    }
    // Preflight avoids a known-unsafe remote cleanup; local deletion repeats the
    // guard under writer locks because remote and local steps cannot be atomic.
    if (confirmation) await assertINSWCleanupIdle(companyCode, confirmation);

    // Execute external cleanup first. Local logs are only deleted after this succeeds.
    const inswService = new INSWTransmissionService();
    const externalResult = await inswService.cleanupINSWData(companyCode);

    if (externalResult.status !== 'success') {
      await logActivity({
        userId: user.id,
        action: 'INSW_CLEANUP_FAILED',
        description: `INSW temporary data cleanup failed for company code ${companyCode}`,
        status: 'failed',
        metadata: {
          companyCode,
          companyName: company.name,
          npwpConfigured: Boolean(inswConfig.npwp),
          external_result: externalResult.status,
          success_count: externalResult.success_count,
          failed_count: externalResult.failed_count,
        },
      });

      return NextResponse.json({
        success: false,
        companyCode,
        companyName: company.name,
        error: {
          code: 'EXTERNAL_INSW_CLEANUP_FAILED',
          message: externalResult.message || 'External INSW cleanup failed.',
        },
        externalINSWCleanup: {
          success: false,
          message: externalResult.message || 'External INSW cleanup failed.',
          result: externalResult,
        },
        ...(includeQueue ? { localQueueCleanup: { success: false, deletedRows: 0, skipped: true } } : {}),
        localTrackingLogCleanup: {
          success: false,
          deletedRows: 0,
          skipped: true,
          message: 'Local tracking logs were preserved because external INSW cleanup failed.',
        },
        timestamp: new Date().toISOString(),
      }, { status: 502 });
    }

    let deletedLocalTrackingLogRows = 0;
    let localQueueCleanup: Awaited<ReturnType<typeof deleteINSWOperationalData>> | undefined;
    try {
      if (confirmation) {
        localQueueCleanup = await deleteINSWOperationalData(companyCode, confirmation);
        deletedLocalTrackingLogRows = localQueueCleanup.trackingLogs;
      } else {
        deletedLocalTrackingLogRows = await deleteINSWTrackingLogsForCompany(companyCode);
      }
    } catch (error) {
      logger.error('Failed to delete local INSW data after external cleanup succeeded', {
        companyCode,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      await logActivity({
        userId: user.id,
        action: 'INSW_CLEANUP_PARTIAL_FAILED',
        description: `External INSW cleanup succeeded but local tracking-log cleanup failed for company code ${companyCode}`,
        status: 'failed',
        metadata: {
          companyCode,
          companyName: company.name,
          npwpConfigured: Boolean(inswConfig.npwp),
          external_result: externalResult.status,
          local_tracking_log_cleanup: 'failed',
        },
      });

      return NextResponse.json(
        {
          success: false,
          companyCode,
          companyName: company.name,
          error: {
            code: error instanceof INSWCleanupBusyError || error instanceof INSWCleanupResidualError
              ? error.code : includeQueue ? 'LOCAL_INSW_OPERATIONAL_CLEANUP_FAILED' : 'LOCAL_INSW_TRACKING_LOG_CLEANUP_FAILED',
            message: error instanceof INSWCleanupBusyError || error instanceof INSWCleanupResidualError
              ? `External INSW cleanup succeeded, but local data was preserved. ${error.message}`
              : includeQueue ? 'External INSW cleanup succeeded, but the local operational reset was rolled back. Review the server error before retrying.'
                : 'External INSW cleanup succeeded, but local tracking logs could not be deleted.',
          },
          externalINSWCleanup: {
            success: true,
            message: externalResult.message || 'External INSW temporary data cleaned successfully',
            result: externalResult,
          },
          ...(includeQueue ? { localQueueCleanup: { success: false, deletedRows: 0 } } : {}),
          localTrackingLogCleanup: {
            success: false,
            deletedRows: 0,
          },
          timestamp: new Date().toISOString(),
        },
        { status: error instanceof INSWCleanupBusyError ? 409 : 500 }
      );
    }

    // Log activity
    await logActivity({
      userId: user.id,
      action: 'INSW_CLEANUP_EXECUTED',
      description: `INSW temporary data and local tracking logs cleaned for company code ${companyCode}`,
      status: 'success',
      metadata: {
        companyCode,
        companyName: company.name,
        npwpConfigured: Boolean(inswConfig.npwp),
        external_result: externalResult.status,
        success_count: externalResult.success_count,
        failed_count: externalResult.failed_count,
        local_tracking_log_deleted_rows: deletedLocalTrackingLogRows,
        ...(localQueueCleanup ? { local_queue_cleanup: localQueueCleanup } : {}),
      },
    });

    logger.info('INSW cleanup executed successfully', {
      userId: user.id,
      companyCode,
      externalResult: externalResult.status,
      localTrackingLogDeletedRows: deletedLocalTrackingLogRows,
    });

    return NextResponse.json({
      success: true,
      companyCode,
      companyName: company.name,
      externalINSWCleanup: {
        success: true,
        message: externalResult.message || 'External INSW temporary data cleaned successfully',
        result: externalResult,
      },
      localTrackingLogCleanup: {
        success: true,
        deletedRows: deletedLocalTrackingLogRows,
      },
      ...(localQueueCleanup ? { localQueueCleanup: { success: true, ...localQueueCleanup } } : {}),
      message: localQueueCleanup ? 'INSW data, local tracking logs and operational queue data cleaned successfully'
        : 'INSW data and local tracking logs cleaned successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof INSWCleanupBusyError) {
      return inswCleanupErrorResponse(409, error.code, error.message);
    }
    if (error instanceof CleanupCompanyContextError) {
      return inswCleanupErrorResponse(error.status, error.code, error.message);
    }

    logger.error('Failed to execute INSW cleanup', {
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    return inswCleanupErrorResponse(
      500,
      'INSW_CLEANUP_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}
