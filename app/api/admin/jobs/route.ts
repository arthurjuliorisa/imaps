/**
 * Admin Jobs API Endpoint
 * Manage and monitor background jobs
 *
 * Endpoints:
 * - GET: View job history and status
 * - POST: Manually trigger jobs
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { scheduler } from '@/lib/jobs/scheduler';
import { JobType, JobStatus } from '@prisma/client';

/**
 * GET /api/admin/jobs
 * Get job history and scheduler status
 *
 * Query params:
 * - jobType: Filter by job type (optional)
 * - status: Filter by status (optional)
 * - limit: Number of records to return (default: 50, max: 200)
 * - offset: Pagination offset (default: 0)
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check authorization - Admin role required
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const jobTypeParam = searchParams.get('jobType');
    const statusParam = searchParams.get('status');
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');

    // Validate and parse limit
    const limit = Math.min(
      parseInt(limitParam || '50', 10),
      200
    );

    // Validate and parse offset
    const offset = parseInt(offsetParam || '0', 10);

    // Build where clause
    const where: any = {};

    if (jobTypeParam && Object.values(JobType).includes(jobTypeParam as JobType)) {
      where.job_type = jobTypeParam as JobType;
    }

    if (statusParam && Object.values(JobStatus).includes(statusParam as JobStatus)) {
      where.status = statusParam as JobStatus;
    }

    // Get total count
    const totalCount = await prisma.batch_processing_logs.count({ where });

    // Get job history
    const jobs = await prisma.batch_processing_logs.findMany({
      where,
      orderBy: {
        started_at: 'desc',
      },
      take: limit,
      skip: offset,
    });

    // Convert BigInt to string for JSON serialization
    const serializedJobs = jobs.map(job => ({
      ...job,
      id: job.id.toString(),
    }));

    // Get scheduler status
    const schedulerStatus = scheduler.getStatus();

    // Get job statistics
    const statistics = await getJobStatistics();

    return NextResponse.json({
      success: true,
      data: {
        jobs: serializedJobs,
        pagination: {
          total: totalCount,
          limit,
          offset,
          hasMore: offset + limit < totalCount,
        },
        schedulerStatus,
        statistics,
      },
    });
  } catch (error) {
    console.error('[Admin Jobs API] Error fetching job history:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to fetch job history';

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/jobs
 * Manually trigger a job or manage scheduler
 *
 * Request body:
 * - action: 'trigger' | 'start-scheduler' | 'stop-scheduler' | 'add-recalc-queue'
 * - jobType: 'hourly-batch' | 'eod-snapshot' | 'recalc-queue' (for trigger action)
 * - companyCode: string (for add-recalc-queue action)
 * - recalcDate: string (ISO date, for add-recalc-queue action)
 * - reason: string (for add-recalc-queue action)
 * - priority: number (optional, for add-recalc-queue action)
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check authorization - Admin role required
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { action, jobType, companyCode, recalcDate, reason, priority } = body;

    // Validate action
    if (!action) {
      return NextResponse.json(
        { error: 'Action is required' },
        { status: 400 }
      );
    }

    const triggeredBy = session.user.email || session.user.name || 'ADMIN';

    switch (action) {
      case 'trigger': {
        // Validate job type
        if (!jobType || !['hourly-batch', 'eod-snapshot', 'recalc-queue'].includes(jobType)) {
          return NextResponse.json(
            { error: 'Invalid job type' },
            { status: 400 }
          );
        }

        console.log(`[Admin Jobs API] Triggering ${jobType} by ${triggeredBy}`);

        // Trigger the job
        const result = await scheduler.triggerJob(jobType, triggeredBy);

        return NextResponse.json({
          success: result.success,
          message: result.success
            ? `Job ${jobType} completed successfully`
            : `Job ${jobType} failed`,
          data: result,
        });
      }

      case 'start-scheduler': {
        console.log(`[Admin Jobs API] Starting scheduler by ${triggeredBy}`);
        scheduler.start();

        return NextResponse.json({
          success: true,
          message: 'Scheduler started successfully',
          data: scheduler.getStatus(),
        });
      }

      case 'stop-scheduler': {
        console.log(`[Admin Jobs API] Stopping scheduler by ${triggeredBy}`);
        scheduler.stop();

        return NextResponse.json({
          success: true,
          message: 'Scheduler stopped successfully',
          data: scheduler.getStatus(),
        });
      }

      case 'add-recalc-queue': {
        // Validate required fields
        if (!companyCode || !recalcDate || !reason) {
          return NextResponse.json(
            { error: 'companyCode, recalcDate, and reason are required' },
            { status: 400 }
          );
        }

        // Validate date format
        const date = new Date(recalcDate);
        if (isNaN(date.getTime())) {
          return NextResponse.json(
            { error: 'Invalid date format' },
            { status: 400 }
          );
        }

        // Normalize date to midnight UTC
        date.setUTCHours(0, 0, 0, 0);

        // Add to recalculation queue
        const queueItem = await prisma.snapshot_recalc_queue.create({
          data: {
            company_code: companyCode,
            recalc_date: date,
            reason,
            priority: priority || 0,
          },
        });

        console.log(
          `[Admin Jobs API] Added recalc queue item for ${companyCode} on ${date.toISOString().split('T')[0]} by ${triggeredBy}`
        );

        return NextResponse.json({
          success: true,
          message: 'Recalculation queued successfully',
          data: {
            ...queueItem,
            id: queueItem.id.toString(),
          },
        });
      }

      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error('[Admin Jobs API] Error processing request:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to process request';

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * Get job statistics
 */
