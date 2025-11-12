import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
} from '@/lib/api-utils';

/**
 * GET /api/master/uom/[id]
 * Retrieves a single UOM by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const uom = await prisma.uOM.findUnique({
      where: { id },
    });

    if (!uom) {
      return NextResponse.json(
        { message: 'UOM not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(uom);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/master/uom/[id]
 * Updates an existing UOM
 *
 * Request body:
 * - code: string (required, unique)
 * - name: string (required)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Validate required fields
    validateRequiredFields(body, ['code', 'name']);

    // Trim string fields
    const data = trimStringFields({
      code: body.code,
      name: body.name,
    });

    // Update UOM
    const uom = await prisma.uOM.update({
      where: { id },
      data,
    });

    return NextResponse.json(uom);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/master/uom/[id]
 * Deletes a UOM
 * Checks for related records before deletion to prevent foreign key violations
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check for related items
    const itemCount = await prisma.item.count({
      where: { uomId: id },
    });

    if (itemCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete UOM. It is used in ${itemCount} item(s).` },
        { status: 409 }
      );
    }

    // Check for related incoming documents
    const incomingCount = await prisma.incomingDocument.count({
      where: { uomId: id },
    });

    if (incomingCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete UOM. It is used in ${incomingCount} incoming document(s).` },
        { status: 409 }
      );
    }

    // Check for related outgoing documents
    const outgoingCount = await prisma.outgoingDocument.count({
      where: { uomId: id },
    });

    if (outgoingCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete UOM. It is used in ${outgoingCount} outgoing document(s).` },
        { status: 409 }
      );
    }

    // Check for related raw material mutations
    const rawMaterialCount = await prisma.rawMaterialMutation.count({
      where: { uomId: id },
    });

    if (rawMaterialCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete UOM. It is used in ${rawMaterialCount} raw material mutation(s).` },
        { status: 409 }
      );
    }

    // Check for related production mutations
    const productionCount = await prisma.productionMutation.count({
      where: { uomId: id },
    });

    if (productionCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete UOM. It is used in ${productionCount} production mutation(s).` },
        { status: 409 }
      );
    }

    // Check for related scrap mutations
    const scrapCount = await prisma.scrapMutation.count({
      where: { uomId: id },
    });

    if (scrapCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete UOM. It is used in ${scrapCount} scrap mutation(s).` },
        { status: 409 }
      );
    }

    // Check for related capital goods mutations
    const capitalGoodsCount = await prisma.capitalGoodsMutation.count({
      where: { uomId: id },
    });

    if (capitalGoodsCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete UOM. It is used in ${capitalGoodsCount} capital goods mutation(s).` },
        { status: 409 }
      );
    }

    // Check for related WIP records
    const wipCount = await prisma.wIPRecord.count({
      where: { uomId: id },
    });

    if (wipCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete UOM. It is used in ${wipCount} WIP record(s).` },
        { status: 409 }
      );
    }

    // Delete UOM if no dependencies found
    await prisma.uOM.delete({
      where: { id },
    });

    return NextResponse.json(
      { message: 'UOM deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
