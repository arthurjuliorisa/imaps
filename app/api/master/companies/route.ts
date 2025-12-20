/**
 * Master Data API - Companies (v2.4.2)
 *
 * Provides company master data
 * Simple read-only endpoint for company list
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import type {
  ApiSuccessResponse,
  ApiErrorResponse,
  Company
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
// GET - List all companies
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');

    // Build where clause
    const where: any = {
      status: 'ACTIVE'
    };

    // Add code filter if provided
    if (code) {
      where.code = parseInt(code);
    }

    // Get companies
    const companies = await prisma.companies.findMany({
      where,
      orderBy: {
        name: 'asc'
      }
    });

    return successResponse<Company[]>(companies as any);
  } catch (error) {
    console.error('Error fetching companies:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch companies',
      'FETCH_ERROR',
      500
    );
  }
}
