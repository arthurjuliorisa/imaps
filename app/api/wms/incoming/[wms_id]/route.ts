/**
 * WMS API - Incoming Transaction Detail (v2.4.2)
 *
 * Get single incoming transaction by wms_id
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  IncomingHeader,
  IncomingDetail
} from '@/types/core';

/**
 * Build error response
 */
function errorResponse(message: string, code = 'ERROR', status = 400): NextResponse<ApiErrorResponse> {
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
// GET - Get incoming transaction detail
// ============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ wms_id: string }> }
) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    const { wms_id } = await params;

    // Get header
    const header = await prisma.incoming_goods.findFirst({
      where: { wms_id }
    });

    if (!header) {
      return errorResponse(
        `Incoming transaction with wms_id '${wms_id}' not found`,
        'NOT_FOUND',
        404
      );
    }

    // Get details (manual join due to partitioning)
    const items = await prisma.incoming_good_items.findMany({
      where: {
        incoming_good_id: header.id,
        incoming_good_company: header.company_code,
        incoming_good_date: header.incoming_date
      },
      orderBy: { id: 'asc' }
    });

    // Map to API response format
    const response = {
      header: {
        id: header.id,
        wms_id: header.wms_id,
        company_code: header.company_code,
        owner: header.owner,
        customs_document_type: header.customs_document_type,
        incoming_evidence_number: header.incoming_evidence_number,
        customs_registration_date: header.customs_registration_date,
        incoming_date: header.incoming_date,
        timestamp: header.timestamp,
        ppkek_number: header.ppkek_number || '',
        invoice_number: header.invoice_number || '',
        invoice_date: header.invoice_date || undefined,
        shipper_name: header.shipper_name || '',
        created_at: header.created_at,
        updated_at: header.updated_at
      } as IncomingHeader,
      details: items.map((detail) => ({
        id: detail.id,
        incoming_good_id: detail.incoming_good_id,
        incoming_good_company: detail.incoming_good_company,
        incoming_good_date: detail.incoming_good_date,
        item_type: detail.item_type,
        item_code: detail.item_code,
        item_name: detail.item_name,
        uom: detail.uom,
        qty: Number(detail.qty),
        currency: detail.currency,
        amount: Number(detail.amount),
        hs_code: detail.hs_code || undefined,
        created_at: detail.created_at,
        updated_at: detail.updated_at
      } as IncomingDetail))
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error fetching incoming transaction detail:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch incoming transaction detail',
      'FETCH_ERROR',
      500
    );
  }
}
