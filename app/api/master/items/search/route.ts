/**
 * Master Data API - Item Search (v2.4.2)
 *
 * Search items across beginning balances and transaction details
 * Used for autocomplete in forms
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
// GET - Search items
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
    const itemTypeCode = searchParams.get('item_type_code');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!search || search.length < 2) {
      return successResponse([]);
    }

    // Build where clause
    const where: any = {
      OR: [
        { item_code: { contains: search, mode: 'insensitive' } },
        { item_name: { contains: search, mode: 'insensitive' } }
      ]
    };

    if (companyCode) {
      where.company_code = companyCode;
    }

    if (itemTypeCode) {
      where.item_type_code = itemTypeCode;
    }

    // Search in beginning balances
    const items = await prisma.beginning_balances.findMany({
      where,
      select: {
        item_code: true,
        item_name: true,
        item_type_code: true,
        uom: true
      },
      distinct: ['item_code'],
      take: limit,
      orderBy: {
        item_code: 'asc'
      }
    });

    return successResponse(items);
  } catch (error) {
    console.error('Error searching items:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to search items',
      'SEARCH_ERROR',
      500
    );
  }
}
