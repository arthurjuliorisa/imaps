/**
 * API Route: Admin - Database Cleanup
 * POST /api/admin/cleanup - Execute database cleanup (selective or full reset)
 */

import { NextRequest, NextResponse } from 'next/server';
import { compare } from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { CleanupValidationService } from '@/lib/cleanup/validation-service';
import { BackupService, logBackupActivity, BackupResult } from '@/lib/cleanup/backup-service';
import {
  CLEANUP_TABLES,
  getFullResetTables,
  getCleanupEligibility,
  getTableById,
  getUnsupportedCleanupTables,
} from '@/lib/cleanup/table-config';
import { logActivity } from '@/lib/log-activity';
import {
  deleteRowsForCompany,
  validateCleanupTableScopes,
  CleanupScopeError,
} from '@/lib/cleanup/company-scoped-cleanup.service';
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
 * Detect environment phase (dev/staging/production)
 * Uses 4-layer strategy: ENV_VAR -> NODE_ENV -> DB_FLAG -> DEFAULT_PROD
 * 
 * IMPORTANT: Only 'development' and 'staging' allow cleanup API access
 * 'production' blocks all cleanup operations (safest default)
 * 
 * Configuration Guide: See ENVIRONMENT_PHASE_CONFIG.md for setup instructions
 * - Local dev: Set NEXT_PUBLIC_ENVIRONMENT_PHASE=development in .env
 * - Staging: Set NEXT_PUBLIC_ENVIRONMENT_PHASE=staging in .env
 * - Production: Leave unset or set to 'production' (will default safely)
 * 
 * PM2 Setup: ecosystem.config.js automatically reads from .env file
 */
function detectEnvironmentPhase(): 'development' | 'staging' | 'production' {
  // Layer 1: Explicit environment variable
  const envPhase = process.env.NEXT_PUBLIC_ENVIRONMENT_PHASE;
  if (envPhase === 'development' || envPhase === 'staging') {
    return envPhase;
  }

  // Layer 2: NODE_ENV
  if (process.env.NODE_ENV === 'development') {
    return 'development';
  }

  // Layer 3: Database feature flag (if implemented)
  const dbPhase = process.env.DATABASE_PHASE;
  if (dbPhase === 'development' || dbPhase === 'staging') {
    return dbPhase;
  }

  // Layer 4: Secure default to PRODUCTION
  logger.warn('Could not detect environment phase, defaulting to PRODUCTION');
  return 'production';
}

/**
 * Rate limiter: max 5 cleanups per day per admin user
 */
async function checkRateLimit(userId: string): Promise<boolean> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const recentCleanups = await prisma.activity_logs.count({
    where: {
      user_id: userId,
      action: 'DATABASE_CLEANUP_EXECUTED',
      created_at: {
        gte: twentyFourHoursAgo,
      },
    },
  });

  return recentCleanups < 5;
}

/**
 * Validate password (admin user must re-confirm with password)
 */
async function validatePassword(
  userId: string,
  providedPassword: string
): Promise<boolean> {
  const user = await prisma.users.findUnique({
    where: { id: userId },
    select: { password: true },
  });

  if (!user?.password) {
    return false;
  }

  return compare(providedPassword, user.password);
}

/**
 * Execute cleanup with async progress reporting
 */
