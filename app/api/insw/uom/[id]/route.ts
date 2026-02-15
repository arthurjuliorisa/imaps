import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/insw/uom/[id]
 * Get single INSW UOM by ID
 */
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
      return NextResponse.json(
        { success: false, error: 'Invalid ID' },
        { status: 400 }
      );
    }

    const uom = await prisma.insw_uom_reference.findUnique({
      where: { id },
    });

    if (!uom) {
      return NextResponse.json(
        { success: false, error: 'UOM not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      data: uom,
    });
  } catch (error: any) {
    console.error('Error fetching INSW UOM:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to fetch INSW UOM',
      },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/insw/uom/[id]
 * Update INSW UOM by ID
 */
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
      return NextResponse.json(
        { success: false, error: 'Invalid ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { kode, uraian, is_active } = body;

    // Check if UOM exists
    const existing = await prisma.insw_uom_reference.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'UOM not found' },
        { status: 404 }
      );
    }

    // If kode is being changed, check for duplicates
    if (kode && kode !== existing.kode) {
      const duplicate = await prisma.insw_uom_reference.findUnique({
        where: { kode },
      });

      if (duplicate) {
        return NextResponse.json(
          {
            success: false,
            error: `UOM with code "${kode}" already exists`,
          },
          { status: 409 }
        );
      }
    }

    const updateData: any = {};
    if (kode !== undefined) updateData.kode = kode;
    if (uraian !== undefined) updateData.uraian = uraian;
    if (is_active !== undefined) updateData.is_active = is_active;

    const uom = await prisma.insw_uom_reference.update({
      where: { id },
      data: updateData,
    });

    return NextResponse.json({
      success: true,
      data: uom,
    });
  } catch (error: any) {
    console.error('Error updating INSW UOM:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to update INSW UOM',
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/insw/uom/[id]
 * Delete INSW UOM by ID
 */
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
      return NextResponse.json(
        { success: false, error: 'Invalid ID' },
        { status: 400 }
      );
    }

    // Check if UOM exists
    const existing = await prisma.insw_uom_reference.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'UOM not found' },
        { status: 404 }
      );
    }

    await prisma.insw_uom_reference.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'UOM deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting INSW UOM:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to delete INSW UOM',
      },
      { status: 500 }
    );
  }
}
