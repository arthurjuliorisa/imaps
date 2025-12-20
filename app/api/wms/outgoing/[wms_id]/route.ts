/**
 * WMS API - Outgoing Transaction Detail (v2.4.2)
 *
 * Get single outgoing transaction by wms_id
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  OutgoingHeader,
  OutgoingDetail
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
// GET - Get outgoing transaction detail
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
    const header = await prisma.outgoing_goods.findFirst({
      where: { wms_id }
    });

    if (!header) {
      return errorResponse(
        `Outgoing transaction with wms_id '${wms_id}' not found`,
        'NOT_FOUND',
        404
      );
    }

    // Get details (manual join due to partitioning)
    const items = await prisma.outgoing_good_items.findMany({
      where: {
        outgoing_good_id: header.id,
        outgoing_good_company: header.company_code,
        outgoing_good_date: header.outgoing_date
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
        outgoing_evidence_number: header.outgoing_evidence_number,
        customs_registration_date: header.customs_registration_date,
        outgoing_date: header.outgoing_date,
        timestamp: header.timestamp,
        ppkek_number: header.ppkek_number || '',
        invoice_number: header.invoice_number || '',
        invoice_date: header.invoice_date || undefined,
        recipient_name: header.recipient_name || '',
        created_at: header.created_at,
        updated_at: header.updated_at
      } as OutgoingHeader,
      details: items.map((detail) => ({
        id: detail.id,
        outgoing_good_id: detail.outgoing_good_id,
        outgoing_good_company: detail.outgoing_good_company,
        outgoing_good_date: detail.outgoing_good_date,
        item_type: detail.item_type,
        item_code: detail.item_code,
        item_name: detail.item_name,
        uom: detail.uom,
        qty: Number(detail.qty),
        currency: detail.currency,
        amount: Number(detail.amount),
        hs_code: detail.hs_code || undefined,
        production_output_wms_ids: detail.production_output_wms_ids || [],
        created_at: detail.created_at,
        updated_at: detail.updated_at
      } as OutgoingDetail))
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error fetching outgoing transaction detail:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch outgoing transaction detail',
      'FETCH_ERROR',
      500
    );
  }
}
