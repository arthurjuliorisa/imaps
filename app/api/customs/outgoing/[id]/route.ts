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
 * GET /api/customs/outgoing/[id]
 * Get a single outgoing document by ID with full relations
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const document = await prisma.outgoingDocument.findUnique({
      where: { id },
      include: {
        recipient: {
          select: {
            id: true,
            code: true,
            name: true,
            address: true,
          },
        },
        item: {
          select: {
            id: true,
            code: true,
            name: true,
            type: true,
          },
        },
        uom: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
        currency: {
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
        { message: 'Outgoing document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(document);
  } catch (error) {
    console.error('[API Error] Failed to fetch outgoing document:', error);
    return NextResponse.json(
      { message: 'Error fetching outgoing document' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/customs/outgoing/[id]
 * Update an outgoing document
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
      recipientId,
      itemId,
      uomId,
      quantity,
      currencyId,
      amount,
    } = body;

    // Check if document exists
    const existing = await prisma.outgoingDocument.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Outgoing document not found' },
        { status: 404 }
      );
    }

    // Validate required fields
    if (!docCode || !registerNumber || !registerDate || !docNumber || !docDate ||
        !recipientId || !itemId || !uomId || quantity === undefined || !currencyId || amount === undefined) {
      return NextResponse.json(
        { message: 'All fields are required: docCode, registerNumber, registerDate, docNumber, docDate, recipientId, itemId, uomId, quantity, currencyId, amount' },
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
    const [recipientExists, itemExists, uomExists, currencyExists] = await Promise.all([
      prisma.customer.findUnique({ where: { id: recipientId } }),
      prisma.item.findUnique({ where: { id: itemId } }),
      prisma.uOM.findUnique({ where: { id: uomId } }),
      prisma.currency.findUnique({ where: { id: currencyId } }),
    ]);

    if (!recipientExists) {
      return NextResponse.json(
        { message: 'Invalid recipientId: Customer does not exist' },
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
    const document = await prisma.outgoingDocument.update({
      where: { id },
      data: {
        docCode: sanitizedDocCode,
        registerNumber: sanitizedRegisterNumber,
        registerDate: normalizedRegisterDate,
        docNumber: sanitizedDocNumber,
        docDate: normalizedDocDate,
        recipientId,
        itemId,
        uomId,
        quantity: quantityValue,
        currencyId,
        amount: amountValue,
      },
      include: {
        recipient: {
          select: {
            code: true,
            name: true,
          },
        },
        item: {
          select: {
            code: true,
            name: true,
            type: true,
          },
        },
        uom: {
          select: {
            code: true,
            name: true,
          },
        },
        currency: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });

    return NextResponse.json(document);
  } catch (error: any) {
    console.error('[API Error] Failed to update outgoing document:', error);

    // Handle Prisma errors
    if (error.code === 'P2003') {
      return NextResponse.json(
        { message: 'Foreign key constraint failed: Invalid recipientId, itemId, uomId, or currencyId' },
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
        { message: 'Outgoing document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error updating outgoing document' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/outgoing/[id]
 * Delete an outgoing document
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Check if document exists
    const existing = await prisma.outgoingDocument.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Outgoing document not found' },
        { status: 404 }
      );
    }

    // Delete the document
    await prisma.outgoingDocument.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'Outgoing document deleted successfully',
    });
  } catch (error: any) {
    console.error('[API Error] Failed to delete outgoing document:', error);

    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Outgoing document not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error deleting outgoing document' },
      { status: 500 }
    );
  }
}
