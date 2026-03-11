import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const rows = await prisma.$queryRawUnsafe<any[]>(
      'SELECT id, wms_uom, insw_uom, description, is_active, created_at, updated_at FROM insw_uom_mapping WHERE id = $1',
      id
    );

    if (rows.length === 0) {
      return NextResponse.json({ success: false, error: 'UOM mapping not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: rows[0] });
  } catch (error: any) {
    console.error('Error fetching UOM mapping:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to fetch UOM mapping' },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const body = await request.json();
    const { insw_uom, description, is_active } = body;

    const existing = await prisma.$queryRawUnsafe<any[]>(
      'SELECT id FROM insw_uom_mapping WHERE id = $1',
      id
    );
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'UOM mapping not found' }, { status: 404 });
    }

    const setClauses: string[] = [];
    const values: any[] = [];
    let paramIdx = 1;

    if (insw_uom !== undefined) {
      setClauses.push(`insw_uom = $${paramIdx++}`);
      values.push(insw_uom.toUpperCase());
    }
    if (description !== undefined) {
      setClauses.push(`description = $${paramIdx++}`);
      values.push(description);
    }
    if (is_active !== undefined) {
      setClauses.push(`is_active = $${paramIdx++}`);
      values.push(is_active);
    }
    setClauses.push(`updated_at = NOW()`);

    values.push(id);
    const result = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE insw_uom_mapping SET ${setClauses.join(', ')} WHERE id = $${paramIdx}
       RETURNING id, wms_uom, insw_uom, description, is_active, created_at, updated_at`,
      ...values
    );

    return NextResponse.json({ success: true, data: result[0] });
  } catch (error: any) {
    console.error('Error updating UOM mapping:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to update UOM mapping' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { id: idParam } = await params;
    const id = parseInt(idParam, 10);
    if (isNaN(id)) {
      return NextResponse.json({ success: false, error: 'Invalid ID' }, { status: 400 });
    }

    const existing = await prisma.$queryRawUnsafe<any[]>(
      'SELECT id FROM insw_uom_mapping WHERE id = $1',
      id
    );
    if (existing.length === 0) {
      return NextResponse.json({ success: false, error: 'UOM mapping not found' }, { status: 404 });
    }

    await prisma.$executeRawUnsafe('DELETE FROM insw_uom_mapping WHERE id = $1', id);

    return NextResponse.json({ success: true, message: 'UOM mapping deleted' });
  } catch (error: any) {
    console.error('Error deleting UOM mapping:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete UOM mapping' },
      { status: 500 }
    );
  }
}
