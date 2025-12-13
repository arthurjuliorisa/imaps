// @ts-nocheck
// TODO: Fix field names - transaction_date doesn't exist in material_usage_headers
/**
 * Master Data API - Work Orders Search (v2.4.2)
 *
 * Search work order numbers for autocomplete in forms
 * Returns work orders from material usage and production transactions
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type {
  ApiSuccessResponse,
  ApiErrorResponse
} from '@/types/v2.4.2';

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
// GET - Search work order numbers
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
    const search = searchParams.get('search') || searchParams.get('q') || '';
    const companyCode = searchParams.get('company_code');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!search || search.length < 2) {
      return successResponse([]);
    }

    // Build where clause
    const where: any = {
      work_order_number: {
        contains: search,
        mode: 'insensitive'
      }
    };

    if (companyCode) {
      where.company_code = companyCode;
    }

    // Search in material usage headers
    const materialUsageOrders = await prisma.material_usage_headers.findMany({
      where,
      select: {
        work_order_number: true,
        company_code: true,
        transaction_date: true
      },
      distinct: ['work_order_number'],
      take: limit,
      orderBy: {
        work_order_number: 'asc'
      }
    });

    // Search in production headers
    const productionOrders = await prisma.finished_goods_production_headers.findMany({
      where,
      select: {
        work_order_number: true,
        company_code: true,
        transaction_date: true
      },
      distinct: ['work_order_number'],
      take: limit,
      orderBy: {
        work_order_number: 'asc'
      }
    });

    // Combine and deduplicate work orders
    const allOrders = [...materialUsageOrders, ...productionOrders];
    const uniqueOrders = Array.from(
      new Map(allOrders.map(order => [order.work_order_number, order])).values()
    );

    // Sort by work order number and limit results
    const results = uniqueOrders
      .sort((a, b) => a.work_order_number.localeCompare(b.work_order_number))
      .slice(0, limit)
      .map(order => ({
        work_order_number: order.work_order_number,
        company_code: order.company_code,
        transaction_date: order.transaction_date
      }));

    return successResponse(results);
  } catch (error) {
    console.error('Error searching work orders:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to search work orders',
      'SEARCH_ERROR',
      500
    );
  }
}
