/**
 * WMS API - Outgoing Transactions (v2.4.2)
 *
 * Handles outgoing goods transactions (BC30, BC25, BC27, BC41)
 * Implements the WMS-iMAPS API Contract v2.4.2
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
import type {
  OutgoingTransactionRequest,
  ApiSuccessResponse,
  ApiErrorResponse,
  TransactionSubmissionResponse,
  PaginatedResponse,
  OutgoingHeader
} from '@/types/core';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate outgoing transaction request
 */
function validateOutgoingTransaction(data: OutgoingTransactionRequest): void {
  const { header, details } = data;

  // Validate header
  if (!header.wms_id || !header.company_code || !header.outgoing_date) {
    throw new Error('Missing required header fields: wms_id, company_code, outgoing_date');
  }

  if (!header.customs_document_type || !header.customs_registration_date) {
    throw new Error('Missing required customs document fields');
  }

  // v2.4.2: ppkek_number is MANDATORY (NOT NULL)
  if (!header.ppkek_number || header.ppkek_number.trim() === '') {
    throw new Error('ppkek_number is mandatory for outgoing transactions (v2.4.2)');
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

    // v2.4.2: Currency and amount at detail level
    if (!detail.currency || detail.amount === undefined) {
      throw new Error(`Detail ${index + 1}: Missing currency or amount (required in v2.4.2)`);
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
// GET - List outgoing transactions
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
    const customsDocType = searchParams.get('customs_doc_type');
    const ppkekNumber = searchParams.get('ppkek_number');
    const search = searchParams.get('search');

    // Build where clause
    const where: any = {};

    if (companyCode) {
      where.company_code = parseInt(companyCode);
    }

    if (startDate && endDate) {
      where.outgoing_date = {
        gte: new Date(startDate),
        lte: new Date(endDate)
      };
    }

    if (customsDocType) {
      where.customs_document_type = customsDocType;
    }

    if (ppkekNumber) {
      where.ppkek_number = { contains: ppkekNumber, mode: 'insensitive' };
    }

    if (search) {
      where.OR = [
        { wms_id: { contains: search, mode: 'insensitive' } },
        { outgoing_evidence_number: { contains: search, mode: 'insensitive' } },
        { recipient_name: { contains: search, mode: 'insensitive' } },
        { ppkek_number: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const totalRecords = await prisma.outgoing_goods.count({ where });

    // Get paginated data
    const skip = (page - 1) * pageSize;
    const headers = await prisma.outgoing_goods.findMany({
      where,
      skip,
      take: pageSize,
      orderBy: { outgoing_date: 'desc' },
      include: {
        items: true
      }
    });

    // Build response
    const response: PaginatedResponse<OutgoingHeader> = {
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
    console.error('Error fetching outgoing transactions:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch outgoing transactions',
      'FETCH_ERROR',
      500
    );
  }
}

// ============================================================================
// POST - Create outgoing transaction
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Parse request body
    const body: OutgoingTransactionRequest = await request.json();

    // Validate request
    validateOutgoingTransaction(body);

    // Check for duplicate wms_id
    const existing = await prisma.outgoing_goods.findFirst({
      where: {
        wms_id: body.header.wms_id,
        company_code: body.header.company_code
      }
    });

    if (existing) {
      return errorResponse(
        `Outgoing transaction with wms_id '${body.header.wms_id}' already exists`,
        'DUPLICATE_WMS_ID',
        409
      );
    }

    // Create transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create header
      const header = await tx.outgoing_goods.create({
        data: {
          wms_id: body.header.wms_id,
          company_code: body.header.company_code,
          customs_document_type: body.header.customs_document_type,
          outgoing_evidence_number: body.header.outgoing_evidence_number || body.header.wms_id,
          customs_registration_date: new Date(body.header.customs_registration_date),
          ppkek_number: body.header.ppkek_number,
          outgoing_date: new Date(body.header.outgoing_date),
          recipient_name: body.header.recipient_name || '',
          owner: body.header.owner || body.header.company_code,
          invoice_number: body.header.invoice_number || '',
          invoice_date: body.header.invoice_date ? new Date(body.header.invoice_date) : new Date(),
          timestamp: body.header.timestamp ? new Date(body.header.timestamp) : new Date()
        }
      });

      // Create details
      const details = await Promise.all(
        body.details.map((detail) =>
          tx.outgoing_good_items.create({
            data: {
              outgoing_good_id: header.id,
              outgoing_good_company: body.header.company_code,
              outgoing_good_date: new Date(body.header.outgoing_date),
              item_type: detail.item_type,
              item_code: detail.item_code,
              item_name: detail.item_name,
              production_output_wms_ids: detail.production_output_wms_ids || [],
              uom: detail.uom,
              qty: detail.qty,
              currency: detail.currency,
              amount: detail.amount,
              hs_code: detail.hs_code
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
      description: `Created outgoing transaction ${body.header.wms_id} with PPKEK ${body.header.ppkek_number}`,
      status: 'SUCCESS'
    });

    // Build response
    const response: TransactionSubmissionResponse = {
      wms_id: body.header.wms_id,
      imap_id: result.header.id.toString(),
      status: 'RECEIVED',
      message: 'Outgoing transaction created successfully',
      received_at: new Date().toISOString(),
      processed_at: new Date().toISOString()
    };

    return successResponse(response, 201);
  } catch (error) {
    console.error('Error creating outgoing transaction:', error);

    // Log failed activity
    const session = await getServerSession(authOptions);
    if (session) {
      await logActivity({
        userId: session.user?.id || '',
        action: 'CREATE',
        description: `Failed to create outgoing transaction: ${error instanceof Error ? error.message : 'Unknown error'}`,
        status: 'FAILED'
      });
    }

    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create outgoing transaction',
      'CREATE_ERROR',
      500
    );
  }
}
