/**
 * WMS API - Adjustment Transactions (v2.4.2)
 *
 * Handles stock adjustments (GAIN/LOSS)
 * v2.4.2: adjustment_type at detail level, qty always positive
 * Implements the WMS-iMAPS API Contract v2.4.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
import type {
  AdjustmentRequest,
  ApiSuccessResponse,
  ApiErrorResponse,
  TransactionSubmissionResponse,
  PaginatedResponse,
  AdjustmentHeader
} from '@/types/v2.4.2';
import { AdjustmentType } from '@/types/v2.4.2';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate adjustment transaction request
 */
function validateAdjustmentTransaction(data: AdjustmentRequest): void {
  const { header, details } = data;

  // Validate header
  if (!header.wms_id || !header.company_code || !header.trx_date) {
    throw new Error('Missing required header fields: wms_id, company_code, trx_date');
  }

  if (!header.internal_evidence_number || header.internal_evidence_number.trim() === '') {
    throw new Error('internal_evidence_number is required');
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

    // v2.4.2: qty must always be positive (direction determined by adjustment_type)
    if (detail.qty <= 0) {
      throw new Error(`Detail ${index + 1}: qty must be positive (use adjustment_type to indicate GAIN/LOSS)`);
    }

    // v2.4.2: adjustment_type is required at detail level
    if (!detail.adjustment_type) {
      throw new Error(`Detail ${index + 1}: adjustment_type is required (v2.4.2)`);
    }

    if (detail.adjustment_type !== AdjustmentType.GAIN && detail.adjustment_type !== AdjustmentType.LOSS) {
      throw new Error(`Detail ${index + 1}: adjustment_type must be either GAIN or LOSS`);
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
// GET - List adjustment transactions
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
      where.trx_date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (search) {
      where.OR = [
        { wms_id: { contains: search, mode: 'insensitive' } },
        { internal_evidence_number: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const totalRecords = await prisma.adjustments.count({ where });

    // Get paginated data
    const skip = (page - 1) * pageSize;
    const headers = await prisma.adjustments.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { trx_date: 'desc' },
      include: {
        adjustment_details: true
      }
    });

    // Build response
    const response: PaginatedResponse<AdjustmentHeader> = {
      data: headers as any,
      pagination: {
        page,
        page_size: pageSize,
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / pageSize)
      }
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error fetching adjustment transactions:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch adjustment transactions',
      'FETCH_ERROR',
      500
    );
  }
}

// ============================================================================
// POST - Create adjustment transaction
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Parse request body
    const body: AdjustmentRequest = await request.json();

    // Validate request
    validateAdjustmentTransaction(body);

    // Check for duplicate wms_id
    const existing = await prisma.adjustments.findFirst({
      where: {
        wms_id: body.header.wms_id,
        company_code: body.header.company_code
      }
    });

    if (existing) {
      return errorResponse(
        `Adjustment transaction with wms_id '${body.header.wms_id}' already exists`,
        'DUPLICATE_WMS_ID',
        409
      );
    }

    // Create transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create header
      const header = await tx.adjustments.create({
        data: {
          wms_id: body.header.wms_id,
          company_code: body.header.company_code,
          trx_date: new Date(body.header.trx_date),
          wms_timestamp: new Date(body.header.wms_timestamp),
          wms_doc_type: body.header.wms_doc_type,
          internal_evidence_number: body.header.internal_evidence_number
        }
      });

      // Create details
      const details = await Promise.all(
        body.details.map((detail) =>
          tx.adjustment_details.create({
            data: {
              header_id: BigInt(header.id),
              wms_id: detail.wms_id,
              company_code: body.header.company_code,
              trx_date: new Date(body.header.trx_date),
              adjustment_type: detail.adjustment_type, // v2.4.2: At detail level
              item_type_code: detail.item_type_code,
              item_code: detail.item_code,
              item_name: detail.item_name,
              uom: detail.uom,
              qty: detail.qty,                         // v2.4.2: Always positive
              reason: detail.reason
            }
          })
        )
      );

      return { header, details };
    });

    // Log activity
    await logActivity({
      userId: session.user?.id || '',
      action: 'CREATE',
      description: `Created adjustment transaction ${body.header.wms_id}`,
      status: 'SUCCESS'
    });

    // Build response
    const response: TransactionSubmissionResponse = {
      wms_id: body.header.wms_id,
      imap_id: result.header.id.toString(),
      status: 'RECEIVED',
      message: 'Adjustment transaction created successfully',
      received_at: new Date().toISOString(),
      processed_at: new Date().toISOString()
    };

    return successResponse(response, 201);
  } catch (error) {
    console.error('Error creating adjustment transaction:', error);

    // Log failed activity
    const session = await getServerSession(authOptions);
    if (session) {
      await logActivity({
        userId: session.user?.id || '',
        action: 'CREATE',
        description: `Failed to create adjustment transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        status: 'FAILED'
      });
    }

    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create adjustment transaction',
      'CREATE_ERROR',
      500
    );
  }
}
