/**
 * API Route: Admin - Cron Service Management
 * POST /api/admin/cron/initialize - Initialize cron service
 * GET /api/admin/cron/status - Get cron service status
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { initializeCronService, getCronService } from '@/lib/services/cron.service';
import { logger } from '@/lib/utils/logger';

/**
 * POST /api/admin/cron/initialize
 * Initialize cron service (idempotent)
 * Internal endpoint - called from server-side initialization
 * No auth required as this is maintenance task
 */
export async function POST(request: NextRequest) {
  try {
    logger.info('🔄 Initializing cron service via API...');
    await initializeCronService();

    return NextResponse.json(
      {
        success: true,
        message: 'Cron service initialized successfully',
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Failed to initialize cron service', {
      errorName: error instanceof Error ? error.name : 'Unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to initialize cron service',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/cron/status
 * Get cron service status
 * Requires authentication - user must be logged in
 */
export async function GET(request: NextRequest) {
  try {
    // Check authentication (user must be logged in to view status)
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized - authentication required' },
        { status: 401 }
      );
    }

    const cronService = getCronService();
    const status = cronService.getStatus();

    return NextResponse.json(
      {
        success: true,
        status,
        timestamp: new Date().toISOString(),
        jobs: {
          'process-recalc-queue': {
            schedule: '*/15 * * * *',
            description: 'Process pending recalculation queue items',
            interval: '15 minutes',
          },
          'calculate-daily-snapshots': {
            schedule: '5 0 * * *',
            description: 'Calculate daily stock snapshots for all companies',
            interval: 'Daily at 00:05 UTC',
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error('Failed to get cron service status', {
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to get cron service status',
      },
      { status: 500 }
    );
  }
}
