import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
} from '@/lib/api-utils';
import { checkAuth } from '@/lib/api-auth';

/**
 * GET /api/master/currency
 * Retrieves all currencies ordered by code
 */
export async function GET() {
  try {
    // Check authentication
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const currencies = await prisma.currency.findMany({
      orderBy: { code: 'asc' },
    });

    return NextResponse.json(currencies);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/master/currency
 * Creates a new currency
 *
 * Request body:
 * - code: string (required, unique)
 * - name: string (required)
 */
export async function POST(request: NextRequest) {
  try {
    // Check authentication
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const body = await request.json();

    // Validate required fields
    validateRequiredFields(body, ['code', 'name']);

    // Trim string fields and add required fields
    const id = `CUR-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const data = trimStringFields({
      id,
      code: body.code,
      name: body.name,
      updatedAt: new Date(),
    });

    // Create currency
    const currency = await prisma.currency.create({
      data,
    });

    return NextResponse.json(currency, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
