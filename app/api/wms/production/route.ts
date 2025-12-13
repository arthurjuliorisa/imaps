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
} from '@/types/v2.4.2';
import { ItemTypeCode, ReversalStatus } from '@/types/v2.4.2';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate production output transaction request
 */
function validateProductionOutputTransaction(data: ProductionOutputRequest): void {
  const { header, details } = data;

  // Validate header
  if (!header.wms_id || !header.company_code || !header.trx_date) {
    throw new Error('Missing required header fields: wms_id, company_code, trx_date');
  }

  if (!header.work_order_number || header.work_order_number.trim() === '') {
    throw new Error('work_order_number is required');
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

    // v2.4.2: Only FERT and SCRAP can be produced
    if (detail.item_type_code !== ItemTypeCode.FERT && detail.item_type_code !== ItemTypeCode.SCRAP) {
      throw new Error(`Detail ${index + 1}: Only FERT and SCRAP items can be produced`);
    }

    // v2.4.2: quality_grade required for FERT items
    if (detail.item_type_code === ItemTypeCode.FERT) {
      if (!detail.quality_grade) {
        throw new Error(`Detail ${index + 1}: quality_grade is required for FERT items`);
      }
      const validGrades = ['A', 'B', 'C', 'REJECT'];
      if (!validGrades.includes(detail.quality_grade)) {
        throw new Error(`Detail ${index + 1}: quality_grade must be one of: ${validGrades.join(', ')}`);
      }
    }

    if (detail.qty <= 0) {
      throw new Error(`Detail ${index + 1}: qty must be positive`);
    }

    // v2.4.2: work_order_numbers is required (array of work orders)
    if (!detail.work_order_numbers || detail.work_order_numbers.length === 0) {
      throw new Error(`Detail ${index + 1}: work_order_numbers array is required (v2.4.2)`);
    }

    // v2.4.2: reversal_status is required
    if (!detail.reversal_status) {
      throw new Error(`Detail ${index + 1}: reversal_status is required (v2.4.2)`);
    }

    const validReversalStatus = [ReversalStatus.NORMAL, ReversalStatus.REVERSED, ReversalStatus.PARTIAL_REVERSAL];
    if (!validReversalStatus.includes(detail.reversal_status as ReversalStatus)) {
      throw new Error(`Detail ${index + 1}: reversal_status must be one of: ${validReversalStatus.join(', ')}`);
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
      where.company_code = companyCode;
    }

    if (startDate && endDate) {
      where.trx_date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (workOrderNumber) {
      where.work_order_number = { contains: workOrderNumber, mode: 'insensitive' };
    }

    if (search) {
      where.OR = [
        { wms_id: { contains: search, mode: 'insensitive' } },
        { work_order_number: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const totalRecords = await prisma.finished_goods_production_headers.count({ where });

    // Get paginated data
    const skip = (page - 1) * pageSize;
    const headers = await prisma.finished_goods_production_headers.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { trx_date: 'desc' },
      include: {
        finished_goods_production_details: true
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
    const existing = await prisma.finished_goods_production_headers.findFirst({
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
      const header = await tx.finished_goods_production_headers.create({
        data: {
          wms_id: body.header.wms_id,
          company_code: body.header.company_code,
          trx_date: new Date(body.header.trx_date),
          wms_timestamp: new Date(body.header.wms_timestamp),
          internal_evidence_number: body.header.wms_id
        }
      });

      // Create details
      const details = await Promise.all(
        body.details.map((detail) =>
          tx.finished_goods_production_details.create({
            data: {
              header_id: BigInt(header.id),
              wms_id: detail.wms_id,
              company_code: body.header.company_code,
              trx_date: new Date(body.header.trx_date),
              item_type_code: detail.item_type_code,
              item_code: detail.item_code,
              item_name: detail.item_name,
              uom: detail.uom,
              qty: detail.qty,
              work_order_numbers: detail.work_order_numbers // v2.4.2: Array at item level
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
      description: `Created production transaction ${body.header.wms_id} for WO ${body.header.work_order_number}`,
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
