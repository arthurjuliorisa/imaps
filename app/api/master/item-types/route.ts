/**
 * Master Data API - Item Types (v2.4.2)
 *
 * Provides item type master data
 * Returns all item types with capital goods flag
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  ItemType
} from '@/types/core';

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
// GET - List all item types
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Check if only active item types should be returned
    const searchParams = request.nextUrl.searchParams;
    const activeOnly = searchParams.get('active') === 'true';

    // Get item types with optional filter
    const itemTypes = await prisma.item_types.findMany({
      where: activeOnly ? { is_active: true } : undefined,
      orderBy: {
        item_type_code: 'asc'
      }
    });

    return successResponse<ItemType[]>(itemTypes as any);
  } catch (error) {
    console.error('Error fetching item types:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch item types',
      'FETCH_ERROR',
      500
    );
  }
}
