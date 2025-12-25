/**
 * Traceability API - Get item traceability data
 *
 * Endpoint: GET /api/customs/outgoing/traceability?item_ids=1,2,3&company_code=1001
 *
 * Returns traceability chain:
 * Outgoing Item -> Production Output -> Work Order -> PPKEK Numbers
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { traceabilityRepository, type TraceabilityItem } from '@/lib/repositories/traceability.repository';
import type { ApiSuccessResponse, ApiErrorResponse } from '@/types/core';

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
// GET - Get traceability data for outgoing items
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const itemIdsParam = searchParams.get('item_ids');
    const companyCodeParam = searchParams.get('company_code');

    // Validate parameters
    if (!itemIdsParam || !companyCodeParam) {
      return errorResponse(
        'Missing required parameters: item_ids and company_code',
        'INVALID_PARAMS',
        400
      );
    }

    // Parse item IDs
    const itemIds = itemIdsParam
      .split(',')
      .map((id) => parseInt(id.trim()))
      .filter((id) => !isNaN(id));

    if (itemIds.length === 0) {
      return errorResponse(
        'Invalid item_ids format. Expected comma-separated numbers.',
        'INVALID_PARAMS',
        400
      );
    }

    // Parse company code
    const companyCode = parseInt(companyCodeParam);
    if (isNaN(companyCode)) {
      return errorResponse(
        'Invalid company_code. Expected a number.',
        'INVALID_PARAMS',
        400
      );
    }

    // Validate that the requested company code matches the authenticated user's company
    const sessionCompanyRaw =
      (session as any)?.user?.companyCode ??
      (session as any)?.user?.company_code;

    const sessionCompanyCode =
      typeof sessionCompanyRaw === 'string'
        ? parseInt(sessionCompanyRaw, 10)
        : Number(sessionCompanyRaw);

    if (!sessionCompanyRaw || Number.isNaN(sessionCompanyCode)) {
      return errorResponse(
        'Authenticated user does not have a valid company associated.',
        'UNAUTHORIZED_COMPANY',
        403
      );
    }

    if (sessionCompanyCode !== companyCode) {
      return errorResponse(
        'Forbidden: company_code does not match authenticated user company.',
        'FORBIDDEN',
        403
      );
    }
    // Get traceability data
    const traceabilityData = await traceabilityRepository.getTraceabilityByOutgoingItemIds(
      itemIds,
      companyCode
    );

    // Group by item code to merge items with same code
    const groupedData = traceabilityData.reduce(
      (acc, item) => {
        const existing = acc.find((i) => i.item_code === item.item_code);
        if (existing) {
          // If item already exists, merge work orders
          const existingWOs = new Map(existing.work_orders.map((w) => [w.work_order_number, w]));

          item.work_orders.forEach((wo) => {
            if (existingWOs.has(wo.work_order_number)) {
              // Merge PPKEK numbers
              const existingPPKEK = new Set(existingWOs.get(wo.work_order_number)!.ppkek_numbers);
              wo.ppkek_numbers.forEach((p) => existingPPKEK.add(p));
              existingWOs.get(wo.work_order_number)!.ppkek_numbers = Array.from(existingPPKEK).sort();
            } else {
              existingWOs.set(wo.work_order_number, wo);
            }
          });

          existing.work_orders = Array.from(existingWOs.values()).sort((a, b) =>
            a.work_order_number.localeCompare(b.work_order_number)
          );
        } else {
          acc.push(item);
        }
        return acc;
      },
      [] as TraceabilityItem[]
    );

    return successResponse({
      items: groupedData,
      count: groupedData.length,
    });
  } catch (error) {
    console.error('Error fetching traceability data:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch traceability data',
      'FETCH_ERROR',
      500
    );
  }
}
