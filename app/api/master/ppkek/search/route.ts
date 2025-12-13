// @ts-nocheck
// TODO: Fix field names - ppkek_number doesn't exist in incoming_details
/**
 * Master Data API - PPKEK Search (v2.4.2)
 *
 * Search PPKEK numbers for autocomplete in forms
 * Returns PPKEK with available quantity for traceability
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
// GET - Search PPKEK numbers
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
    const itemCode = searchParams.get('item_code');
    const itemTypeCode = searchParams.get('item_type_code');
    const limit = parseInt(searchParams.get('limit') || '20');

    if (!search || search.length < 2) {
      return successResponse([]);
    }

    // Build where clause
    const where: any = {
      ppkek_number: {
        contains: search,
        mode: 'insensitive'
      }
    };

    if (companyCode) {
      where.company_code = companyCode;
    }

    if (itemCode) {
      where.item_code = itemCode;
    }

    if (itemTypeCode) {
      where.item_type_code = itemTypeCode;
    }

    // Search in incoming details to find PPKEK numbers
    const ppkekList = await prisma.incoming_details.findMany({
      where,
      select: {
        ppkek_number: true,
        item_code: true,
        item_name: true,
        item_type_code: true,
        uom: true,
        qty: true,
        company_code: true
      },
      distinct: ['ppkek_number', 'item_code'],
      take: limit,
      orderBy: {
        ppkek_number: 'asc'
      }
    });

    // Filter out null PPKEK numbers and format response
    const results = ppkekList
      .filter(item => item.ppkek_number)
      .map(item => ({
        ppkek_number: item.ppkek_number!,
        item_code: item.item_code,
        item_name: item.item_name,
        item_type_code: item.item_type_code,
        uom: item.uom,
        company_code: item.company_code
      }));

    return successResponse(results);
  } catch (error) {
    console.error('Error searching PPKEK:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to search PPKEK',
      'SEARCH_ERROR',
      500
    );
  }
}
