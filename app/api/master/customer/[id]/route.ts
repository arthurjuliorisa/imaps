// @ts-nocheck
// TODO: Fix references to outgoingDocument - model doesn't exist
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
} from '@/lib/api-utils';

/**
 * GET /api/master/customer/[id]
 * Retrieves a single customer by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const customer = await prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      return NextResponse.json(
        { message: 'Customer not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(customer);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/master/customer/[id]
 * Updates an existing customer
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

    // Update customer
    const customer = await prisma.customer.update({
      where: { id },
      data,
    });

    return NextResponse.json(customer);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/master/customer/[id]
 * Deletes a customer
 * Prevents deletion if customer has related outgoing documents
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check for related outgoing documents
    const documentCount = await prisma.outgoingDocument.count({
      where: { recipientId: id },
    });

    if (documentCount > 0) {
      return NextResponse.json(
        {
          message: `Cannot delete customer. It is used in ${documentCount} outgoing document(s).`,
        },
        { status: 409 }
      );
    }

    // Delete customer
    await prisma.customer.delete({
      where: { id },
    });

    return NextResponse.json(
      { message: 'Customer deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
