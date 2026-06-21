/**
 * API Route: Admin - Get Row Counts
 * POST /api/admin/cleanup/row-counts - Get row counts for specified tables
 */

import { NextRequest, NextResponse } from 'next/server';
import { logger } from '@/lib/utils/logger';
import {
  countRowsForCompany,
  validateCleanupTableScopes,
  CleanupScopeError,
} from '@/lib/cleanup/company-scoped-cleanup.service';
import { getTableById } from '@/lib/cleanup/table-config';
import {
  resolveCleanupCompanyContext,
  CleanupCompanyContextError,
} from '@/lib/cleanup/cleanup-company-context';

function cleanupErrorResponse(
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

function cleanupScopeErrorCode(error: CleanupScopeError): string {
  const table = error.tableId ? getTableById(error.tableId) : undefined;
  return table?.companyScope.type === 'unsupported'
    ? 'UNSUPPORTED_CLEANUP_TABLE'
    : 'INVALID_CLEANUP_SELECTION';
}

/**
 * Handler: POST /api/admin/cleanup/row-counts
 * Get row count for each specified table
 */
export async function POST(request: NextRequest) {
  try {
    const { companyCode } = await resolveCleanupCompanyContext();

    // Parse request body
    const body = await request.json();
    const { tableIds } = body;

    if (!Array.isArray(tableIds) || tableIds.length === 0) {
      return cleanupErrorResponse(400, 'INVALID_CLEANUP_SELECTION', 'Table IDs array required');
    }

    try {
      validateCleanupTableScopes(tableIds, 'selectiveCleanup');
    } catch (error) {
      if (error instanceof CleanupScopeError) {
        return cleanupErrorResponse(
          error.status,
          cleanupScopeErrorCode(error),
          error.message,
          { tableId: error.tableId, companyCode, validationStage: 'row_count_pre_validation' }
        );
      }
      throw error;
    }

    // Get company-scoped row counts for each table
    const rowCounts: Record<string, number> = {};

    for (const tableId of tableIds) {
      try {
        rowCounts[tableId] = await countRowsForCompany(tableId, companyCode);
      } catch (error) {
        if (error instanceof CleanupScopeError) {
          return cleanupErrorResponse(
            error.status,
            cleanupScopeErrorCode(error),
            error.message,
            { tableId: error.tableId, companyCode, validationStage: 'row_count' }
          );
        }

        logger.error(`Failed to get company-scoped row count for ${tableId}`, {
          companyCode,
          errorMessage: error instanceof Error ? error.message : String(error)
        });
        rowCounts[tableId] = 0;
      }
    }

    return NextResponse.json({
      success: true,
      rowCounts,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    if (error instanceof CleanupCompanyContextError) {
      return cleanupErrorResponse(error.status, error.code, error.message);
    }

    logger.error('Failed to get row counts', {
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    return cleanupErrorResponse(
      500,
      'CLEANUP_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}
