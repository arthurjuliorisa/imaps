/**
 * Master Data API - Beginning Balances (v2.4.2)
 *
 * Manages initial stock balances
 * Supports CRUD operations and pagination
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  PaginatedResponse,
  BeginningBalance,
  BeginningBalanceRequest
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
// GET - List beginning balances
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
    const itemType = searchParams.get('item_type');
    const search = searchParams.get('search');

    // Build where clause
    const where: any = {};

    if (companyCode) {
      where.company_code = parseInt(companyCode);
    }

    if (itemType) {
      where.item_type = itemType;
    }

    if (search) {
      where.OR = [
        { item_code: { contains: search, mode: 'insensitive' } },
        { item_name: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Get total count
    const totalRecords = await prisma.beginning_balances.count({ where });

    // Get paginated data
    const skip = (page - 1) * pageSize;
    const balances = await prisma.beginning_balances.findMany({
      where,
      skip,
      take: pageSize,
      include: {
        ppkeks: {
          select: {
            ppkek_number: true
          }
        }
      },
      orderBy: [
        { company_code: 'asc' },
        { item_code: 'asc' }
      ]
    });

    // Build response
    const response: PaginatedResponse<BeginningBalance> = {
      data: balances as any,
      pagination: {
        page,
        page_size: pageSize,
        total_records: totalRecords,
        total_pages: Math.ceil(totalRecords / pageSize)
      }
    };

    return successResponse(response);
  } catch (error) {
    console.error('Error fetching beginning balances:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch beginning balances',
      'FETCH_ERROR',
      500
    );
  }
}

// ============================================================================
// POST - Create beginning balance
// ============================================================================

export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Parse request body
    const body: BeginningBalanceRequest = await request.json();

    // Validate required fields
    if (!body.company_code || !body.item_type || !body.item_code || !body.item_name) {
      return errorResponse('Missing required fields', 'VALIDATION_ERROR', 400);
    }

    if (!body.uom || body.qty === undefined) {
      return errorResponse('Missing uom or qty', 'VALIDATION_ERROR', 400);
    }

    if (!body.balance_date) {
      return errorResponse('balance_date is required', 'VALIDATION_ERROR', 400);
    }

    // Check for duplicate (based on unique constraint: company_code, item_code, balance_date)
    const existing = await prisma.beginning_balances.findFirst({
      where: {
        company_code: body.company_code,
        item_code: body.item_code,
        balance_date: new Date(body.balance_date)
      }
    });

    if (existing) {
      return errorResponse(
        `Beginning balance for ${body.item_code} on ${body.balance_date} already exists`,
        'DUPLICATE',
        409
      );
    }

    // Get next available ID
    const maxId = await prisma.beginning_balances.aggregate({
      _max: {
        id: true
      }
    });
    const nextId = (maxId._max.id || 0) + 1;

    // Create beginning balance with ppkeks
    const balance = await prisma.beginning_balances.create({
      data: {
        id: nextId,
        company_code: body.company_code,
        item_type: body.item_type,
        item_code: body.item_code,
        item_name: body.item_name,
        uom: body.uom,
        qty: body.qty,
        balance_date: new Date(body.balance_date),
        remarks: body.remarks,
        ...(body.ppkek_numbers && body.ppkek_numbers.length > 0 && {
          ppkeks: {
            createMany: {
              data: body.ppkek_numbers.map(ppkek => ({
                ppkek_number: ppkek
              }))
            }
          }
        })
      },
      include: {
        ppkeks: {
          select: {
            ppkek_number: true
          }
        }
      }
    });

    // Transform response
    const responseData = {
      ...balance,
      ppkek_numbers: balance.ppkeks?.map(p => p.ppkek_number) || []
    };

    // Log activity
    await logActivity({
      userId: session.user?.id || '',
      action: 'CREATE',
      description: `Created beginning balance for ${body.item_code}`
    });

    return successResponse(responseData, 201);
  } catch (error) {
    console.error('Error creating beginning balance:', error);

    // Log failed activity
    const session = await getServerSession(authOptions);
    if (session) {
      await logActivity({
        userId: session.user?.id || '',
        action: 'CREATE',
        description: `Failed to create beginning balance: ${error instanceof Error ? error.message : 'Unknown error'}`
      });
    }

    return errorResponse(
      error instanceof Error ? error.message : 'Failed to create beginning balance',
      'CREATE_ERROR',
      500
    );
  }
}
