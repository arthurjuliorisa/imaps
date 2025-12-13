/**
 * WMS API - WIP Balance Transactions (v2.4.2)
 *
 * Handles WIP (HALB) balance snapshots
 * Uses snapshot-based calculation method (not cumulative)
 * Implements the WMS-iMAPS API Contract v2.4.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
import type {
  WIPBalanceRequest,
  ApiSuccessResponse,
  ApiErrorResponse,
  TransactionSubmissionResponse,
  PaginatedResponse,
  WIPBalanceHeader
} from '@/types/v2.4.2';
import { ItemTypeCode } from '@/types/v2.4.2';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate WIP balance transaction request
 */
function validateWIPBalanceTransaction(data: WIPBalanceRequest): void {
  const { header, details } = data;

  // Validate header
  if (!header.wms_id || !header.company_code || !header.trx_date) {
    throw new Error('Missing required header fields: wms_id, company_code, trx_date');
  }

  // Validate details
  if (!details || details.length === 0) {
    throw new Error('At least one detail item is required');
  }

  details.forEach((detail, index) => {
    if (!detail.wms_id || !detail.item_code || !detail.item_name) {
      throw new Error(`Detail ${index + 1}: Missing required fields`);
    }

    if (!detail.item_type_code || !detail.uom || detail.qty === undefined) {
      throw new Error(`Detail ${index + 1}: Missing item_type_code, uom, or qty`);
    }

    // v2.4.2: Only HALB items allowed in WIP balance
    if (detail.item_type_code !== ItemTypeCode.HALB) {
      throw new Error(`Detail ${index + 1}: Only HALB items are allowed in WIP balance snapshots`);
    }

    if (!detail.work_order_number || detail.work_order_number.trim() === '') {
      throw new Error(`Detail ${index + 1}: work_order_number is required`);
    }

    if (detail.qty < 0) {
      throw new Error(`Detail ${index + 1}: qty cannot be negative (use 0 for empty WIP)`);
    }
  });
}

/**
 * Build error response
 */
function errorResponse(message: string, code = 'VALIDATION_ERROR', status = 400): NextResponse<ApiErrorResponse> {
  return NextResponse.json<ApiErrorResponse>(
    {
      success: false,
      error: code,
      message,
      timestamp: new Date().toISOString()
    },
    { status }
  );
}

/**
 * Build success response
 */
function successResponse<T>(data: T, status = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json<ApiSuccessResponse<T>>(
    {
      success: true,
      data,
      timestamp: new Date().toISOString()
    },
    { status }
  );
}

// ============================================================================
// GET - List WIP balance transactions
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('page_size') || '20');
    const companyCode = searchParams.get('company_code');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const search = searchParams.get('search');

    // Build where clause
    const where: any = {};

    if (companyCode) {
      where.company_code = companyCode;
    }

    if (startDate && endDate) {
      where.snapshot_date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (search) {
      where.OR = [
        { wms_id: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const totalRecords = await prisma.wip_balance.count({ where });

    // Get paginated data
    const skip = (page - 1) * pageSize;
    const wipBalances = await prisma.wip_balance.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { snapshot_date: 'desc' }
    });

    // Build response
    const response: PaginatedResponse<WIPBalanceHeader> = {
      data: wipBalances as any,
      pagination: {
        page,
        page_size: pageSize,
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / pageSize)
      }
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error fetching WIP balance transactions:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch WIP balance transactions',
      'FETCH_ERROR',
      500
    );
  }
}

// ============================================================================
// POST - Create WIP balance transaction
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Parse request body
    const body: WIPBalanceRequest = await request.json();

    // Validate request
    validateWIPBalanceTransaction(body);

    // Check for duplicate wms_id on the same snapshot date
    const snapshotDate = new Date(body.header.trx_date);
    const existing = await prisma.wip_balance.findFirst({
      where: {
        wms_id: body.header.wms_id,
        company_code: body.header.company_code,
        snapshot_date: snapshotDate
      }
    });

    if (existing) {
      return errorResponse(
        `WIP balance transaction with wms_id '${body.header.wms_id}' already exists for this date`,
        'DUPLICATE_WMS_ID',
        409
      );
    }

    // Create transaction - insert all detail items as individual wip_balance records
    const result = await prisma.$transaction(async (tx) => {
      // Create wip_balance records for each detail
      const wipBalances = await Promise.all(
        body.details.map((detail) =>
          tx.wip_balance.create({
            data: {
              wms_id: detail.wms_id,
              company_code: body.header.company_code,
              item_type_code: detail.item_type_code, // Always HALB
              item_code: detail.item_code,
              item_name: detail.item_name,
              snapshot_date: snapshotDate,
              uom: detail.uom,
              qty: detail.qty,
              wms_timestamp: new Date(body.header.wms_timestamp)
            }
          })
        )
      );

      return { wipBalances };
    });

    // Log activity
    await logActivity({
      userId: session.user?.id || '',
      action: 'CREATE',
      description: `Created WIP balance snapshot ${body.header.wms_id}`,
      status: 'SUCCESS'
    });

    // Build response
    const response: TransactionSubmissionResponse = {
      wms_id: body.header.wms_id,
      imap_id: result.wipBalances[0]?.id.toString() || '',
      status: 'RECEIVED',
      message: 'WIP balance transaction created successfully',
      received_at: new Date().toISOString(),
      processed_at: new Date().toISOString()
    };

    return successResponse(response, 201);
  } catch (error) {
    console.error('Error creating WIP balance transaction:', error);

    // Log failed activity
    const session = await getServerSession(authOptions);
    if (session) {
      await logActivity({
        userId: session.user?.id || '',
        action: 'CREATE',
        description: `Failed to create WIP balance transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        status: 'FAILED'
      });
    }

    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create WIP balance transaction',
      'CREATE_ERROR',
      500
    );
  }
}
