import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
  getPaginationParams,
  createPaginatedResponse,
} from '@/lib/api-utils';

/**
 * GET /api/master/customer
 * Retrieves all customers with optional pagination
 *
 * Query parameters:
 * - page: number (default: 1)
 * - limit: number (default: 10, max: 100)
 * - search: string (optional, searches code and name)
 */
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const { skip, take, page, limit } = getPaginationParams(searchParams);
    const search = searchParams.get('search')?.trim() || '';

    // Build where clause for search
    const where = search
      ? {
          OR: [
            { code: { contains: search, mode: 'insensitive' as const } },
            { name: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    // Get total count
    const total = await prisma.customer.count({ where });

    // Get paginated customers
    const customers = await prisma.customer.findMany({
      where,
      skip,
      take,
      orderBy: { code: 'asc' },
    });

    return NextResponse.json(
      createPaginatedResponse(customers, total, page, limit)
    );
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/master/customer
 * Creates a new customer
 *
 * Request body:
 * - code: string (required, unique)
 * - name: string (required)
 * - address: string (optional)
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
      address: body.address || null,
    });

    // Create customer
    const customer = await prisma.customer.create({
      data,
    });

    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
