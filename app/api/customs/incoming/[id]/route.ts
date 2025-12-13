// @ts-nocheck
// TODO: This file needs to be rewritten - incomingDocument model doesn't exist
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import validator from 'validator';

/**
 * Parse and normalize date to UTC midnight to avoid timezone issues
 */
function parseAndNormalizeDate(dateInput: string | Date): Date {
  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date format');
  }

  // Normalize to UTC midnight
  return new Date(Date.UTC(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    0, 0, 0, 0
  ));
}

/**
 * GET /api/customs/incoming/[id]
 * Get a single incoming document by ID with full relations
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const document = await prisma.incomingDocument.findUnique({
      where: { id },
      include: {
        Supplier: {
          select: {
            id: true,
            code: true,
            name: true,
            address: true,
          },
        },
        Item: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        UOM: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        Currency: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!document) {
      return NextResponse.json(
        { message: 'Incoming document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(document);
  } catch (error) {
    console.error('[API Error] Failed to fetch incoming document:', error);
    return NextResponse.json(
      { message: 'Error fetching incoming document' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/customs/incoming/[id]
 * Update an incoming document
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const {
      docCode,
      registerNumber,
      registerDate,
      docNumber,
      docDate,
      shipperId,
      itemId,
      uomId,
      quantity,
      currencyId,
      amount,
    } = body;

    // Check if document exists
    const existing = await prisma.incomingDocument.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Incoming document not found' },
        { status: 404 }
      );
    }

    // Validate required fields
    if (!docCode || !registerNumber || !registerDate || !docNumber || !docDate ||
        !shipperId || !itemId || !uomId || quantity === undefined || !currencyId || amount === undefined) {
      return NextResponse.json(
        { message: 'All fields are required: docCode, registerNumber, registerDate, docNumber, docDate, shipperId, itemId, uomId, quantity, currencyId, amount' },
        { status: 400 }
      );
    }

    // Validate and normalize dates
    let normalizedRegisterDate: Date;
    let normalizedDocDate: Date;
    try {
      normalizedRegisterDate = parseAndNormalizeDate(registerDate);
      normalizedDocDate = parseAndNormalizeDate(docDate);
    } catch (error) {
      return NextResponse.json(
        { message: 'Invalid date format for registerDate or docDate' },
        { status: 400 }
      );
    }

    // Validate dates are not in the future
    const now = new Date();
    const today = new Date(Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0
    ));

    if (normalizedRegisterDate > today || normalizedDocDate > today) {
      return NextResponse.json(
        { message: 'Dates cannot be in the future' },
        { status: 400 }
      );
    }

    // Validate quantity and amount are positive numbers
    const quantityValue = parseFloat(String(quantity));
    const amountValue = parseFloat(String(amount));

    if (isNaN(quantityValue) || quantityValue <= 0) {
      return NextResponse.json(
        { message: 'Quantity must be a positive number greater than 0' },
        { status: 400 }
      );
    }

    if (isNaN(amountValue) || amountValue <= 0) {
      return NextResponse.json(
        { message: 'Amount must be a positive number greater than 0' },
        { status: 400 }
      );
    }

    // Sanitize string inputs
    const sanitizedDocCode = validator.escape(docCode.trim());
    const sanitizedRegisterNumber = validator.escape(registerNumber.trim());
    const sanitizedDocNumber = validator.escape(docNumber.trim());

    // Validate foreign keys exist
    const [shipperExists, itemExists, uomExists, currencyExists] = await Promise.all([
      prisma.supplier.findUnique({ where: { id: shipperId } }),
      prisma.item.findUnique({ where: { id: itemId } }),
      prisma.uOM.findUnique({ where: { id: uomId } }),
      prisma.currency.findUnique({ where: { id: currencyId } }),
    ]);

    if (!shipperExists) {
      return NextResponse.json(
        { message: 'Invalid shipperId: Supplier does not exist' },
        { status: 400 }
      );
    }

    if (!itemExists) {
      return NextResponse.json(
        { message: 'Invalid itemId: Item does not exist' },
        { status: 400 }
      );
    }

    if (!uomExists) {
      return NextResponse.json(
        { message: 'Invalid uomId: UOM does not exist' },
        { status: 400 }
      );
    }

    if (!currencyExists) {
      return NextResponse.json(
        { message: 'Invalid currencyId: Currency does not exist' },
        { status: 400 }
      );
    }

    // Update the document
    const document = await prisma.incomingDocument.update({
      where: { id },
      data: {
        docCode: sanitizedDocCode,
        registerNumber: sanitizedRegisterNumber,
        registerDate: normalizedRegisterDate,
        docNumber: sanitizedDocNumber,
        docDate: normalizedDocDate,
        shipperId,
        itemId,
        uomId,
        quantity: quantityValue,
        currencyId,
        amount: amountValue,
      },
      include: {
        Supplier: {
          select: {
            code: true,
            name: true,
          },
        },
        Item: {
          select: {
            code: true,
            name: true,
          },
        },
        UOM: {
          select: {
            code: true,
            name: true,
          },
        },
        Currency: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json(document);
  } catch (error: any) {
    console.error('[API Error] Failed to update incoming document:', error);

    // Handle Prisma errors
    if (error.code === 'P2003') {
      return NextResponse.json(
        { message: 'Foreign key constraint failed: Invalid shipperId, itemId, uomId, or currencyId' },
        { status: 400 }
      );
    }

    if (error.code === 'P2000') {
      return NextResponse.json(
        { message: 'Value provided is too long for the column' },
        { status: 400 }
      );
    }

    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Incoming document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error updating incoming document' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/incoming/[id]
 * Delete an incoming document
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Check if document exists
    const existing = await prisma.incomingDocument.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Incoming document not found' },
        { status: 404 }
      );
    }

    // Delete the document
    await prisma.incomingDocument.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'Incoming document deleted successfully',
    });
  } catch (error: any) {
    console.error('[API Error] Failed to delete incoming document:', error);

    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Incoming document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error deleting incoming document' },
      { status: 500 }
    );
  }
}
