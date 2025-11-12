import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
} from '@/lib/api-utils';

/**
 * GET /api/master/uom
 * Retrieves all UOMs ordered by code
 */
export async function GET() {
  try {
    const uoms = await prisma.uOM.findMany({
      orderBy: {
        code: 'asc',
      },
    });
    return NextResponse.json(uoms);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/master/uom
 * Creates a new UOM
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

    // Create UOM
    const uom = await prisma.uOM.create({
      data,
    });

    return NextResponse.json(uom, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
