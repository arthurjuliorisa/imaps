import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
} from '@/lib/api-utils';

/**
 * GET /api/master/currency
 * Retrieves all currencies ordered by code
 */
export async function GET() {
  try {
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
    const body = await request.json();

    // Validate required fields
    validateRequiredFields(body, ['code', 'name']);

    // Trim string fields
    const data = trimStringFields({
      code: body.code,
      name: body.name,
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
