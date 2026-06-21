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
export async function POST(_request: NextRequest) {
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
    try {
      deletedLocalTrackingLogRows = await deleteINSWTrackingLogsForCompany(companyCode);
    } catch (error) {
      logger.error('Failed to delete local INSW tracking logs after external cleanup succeeded', {
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
            code: 'LOCAL_INSW_TRACKING_LOG_CLEANUP_FAILED',
            message: 'External INSW cleanup succeeded, but local tracking logs could not be deleted.',
          },
          externalINSWCleanup: {
            success: true,
            message: externalResult.message || 'External INSW temporary data cleaned successfully',
            result: externalResult,
          },
          localTrackingLogCleanup: {
            success: false,
            deletedRows: 0,
          },
          timestamp: new Date().toISOString(),
        },
        { status: 500 }
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
      message: 'INSW data and local tracking logs cleaned successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
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
