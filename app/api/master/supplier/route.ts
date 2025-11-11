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
 * GET /api/master/supplier
 * Retrieves all suppliers with optional pagination
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
    const total = await prisma.supplier.count({ where });

    // Get paginated suppliers
    const suppliers = await prisma.supplier.findMany({
      where,
      skip,
      take,
      orderBy: { code: 'asc' },
    });

    return NextResponse.json(
      createPaginatedResponse(suppliers, total, page, limit)
    );
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/master/supplier
 * Creates a new supplier
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

    // Create supplier
    const supplier = await prisma.supplier.create({
      data,
    });

    return NextResponse.json(supplier, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
