/**
 * WMS API - Production Output Transactions (v2.4.2)
 *
 * Handles finished goods and scrap production output
 * Supports quality grades (A, B, C, REJECT) and work order linkage
 * Implements the WMS-iMAPS API Contract v2.4.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
import type {
  ProductionOutputRequest,
  ApiSuccessResponse,
  ApiErrorResponse,
  TransactionSubmissionResponse,
  PaginatedResponse,
  FinishedGoodsProductionHeader
} from '@/types/core';
import { ItemTypeCode, ReversalStatus } from '@/types/core';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate production output transaction request
 */
function validateProductionOutputTransaction(data: ProductionOutputRequest): void {
  const { header, details } = data;

  // Validate header
  if (!header.wms_id || !header.company_code || !header.transaction_date) {
    throw new Error('Missing required header fields: wms_id, company_code, transaction_date');
  }

  if (!header.internal_evidence_number || header.internal_evidence_number.trim() === '') {
    throw new Error('internal_evidence_number is required');
  }

  // Validate details
  if (!details || details.length === 0) {
    throw new Error('At least one detail item is required');
  }

  details.forEach((detail, index) => {
    if (!detail.item_code || !detail.item_name) {
      throw new Error(`Detail ${index + 1}: Missing required fields`);
    }

    if (!detail.item_type || !detail.uom || detail.qty === undefined) {
      throw new Error(`Detail ${index + 1}: Missing item_type, uom, or qty`);
    }

    if (detail.qty <= 0) {
      throw new Error(`Detail ${index + 1}: qty must be positive`);
    }

    // work_order_numbers is required (array of work orders at detail level)
    if (!detail.work_order_numbers || detail.work_order_numbers.length === 0) {
      throw new Error(`Detail ${index + 1}: work_order_numbers array is required`);
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
// GET - List production transactions
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
    const workOrderNumber = searchParams.get('work_order_number');
    const search = searchParams.get('search');

    // Build where clause
    const where: any = {};

    if (companyCode) {
      where.company_code = parseInt(companyCode);
    }

    if (startDate && endDate) {
      where.transaction_date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    // Note: work_order_number is at item level, not header level
    // For search by work order, we would need to join with items

    if (search) {
      where.OR = [
        { wms_id: { contains: search, mode: 'insensitive' } },
        { internal_evidence_number: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const totalRecords = await prisma.production_outputs.count({ where });

    // Get paginated data
    const skip = (page - 1) * pageSize;
    const headers = await prisma.production_outputs.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { transaction_date: 'desc' },
      include: {
        items: true
      }
    });

    // Build response
    const response: PaginatedResponse<FinishedGoodsProductionHeader> = {
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
    console.error('Error fetching production transactions:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch production transactions',
      'FETCH_ERROR',
      500
    );
  }
}

// ============================================================================
// POST - Create production transaction
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Parse request body
    const body: ProductionOutputRequest = await request.json();

    // Validate request
    validateProductionOutputTransaction(body);

    // Check for duplicate wms_id
    const existing = await prisma.production_outputs.findFirst({
      where: {
        wms_id: body.header.wms_id,
        company_code: body.header.company_code
      }
    });

    if (existing) {
      return errorResponse(
        `Production transaction with wms_id '${body.header.wms_id}' already exists`,
        'DUPLICATE_WMS_ID',
        409
      );
    }

    // Create transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create header
      const header = await tx.production_outputs.create({
        data: {
          wms_id: body.header.wms_id,
          company_code: body.header.company_code,
          transaction_date: new Date(body.header.transaction_date),
          timestamp: body.header.timestamp ? new Date(body.header.timestamp) : new Date(),
          internal_evidence_number: body.header.internal_evidence_number || body.header.wms_id,
          reversal: body.header.reversal
        }
      });

      // Create details
      const details = await Promise.all(
        body.details.map((detail) =>
          tx.production_output_items.create({
            data: {
              production_output_id: header.id,
              production_output_company: body.header.company_code,
              production_output_date: new Date(body.header.transaction_date),
              item_type: detail.item_type,
              item_code: detail.item_code,
              item_name: detail.item_name,
              uom: detail.uom,
              qty: detail.qty,
              work_order_numbers: detail.work_order_numbers
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
      description: `Created production transaction ${body.header.wms_id}`,
      status: 'SUCCESS'
    });

    // Build response
    const response: TransactionSubmissionResponse = {
      wms_id: body.header.wms_id,
      imap_id: result.header.id.toString(),
      status: 'RECEIVED',
      message: 'Production transaction created successfully',
      received_at: new Date().toISOString(),
      processed_at: new Date().toISOString()
    };

    return successResponse(response, 201);
  } catch (error) {
    console.error('Error creating production transaction:', error);

    // Log failed activity
    const session = await getServerSession(authOptions);
    if (session) {
      await logActivity({
        userId: session.user?.id || '',
        action: 'CREATE',
        description: `Failed to create production transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        status: 'FAILED'
      });
    }

    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create production transaction',
      'CREATE_ERROR',
      500
    );
  }
}
