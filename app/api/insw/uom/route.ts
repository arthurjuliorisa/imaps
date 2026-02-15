import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';


/**
 * GET /api/insw/uom
 * Get all INSW UOM reference data with optional filters
 */
export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const isActive = searchParams.get('is_active');
    const limit = parseInt(searchParams.get('limit') || '1000', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    const where: any = {};

    if (search) {
      where.OR = [
        { kode: { contains: search, mode: 'insensitive' } },
        { uraian: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (isActive !== null && isActive !== undefined) {
      where.is_active = isActive === 'true';
    }

    const [data, total] = await Promise.all([
      prisma.insw_uom_reference.findMany({
        where,
        orderBy: { kode: 'asc' },
        take: limit,
        skip: offset,
      }),
      prisma.insw_uom_reference.count({ where }),
    ]);

    return NextResponse.json({
      success: true,
      data,
      total,
      limit,
      offset,
    });
  } catch (error: any) {
    console.error('Error fetching INSW UOM:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch INSW UOM data',
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/insw/uom
 * Create new INSW UOM reference
 */
export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const body = await request.json();
    const { kode, uraian, is_active = true } = body;

    if (!kode || !uraian) {
      return NextResponse.json(
        {
          success: false,
          error: 'Kode and Uraian are required',
        },
        { status: 400 }
      );
    }

    // Check if kode already exists
    const existing = await prisma.insw_uom_reference.findUnique({
      where: { kode },
    });

    if (existing) {
      return NextResponse.json(
        {
          success: false,
          error: `UOM with code "${kode}" already exists`,
        },
        { status: 409 }
      );
    }

    const uom = await prisma.insw_uom_reference.create({
      data: {
        kode,
        uraian,
        is_active,
      },
    });

    return NextResponse.json({
      success: true,
      data: uom,
    });
  } catch (error: any) {
    console.error('Error creating INSW UOM:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to create INSW UOM',
      },
      { status: 500 }
    );
  }
}
