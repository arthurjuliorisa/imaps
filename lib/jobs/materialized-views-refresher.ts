/**
 * Materialized Views Refresher
 * Refreshes all 7 materialized views used for Indonesian customs compliance reporting
 *
 * Job Schedule: Runs daily at 00:30 (after EOD snapshot completes)
 * Purpose: Keep materialized views up-to-date with latest snapshot data
 */

import { prisma } from '@/lib/prisma';
import { JobType, JobStatus } from '@prisma/client';

interface RefreshResult {
  success: boolean;
  processedRecords: number;
  failedRecords: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}

interface ViewRefreshResult {
  view: string;
  status: 'success' | 'error';
  rowCount?: number;
  duration: number;
  error?: string;
}

// List of all materialized views in order
const MATERIALIZED_VIEWS = [
  'mv_laporan_pemasukan',
  'mv_laporan_pengeluaran',
  'mv_mutasi_bahan_baku',
  'mv_posisi_wip',
  'mv_mutasi_finished_goods',
  'mv_mutasi_capital_goods',
  'mv_mutasi_scrap',
] as const;

type MaterializedView = typeof MATERIALIZED_VIEWS[number];

/**
 * Main materialized views refresher function
 * Refreshes all 7 views and updates statistics
 */
export async function refreshMaterializedViews(triggeredBy?: string): Promise<RefreshResult> {
  const jobId = await createJobLog(triggeredBy);
  const startTime = new Date();

  try {
    console.log('[MV Refresher] Starting materialized views refresh...');

    // Update job status to RUNNING
    await updateJobStatus(jobId, JobStatus.RUNNING, {
      viewsToRefresh: MATERIALIZED_VIEWS.length,
      viewNames: [...MATERIALIZED_VIEWS],
    });

    const results: ViewRefreshResult[] = [];

    // Refresh each materialized view sequentially
    for (const viewName of MATERIALIZED_VIEWS) {
      console.log(`[MV Refresher] Refreshing view: ${viewName}`);
      const result = await refreshView(viewName);
      results.push(result);

      console.log(
        `[MV Refresher] ${result.view}: ${result.status} - ${result.rowCount ?? 0} rows in ${result.duration}ms`
      );
    }

    // Analyze views for query optimization
    console.log('[MV Refresher] Running ANALYZE on all views...');
    await analyzeViews();

    // Calculate statistics
    const totalDuration = Date.now() - startTime.getTime();
    const processedRecords = results.filter(r => r.status === 'success').length;
    const failedRecords = results.filter(r => r.status === 'error').length;
    const totalRows = results.reduce((sum, r) => sum + (r.rowCount ?? 0), 0);

    // Complete job successfully
    await completeJobLog(jobId, processedRecords, failedRecords, {
      duration: totalDuration,
      totalRows,
      results: results.map(r => ({
        view: r.view,
        status: r.status,
        rowCount: r.rowCount,
        duration: r.duration,
      })),
    });

    console.log(
      `[MV Refresher] Completed. ${processedRecords} views refreshed successfully, ${failedRecords} failed, ${totalRows} total rows`
    );

    return {
      success: failedRecords === 0,
      processedRecords,
      failedRecords,
      metadata: {
        duration: totalDuration,
        totalRows,
        results,
      },
    };
  } catch (error) {
    console.error('[MV Refresher] Fatal error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await failJobLog(jobId, errorMessage, {
      error: error instanceof Error ? error.stack : String(error),
    });

    return {
      success: false,
      processedRecords: 0,
      failedRecords: MATERIALIZED_VIEWS.length,
      errorMessage,
    };
  }
}

/**
 * Refresh a single materialized view concurrently
 */
async function refreshView(viewName: MaterializedView): Promise<ViewRefreshResult> {
  const startTime = Date.now();

  try {
    // Refresh the materialized view concurrently
    // CONCURRENTLY allows reads during refresh but requires unique index
    await prisma.$executeRawUnsafe(
      `REFRESH MATERIALIZED VIEW CONCURRENTLY ${viewName}`
    );

    // Get row count after refresh
    const countResult = await prisma.$queryRawUnsafe<[{ count: bigint }]>(
      `SELECT COUNT(*) as count FROM ${viewName}`
    );

    const rowCount = Number(countResult[0]?.count ?? 0);
    const duration = Date.now() - startTime;

    return {
      view: viewName,
      status: 'success',
      rowCount,
      duration,
    };
  } catch (error) {
    const duration = Date.now() - startTime;

    return {
      view: viewName,
      status: 'error',
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Analyze all materialized views for query optimization
 */
async function analyzeViews(): Promise<void> {
  for (const viewName of MATERIALIZED_VIEWS) {
    await prisma.$executeRawUnsafe(`ANALYZE ${viewName}`);
  }
}

/**
 * Create a new job log entry
 */
async function createJobLog(triggeredBy?: string): Promise<string> {
  const log = await prisma.batch_processing_logs.create({
    data: {
      job_type: JobType.MANUAL_TRIGGER,
      status: JobStatus.PENDING,
      updated_at: new Date(),
    },
  });
  return log.id;
}

/**
 * Update job status
 */
async function updateJobStatus(
  jobId: string,
  status: JobStatus,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.batch_processing_logs.update({
    where: { id: jobId },
    data: {
      status,
      updated_at: new Date(),
    },
  });
}

/**
 * Complete job successfully
 */
async function completeJobLog(
  jobId: string,
  processedRecords: number,
  failedRecords: number,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.batch_processing_logs.update({
    where: { id: jobId },
    data: {
      status: JobStatus.COMPLETED,
      completed_at: new Date(),
      total_records: processedRecords + failedRecords,
      successful_records: processedRecords,
      failed_records: failedRecords,
      updated_at: new Date(),
    },
  });
}

/**
 * Mark job as failed
 */
async function failJobLog(
  jobId: string,
  errorMessage: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.batch_processing_logs.update({
    where: { id: jobId },
    data: {
      status: JobStatus.FAILED,
      completed_at: new Date(),
      error_message: errorMessage,
      updated_at: new Date(),
    },
  });
}
