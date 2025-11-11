import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
} from '@/lib/api-utils';

/**
 * GET /api/master/supplier/[id]
 * Retrieves a single supplier by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supplier = await prisma.supplier.findUnique({
      where: { id },
    });

    if (!supplier) {
      return NextResponse.json(
        { message: 'Supplier not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(supplier);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/master/supplier/[id]
 * Updates an existing supplier
 *
 * Request body:
 * - code: string (required, unique)
 * - name: string (required)
 * - address: string (optional)
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
      address: body.address || null,
    });

    // Update supplier
    const supplier = await prisma.supplier.update({
      where: { id },
      data,
    });

    return NextResponse.json(supplier);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/master/supplier/[id]
 * Deletes a supplier
 * Prevents deletion if supplier has related incoming documents
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check for related incoming documents
    const documentCount = await prisma.incomingDocument.count({
      where: { shipperId: id },
    });

    if (documentCount > 0) {
      return NextResponse.json(
        {
          message: `Cannot delete supplier. It is used in ${documentCount} incoming document(s).`,
        },
        { status: 409 }
      );
    }

    // Delete supplier
    await prisma.supplier.delete({
      where: { id },
    });

    return NextResponse.json(
      { message: 'Supplier deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
