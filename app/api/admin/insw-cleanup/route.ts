/**
 * API Route: Admin - INSW Cleanup
 * POST /api/admin/insw-cleanup - Clean up temporary transaction data from INSW (test mode only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/utils/logger';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { logActivity } from '@/lib/log-activity';

/**
 * Handler: POST /api/admin/insw-cleanup
 * Clean up temporary INSW transaction data
 * 
 * Request Body:
 * - companyCode: number (required)
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authentication
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Verify admin role
    const user = await prisma.users.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true }
    });

    if (user?.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    // Check if test mode is enabled
    const isTestMode = process.env.INSW_USE_TEST_MODE === 'true';
    if (!isTestMode) {
      return NextResponse.json(
        {
          error: 'Feature Unavailable',
          message: 'INSW cleanup is only available in test mode (INSW_USE_TEST_MODE=true)'
        },
        { status: 403 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { companyCode } = body;

    if (!companyCode) {
      return NextResponse.json(
        { error: 'Bad Request', message: 'companyCode is required' },
        { status: 400 }
      );
    }

    // Get NPWP from environment
    const npwp = process.env.INSW_NPWP;
    if (!npwp) {
      logger.error('INSW_NPWP not configured in environment');
      return NextResponse.json(
        {
          error: 'Internal Server Error',
          message: 'INSW configuration is incomplete'
        },
        { status: 500 }
      );
    }

    // Execute cleanup
    const inswService = new INSWTransmissionService(isTestMode);
    const result = await inswService.cleanupINSWData(companyCode, npwp);

    // Log activity
    await logActivity({
      userId: user.id,
      action: 'INSW_CLEANUP_EXECUTED',
      description: `INSW temporary data cleanup executed for company code ${companyCode} with NPWP ${npwp}`,
      status: result.status === 'success' ? 'success' : 'failed',
      metadata: {
        companyCode,
        npwp,
        result: result.status,
        success_count: result.success_count,
        failed_count: result.failed_count,
      },
    });

    logger.info('INSW cleanup executed successfully', {
      userId: user.id,
      companyCode,
      result: result.status,
    });

    return NextResponse.json({
      success: result.status === 'success',
      ...result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to execute INSW cleanup', {
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    return NextResponse.json(
      {
        error: 'Internal Server Error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
