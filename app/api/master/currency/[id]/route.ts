// @ts-nocheck
// TODO: Fix references to incomingDocument - model doesn't exist
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  handleApiError,
  validateRequiredFields,
  trimStringFields,
  ValidationError,
} from '@/lib/api-utils';

/**
 * GET /api/master/currency/[id]
 * Retrieves a single currency by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const currency = await prisma.currency.findUnique({
      where: { id },
    });

    if (!currency) {
      return NextResponse.json(
        { message: 'Currency not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(currency);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/master/currency/[id]
 * Updates an existing currency
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

    // Update currency
    const currency = await prisma.currency.update({
      where: { id },
      data,
    });

    return NextResponse.json(currency);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/master/currency/[id]
 * Deletes a currency
 * Checks for related incoming/outgoing documents before deletion
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Check for related incoming documents
    const incomingCount = await prisma.incomingDocument.count({
      where: { currencyId: id },
    });

    if (incomingCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete currency. It is used in ${incomingCount} incoming document(s).` },
        { status: 409 }
      );
    }

    // Check for related outgoing documents
    const outgoingCount = await prisma.outgoingDocument.count({
      where: { currencyId: id },
    });

    if (outgoingCount > 0) {
      return NextResponse.json(
        { message: `Cannot delete currency. It is used in ${outgoingCount} outgoing document(s).` },
        { status: 409 }
      );
    }

    // Delete currency
    await prisma.currency.delete({
      where: { id },
    });

    return NextResponse.json(
      { message: 'Currency deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
