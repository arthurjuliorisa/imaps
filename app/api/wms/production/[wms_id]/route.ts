/**
 * WMS API - Production Output Detail (v2.4.2)
 *
 * Get single production output transaction by wms_id
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  ProductionOutputHeader,
  ProductionOutputDetail
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
// GET - Get production output transaction detail
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
    const header = await prisma.production_outputs.findFirst({
      where: { wms_id }
    });

    if (!header) {
      return errorResponse(
        `Production output transaction with wms_id '${wms_id}' not found`,
        'NOT_FOUND',
        404
      );
    }

    // Get details (manual join due to partitioning)
    const items = await prisma.production_output_items.findMany({
      where: {
        production_output_id: header.id,
        production_output_company: header.company_code,
        production_output_date: header.transaction_date
      },
      orderBy: { id: 'asc' }
    });

    // Map to API response format
    const response = {
      header: {
        id: header.id,
        wms_id: header.wms_id,
        company_code: header.company_code,
        internal_evidence_number: header.internal_evidence_number,
        transaction_date: header.transaction_date,
        timestamp: header.timestamp,
        reversal: header.reversal || undefined,
        created_at: header.created_at,
        updated_at: header.updated_at
      } as ProductionOutputHeader,
      details: items.map((detail) => ({
        id: detail.id,
        production_output_id: detail.production_output_id,
        production_output_company: detail.production_output_company,
        production_output_date: detail.production_output_date,
        item_type: detail.item_type,
        item_code: detail.item_code,
        item_name: detail.item_name,
        uom: detail.uom,
        qty: Number(detail.qty),
        work_order_numbers: detail.work_order_numbers || [],
        created_at: detail.created_at,
        updated_at: detail.updated_at
      } as ProductionOutputDetail))
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error fetching production output transaction detail:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch production output transaction detail',
      'FETCH_ERROR',
      500
    );
  }
}
