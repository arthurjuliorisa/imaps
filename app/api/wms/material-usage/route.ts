/**
 * WMS API - Material Usage Transactions (v2.4.2)
 *
 * Handles material consumption in production
 * Supports ROH and HALB items with PPKEK traceability
 * Implements the WMS-iMAPS API Contract v2.4.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
import type {
  MaterialUsageRequest,
  ApiSuccessResponse,
  ApiErrorResponse,
  TransactionSubmissionResponse,
  PaginatedResponse,
  MaterialUsageHeader
} from '@/types/core';
import { ItemTypeCode } from '@/types/core';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate material usage transaction request
 */
function validateMaterialUsageTransaction(data: MaterialUsageRequest): void {
  const { header, details } = data;

  // Validate header
  if (!header.wms_id || !header.company_code || !header.transaction_date) {
    throw new Error('Missing required header fields: wms_id, company_code, transaction_date');
  }

  if (!header.work_order_number || header.work_order_number.trim() === '') {
    throw new Error('work_order_number is required');
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

    // v2.4.2: Only ROH and HALB can be consumed
    if (detail.item_type !== ItemTypeCode.ROH && detail.item_type !== ItemTypeCode.HALB) {
      throw new Error(`Detail ${index + 1}: Only ROH and HALB items can be consumed in material usage`);
    }

    // v2.4.2: ppkek_number is required for traceability
    if (!detail.ppkek_number || detail.ppkek_number.trim() === '') {
      throw new Error(`Detail ${index + 1}: ppkek_number is required for traceability (v2.4.2)`);
    }

    if (detail.qty <= 0) {
      throw new Error(`Detail ${index + 1}: qty must be positive`);
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
// GET - List material usage transactions
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
    const totalRecords = await prisma.material_usages.count({ where });

    // Get paginated data
    const skip = (page - 1) * pageSize;
    const headers = await prisma.material_usages.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { transaction_date: 'desc' },
      include: {
        items: true
      }
    });

    // Build response
    const response: PaginatedResponse<MaterialUsageHeader> = {
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
    console.error('Error fetching material usage transactions:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch material usage transactions',
      'FETCH_ERROR',
      500
    );
  }
}

// ============================================================================
// POST - Create material usage transaction
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Parse request body
    const body: MaterialUsageRequest = await request.json();

    // Validate request
    validateMaterialUsageTransaction(body);

    // Check for duplicate wms_id
    const existing = await prisma.material_usages.findFirst({
      where: {
        wms_id: body.header.wms_id,
        company_code: body.header.company_code
      }
    });

    if (existing) {
      return errorResponse(
        `Material usage transaction with wms_id '${body.header.wms_id}' already exists`,
        'DUPLICATE_WMS_ID',
        409
      );
    }

    // Create transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create header
      const header = await tx.material_usages.create({
        data: {
          wms_id: body.header.wms_id,
          company_code: body.header.company_code,
          transaction_date: new Date(body.header.transaction_date),
          timestamp: body.header.timestamp ? new Date(body.header.timestamp) : new Date(),
          work_order_number: body.header.work_order_number,
          cost_center_number: body.header.cost_center_number,
          internal_evidence_number: body.header.internal_evidence_number || body.header.wms_id,
          reversal: body.header.reversal
        }
      });

      // Create details
      const details = await Promise.all(
        body.details.map((detail) =>
          tx.material_usage_items.create({
            data: {
              material_usage_id: header.id,
              material_usage_company: body.header.company_code,
              material_usage_date: new Date(body.header.transaction_date),
              item_type: detail.item_type,
              item_code: detail.item_code,
              item_name: detail.item_name,
              uom: detail.uom,
              qty: detail.qty,
              ppkek_number: detail.ppkek_number // v2.4.2: Required for traceability
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
      description: `Created material usage transaction ${body.header.wms_id} for WO ${body.header.work_order_number}`
    });

    // Build response
    const response: TransactionSubmissionResponse = {
      wms_id: body.header.wms_id,
      imap_id: result.header.id.toString(),
      status: 'RECEIVED',
      message: 'Material usage transaction created successfully',
      received_at: new Date().toISOString(),
      processed_at: new Date().toISOString()
    };

    return successResponse(response, 201);
  } catch (error) {
    console.error('Error creating material usage transaction:', error);

    // Log failed activity
    const session = await getServerSession(authOptions);
    if (session) {
      await logActivity({
        userId: session.user?.id || '',
        action: 'CREATE',
        description: `Failed to create material usage transaction: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create material usage transaction',
      'CREATE_ERROR',
      500
    );
  }
}
