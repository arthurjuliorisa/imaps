/**
 * WMS API - Laporan Posisi Barang Dalam Proses Detail (v2.4.2)
 *
 * Get single Laporan Posisi Barang Dalam Proses by wms_id
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  WIPBalanceHeader
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
// GET - Get Laporan Posisi Barang Dalam Proses detail
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

    // Get Laporan Posisi Barang Dalam Proses (WIP is a flat table, no header-detail pattern)
    const wipBalance = await prisma.wip_balances.findFirst({
      where: { wms_id }
    });

    if (!wipBalance) {
      return errorResponse(
        `Data Posisi Barang Dalam Proses dengan wms_id '${wms_id}' tidak ditemukan`,
        'NOT_FOUND',
        404
      );
    }

    // Map to API response format
    const response = {
      id: wipBalance.id,
      wms_id: wipBalance.wms_id,
      company_code: wipBalance.company_code,
      item_type: wipBalance.item_type,
      item_code: wipBalance.item_code,
      item_name: wipBalance.item_name,
      stock_date: wipBalance.stock_date,
      uom: wipBalance.uom,
      qty: Number(wipBalance.qty),
      timestamp: wipBalance.timestamp,
      created_at: wipBalance.created_at,
      updated_at: wipBalance.updated_at
    } as WIPBalanceHeader;

    return successResponse(response);
  } catch (error) {
    console.error('Error fetching WIP balance detail:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch WIP balance detail',
      'FETCH_ERROR',
      500
    );
  }
}