async function getJobStatistics() {
  try {
    // Get counts by job type and status
    const stats = await prisma.batch_processing_logs.groupBy({
      by: ['job_type', 'status'],
      _count: {
        id: true,
      },
    });

    // Get recent job performance (last 24 hours)
    const last24Hours = new Date();
    last24Hours.setHours(last24Hours.getHours() - 24);

    const recentJobs = await prisma.batch_processing_logs.findMany({
      where: {
        started_at: {
          gte: last24Hours,
        },
      },
      select: {
        job_type: true,
        status: true,
        started_at: true,
        completed_at: true,
        successful_records: true,
        failed_records: true,
      },
    });

    // Calculate average duration by job type
    const durationsByType: Record<string, number[]> = {};

    recentJobs.forEach(job => {
      if (job.completed_at && job.status === JobStatus.COMPLETED) {
        const duration = job.completed_at.getTime() - job.started_at.getTime();
        if (!durationsByType[job.job_type]) {
          durationsByType[job.job_type] = [];
        }
        durationsByType[job.job_type].push(duration);
      }
    });

    const averageDurations: Record<string, number> = {};
    Object.keys(durationsByType).forEach(jobType => {
      const durations = durationsByType[jobType];
      const avg = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      averageDurations[jobType] = Math.round(avg / 1000); // Convert to seconds
    });

    // Get last successful run for each job type
    const lastSuccessfulRuns: Record<string, Date | null> = {};

    for (const jobType of Object.values(JobType)) {
      const lastJob = await prisma.batch_processing_logs.findFirst({
        where: {
          job_type: jobType,
          status: JobStatus.COMPLETED,
        },
        orderBy: {
          completed_at: 'desc',
        },
        select: {
          completed_at: true,
        },
      });

      lastSuccessfulRuns[jobType] = lastJob?.completed_at || null;
    }

    // Get pending recalc queue count
    const pendingRecalcCount = await prisma.snapshot_recalc_queue.count({
      where: {
        status: 'PENDING',
      },
    });

    return {
      statsByTypeAndStatus: stats.map(stat => ({
        ...stat,
        _count: stat._count,
      })),
      averageDurations,
      lastSuccessfulRuns,
      pendingRecalcQueueItems: pendingRecalcCount,
      last24Hours: {
        totalJobs: recentJobs.length,
        completed: recentJobs.filter(j => j.status === JobStatus.COMPLETED).length,
        failed: recentJobs.filter(j => j.status === JobStatus.FAILED).length,
        running: recentJobs.filter(j => j.status === JobStatus.RUNNING).length,
      },
    };
  } catch (error) {
    console.error('[Admin Jobs API] Error calculating statistics:', error);
    return null;
  }
}

/**
 * DELETE /api/admin/jobs
 * Clear old job logs (optional maintenance endpoint)
 *
 * Query params:
 * - olderThan: Number of days to keep (default: 90)
 */
export async function DELETE(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session || !session.user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Check authorization - Admin role required
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Forbidden - Admin access required' },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const olderThanDays = parseInt(searchParams.get('olderThan') || '90', 10);

    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    // Delete old logs
    const result = await prisma.batch_processing_logs.deleteMany({
      where: {
        started_at: {
          lt: cutoffDate,
        },
        status: {
          in: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED],
        },
      },
    });

    console.log(
      `[Admin Jobs API] Deleted ${result.count} job logs older than ${olderThanDays} days`
    );

    return NextResponse.json({
      success: true,
      message: `Deleted ${result.count} job logs`,
      data: {
        deletedCount: result.count,
        cutoffDate: cutoffDate.toISOString(),
      },
    });
  } catch (error) {
    console.error('[Admin Jobs API] Error deleting job logs:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to delete job logs';

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