async function executeCleanup(
  tableIds: string[],
  backupId: string,
  userId: string,
  companyCode: number,
  onProgress: (data: any) => void
): Promise<void> {
  validateCleanupTableScopes(tableIds);
  const batches = CleanupValidationService.calculateOptimalDeleteOrder(tableIds);
  
  let totalDeleted = 0;
  const startTime = Date.now();

  try {
    await prisma.$transaction(async (tx) => {
      // Execute deletion in batches inside one transaction so any failure rolls back.
      for (let phaseNum = 1; phaseNum <= 7; phaseNum++) {
        const tablesInPhase = batches
          .flat()
          .filter(
            (tableId: string) =>
              CLEANUP_TABLES.find((t) => t.id === tableId)?.phase === phaseNum
          );

        const phaseTableIds = tablesInPhase || [];

        if (phaseTableIds.length === 0) continue;

        onProgress({
          progress: {
            phase: phaseNum,
            phase_name: `Phase ${phaseNum}`,
            tables_total: phaseTableIds.length,
            tables_completed: 0,
            current_table: '',
            rows_deleted: totalDeleted,
            status: 'in_progress',
            message: `Starting Phase ${phaseNum} for company ${companyCode}...`
          }
        });

        for (let i = 0; i < phaseTableIds.length; i++) {
          const tableId = phaseTableIds[i];
          const table = CLEANUP_TABLES.find((t) => t.id === tableId);

          if (!table) continue;

          onProgress({
            progress: {
              phase: phaseNum,
              phase_name: `Phase ${phaseNum}`,
              tables_total: phaseTableIds.length,
              tables_completed: i,
              current_table: table.name,
              rows_deleted: totalDeleted,
              status: 'in_progress',
              message: `Deleting company-scoped rows from ${table.displayName}...`
            }
          });

          try {
            const deleted: number = await deleteRowsForCompany(table.id, companyCode, tx);
            totalDeleted += deleted;

            onProgress({
              progress: {
                phase: phaseNum,
                phase_name: `Phase ${phaseNum}`,
                tables_total: phaseTableIds.length,
                tables_completed: i + 1,
                current_table: table.name,
                rows_deleted: totalDeleted,
                status: 'in_progress',
                message: `Deleted ${deleted} company-scoped rows from ${table.displayName}`
              }
            });
          } catch (error) {
            logger.error(`Company-scoped delete failed for ${table.name}`, {
              companyCode,
              errorMessage: error instanceof Error ? error.message : String(error)
            });
            onProgress({
              progress: {
                phase: phaseNum,
                phase_name: `Phase ${phaseNum}`,
                tables_total: phaseTableIds.length,
                tables_completed: i + 1,
                current_table: table.name,
                rows_deleted: totalDeleted,
                status: 'error',
                message: `Error deleting from ${table.displayName}: ${error instanceof Error ? error.message : 'Unknown error'}`
              }
            });
            throw error;
          }
        }
      }
    }, { timeout: 120000, maxWait: 10000 });

    const duration = Date.now() - startTime;

    // Log successful cleanup
    await logActivity({
      action: 'DATABASE_CLEANUP_EXECUTED',
      description: `Database cleanup completed: ${tableIds.length} table(s), ${totalDeleted} row(s) deleted`,
      userId: userId,
      metadata: {
        backup_id: backupId,
        table_count: tableIds.length,
        total_rows_deleted: totalDeleted,
        duration_ms: duration,
        company_code: companyCode,
      },
    });

    if (!backupId.startsWith('no-backup-')) {
      await logBackupActivity('CLEANUP_SUCCESS', backupId, {
        table_count: tableIds.length,
        total_rows_deleted: totalDeleted,
        duration_ms: duration
      });
    }

    onProgress({
      progress: {
        phase: 7,
        phase_name: 'Cleanup Complete',
        tables_total: tableIds.length,
        tables_completed: tableIds.length,
        current_table: '',
        rows_deleted: totalDeleted,
        status: 'completed',
        message: `Cleanup completed: ${totalDeleted} rows deleted in ${(duration / 1000).toFixed(2)}s`
      },
      backup_id: backupId,
      summary: {
        total_rows_deleted: totalDeleted,
        total_tables: tableIds.length,
        duration_seconds: (duration / 1000).toFixed(2)
      }
    });
  } catch (error) {
    logger.error('Cleanup execution failed', {
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    // Log failed cleanup
    await logActivity({
      action: 'DATABASE_CLEANUP_FAILED',
      description: `Database cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      userId: userId,
      metadata: {
        backup_id: backupId,
        error_message: error instanceof Error ? error.message : 'Unknown error',
        rows_deleted_before_failure: totalDeleted,
        company_code: companyCode,
      },
    });

    onProgress({
      progress: {
        phase: 0,
        phase_name: 'Failed',
        tables_total: 0,
        tables_completed: 0,
        current_table: '',
        rows_deleted: totalDeleted,
        status: 'error',
        message: `Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      },
      backup_id: backupId,
      error: true
    });
  }
}

/**
 * Handler: POST /api/admin/cleanup
 */
export async function POST(request: NextRequest) {
  try {
    // 1. Environment Check
    const phase = detectEnvironmentPhase();
    if (phase === 'production') {
      logger.warn('Cleanup attempted in PRODUCTION environment - BLOCKED');
      return cleanupErrorResponse(
        403,
        'CLEANUP_NOT_ALLOWED_IN_PRODUCTION',
        'Database cleanup is not available in production environment'
      );
    }

    // 2-3. Authentication, admin role, and company scope validation
    const cleanupContext = await resolveCleanupCompanyContext();
    const { user, companyCode } = cleanupContext;

    // 4. Rate Limiting Check
    const withinRateLimit = await checkRateLimit(user.id);
    if (!withinRateLimit) {
      logger.warn(`Rate limit exceeded for user: ${user.id}`);
      return NextResponse.json(
        {
          error: 'Too Many Requests',
          message: 'Maximum 5 cleanups per 24 hours'
        },
        { status: 429 }
      );
    }

    // 5. Parse Request
    const body = await request.json();
    const { tableIds, password, mode = 'selective', createBackup = true, backupLocation = './backups' } = body;

    if (!password) {
      return cleanupErrorResponse(400, 'INVALID_PASSWORD', 'Password confirmation required');
    }

    // 6. Password Validation
    const passwordValid = await validatePassword(user.id, password);
    if (!passwordValid) {
      logger.warn(`Cleanup attempted with invalid password by user: ${user.id}`);

      await logActivity({
        action: 'DATABASE_CLEANUP_AUTH_FAILED',
        description: 'Cleanup attempted with invalid password',
        userId: user.id,
        metadata: { email: user.email, company_code: companyCode }
      });

      return cleanupErrorResponse(401, 'INVALID_PASSWORD', 'Invalid password');
    }

    // 7. Determine tables to cleanup
    let tablesToClean: string[];

    if (mode === 'full') {
      // Full reset: all cleanup-supported company-scoped tables.
      // Unsupported/shared tables remain visible in GET metadata but are skipped.
      tablesToClean = getFullResetTables().map((t) => t.id);
      logger.info('Full cleanup table list derived from company-scoped tables', {
        companyCode,
        tableCount: tablesToClean.length,
        skippedUnsupportedTables: getUnsupportedCleanupTables().map((table) => table.id),
      });
    } else {
      // Selective: validate provided table IDs
      if (!Array.isArray(tableIds) || tableIds.length === 0) {
        return cleanupErrorResponse(400, 'INVALID_CLEANUP_SELECTION', 'Table IDs required');
      }

      tablesToClean = tableIds;

      // Validate each table ID
      const errors = CleanupValidationService.validateSelection(tablesToClean);

      if (errors.length > 0) {
        return cleanupErrorResponse(
          400,
          'INVALID_CLEANUP_SELECTION',
          'Invalid table selection',
          { validationErrors: errors, companyCode }
        );
      }
    }

    try {
      validateCleanupTableScopes(tablesToClean, mode === 'full' ? 'fullReset' : 'selectiveCleanup');
    } catch (error) {
      if (error instanceof CleanupScopeError) {
        return cleanupErrorResponse(
          error.status,
          cleanupScopeErrorCode(error),
          error.message,
          { tableId: error.tableId, companyCode, validationStage: 'pre_validation' }
        );
      }
      throw error;
    }

    // 8. Create Backup (if enabled)
    let backupResult: BackupResult = { success: true, backupId: 'no-backup-' + Date.now(), filename: 'N/A' };
    
    if (createBackup) {
      backupResult = await BackupService.createBackup(
        companyCode,
        tablesToClean.map((id) => CLEANUP_TABLES.find((t) => t.id === id)?.name || id),
        backupLocation
      );

      if (!backupResult.success) {
        logger.error('Backup creation failed', {
          errorMessage: backupResult.error || 'Unknown error',
        });

        await logActivity({
          action: 'DATABASE_BACKUP_FAILED',
          description: `Backup failed: ${backupResult.error || 'Unknown error'}`,
          userId: user.id,
          metadata: { table_count: tablesToClean.length, backupLocation, company_code: companyCode }
        });

        return cleanupErrorResponse(500, 'CLEANUP_EXECUTION_FAILED', 'Failed to create backup');
      }
    } else {
      logger.info('Backup skipped by user');
    }

    if (createBackup) {
      await logBackupActivity('CREATED', backupResult.backupId, {
        table_count: tablesToClean.length,
        user_id: user.id,
        company_code: companyCode,
        backup_location: backupLocation
      });
    }

    // 9. Execute Cleanup with SSE
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController<Uint8Array>;

    const customResponse = new NextResponse(
      new ReadableStream<Uint8Array>({
        async start(ctrl) {
          controller = ctrl;
          
          // Send initial message
          const initialData = {
            status: 'started',
            backup_id: backupResult.backupId,
            message: 'Cleanup started...'
          };
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(initialData)}\n\n`)
          );

          // Execute cleanup asynchronously
          try {
            await executeCleanup(
              tablesToClean,
              backupResult.backupId,
              user.id,
              companyCode,
              (data: any) => {
                if (controller) {
                  controller.enqueue(
                    encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
                  );
                }
              }
            );
            controller.close();
          } catch (error) {
            logger.error('Async cleanup execution error:', {
              errorMessage: error instanceof Error ? error.message : String(error)
            });
            if (controller) {
              controller.close();
            }
          }
        }
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      }
    );

    return customResponse;
  } catch (error) {
    if (error instanceof CleanupCompanyContextError) {
      return cleanupErrorResponse(error.status, error.code, error.message);
    }

    logger.error('Cleanup API error', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return cleanupErrorResponse(
      500,
      'CLEANUP_EXECUTION_FAILED',
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

/**
 * Handler: GET /api/admin/cleanup
 * Get cleanup status and available tables
 */
export async function GET(request: NextRequest) {
  try {
    await resolveCleanupCompanyContext();

    const phase = detectEnvironmentPhase();
    const available = phase !== 'production';

    return NextResponse.json({
      phase,
      available,
      tables: CLEANUP_TABLES.map((table) => ({
        id: table.id,
        name: table.name,
        displayName: table.displayName,
        phase: table.phase,
        dependents: (table.dependentTables || []).length > 0,
        disabled: !getCleanupEligibility(table).selectiveCleanup,
        reason:
          getCleanupEligibility(table).exclusionReason ||
          (table.companyScope.type === 'unsupported' ? table.companyScope.reason : table.reason),
        fullReset: getCleanupEligibility(table).fullReset,
        selectiveCleanup: getCleanupEligibility(table).selectiveCleanup,
        dedicatedFeature: getCleanupEligibility(table).dedicatedFeature,
        retainedHistory: getCleanupEligibility(table).retainedHistory,
        skippedInFullReset: !getCleanupEligibility(table).fullReset,
      }))
    });
  } catch (error) {
    if (error instanceof CleanupCompanyContextError) {
      return cleanupErrorResponse(error.status, error.code, error.message);
    }

    logger.error('Failed to get cleanup status', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return cleanupErrorResponse(500, 'CLEANUP_EXECUTION_FAILED', 'Failed to get cleanup status');
  }
}
