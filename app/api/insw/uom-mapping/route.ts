import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const isActive = searchParams.get('is_active');

    let query = 'SELECT id, wms_uom, insw_uom, description, is_active, created_at, updated_at FROM insw_uom_mapping WHERE 1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (search) {
      query += ` AND (wms_uom ILIKE $${paramIdx} OR insw_uom ILIKE $${paramIdx} OR description ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    if (isActive !== null && isActive !== undefined) {
      query += ` AND is_active = $${paramIdx}`;
      params.push(isActive === 'true');
      paramIdx++;
    }

    query += ' ORDER BY wms_uom ASC';

    const data = await prisma.$queryRawUnsafe(query, ...params);

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Error fetching INSW UOM mappings:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch UOM mappings' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const body = await request.json();
    const { wms_uom, insw_uom, description, is_active = true } = body;

    if (!wms_uom || !insw_uom) {
      return NextResponse.json(
        { success: false, error: 'WMS UOM and INSW UOM are required' },
        { status: 400 }
      );
    }

    const normalizedWmsUom = wms_uom.toUpperCase();
    const normalizedInswUom = insw_uom.toUpperCase();

    const existing = await prisma.$queryRawUnsafe<any[]>(
      'SELECT id FROM insw_uom_mapping WHERE wms_uom = $1',
      normalizedWmsUom
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: `Mapping for WMS UOM "${normalizedWmsUom}" already exists` },
        { status: 409 }
      );
    }

    const result = await prisma.$queryRawUnsafe<any[]>(
      `INSERT INTO insw_uom_mapping (wms_uom, insw_uom, description, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       RETURNING id, wms_uom, insw_uom, description, is_active, created_at, updated_at`,
      normalizedWmsUom,
      normalizedInswUom,
      description || null,
      is_active
    );

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error: any) {
    console.error('Error creating INSW UOM mapping:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to create UOM mapping' },
      { status: 500 }
    );
  }
}
