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
 * Sanitize and validate remarks input
 */
function sanitizeRemarks(remarks: string | null | undefined): string | null {
  if (!remarks) return null;

  // Trim whitespace
  const trimmed = remarks.trim();
  if (trimmed.length === 0) return null;

  // Validate max length (1000 characters)
  if (trimmed.length > 1000) {
    throw new Error('Remarks must not exceed 1000 characters');
  }

  // Sanitize to prevent XSS - escape HTML entities
  return validator.escape(trimmed);
}

/**
 * GET /api/customs/wip/[id]
 * Get a single WIP record by ID with full relations
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const wipRecord = await prisma.wIPRecord.findUnique({
      where: { id },
      include: {
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
      },
    });

    if (!wipRecord) {
      return NextResponse.json(
        { message: 'WIP record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(wipRecord);
  } catch (error) {
    console.error('[API Error] Failed to fetch WIP record:', error);
    return NextResponse.json(
      { message: 'Error fetching WIP record' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/customs/wip/[id]
 * Update a WIP record
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { date, itemId, uomId, quantity, remarks } = body;

    // Check if record exists
    const existing = await prisma.wIPRecord.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'WIP record not found' },
        { status: 404 }
      );
    }

    // Validate required fields
    if (!date || !itemId || !uomId || quantity === undefined || quantity === null) {
      return NextResponse.json(
        { message: 'Missing required fields: date, itemId, uomId, and quantity are required' },
        { status: 400 }
      );
    }

    // Validate and normalize date
    let normalizedDate: Date;
    try {
      normalizedDate = parseAndNormalizeDate(date);
    } catch (error) {
      return NextResponse.json(
        { message: 'Invalid date format' },
        { status: 400 }
      );
    }

    // Validate date is not in the future
    const now = new Date();
    const today = new Date(Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0
    ));

    if (normalizedDate > today) {
      return NextResponse.json(
        { message: 'Date cannot be in the future' },
        { status: 400 }
      );
    }

    // Validate quantity is a positive number
    const quantityValue = parseFloat(String(quantity));
    if (isNaN(quantityValue) || quantityValue <= 0) {
      return NextResponse.json(
        { message: 'Quantity must be a positive number greater than 0' },
        { status: 400 }
      );
    }

    // Sanitize and validate remarks
    let sanitizedRemarks: string | null = null;
    try {
      sanitizedRemarks = sanitizeRemarks(remarks);
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Validate foreign keys exist
    const [itemExists, uomExists] = await Promise.all([
      prisma.item.findUnique({ where: { id: itemId } }),
      prisma.uOM.findUnique({ where: { id: uomId } }),
    ]);

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

    // Update the WIP record
    const wipRecord = await prisma.wIPRecord.update({
      where: { id },
      data: {
        date: normalizedDate,
        itemId,
        uomId,
        quantity: quantityValue,
        remarks: sanitizedRemarks,
      },
      include: {
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
      },
    });

    return NextResponse.json(wipRecord);
  } catch (error: any) {
    console.error('[API Error] Failed to update WIP record:', error);

    // Handle Prisma errors
    if (error.code === 'P2002') {
      return NextResponse.json(
        { message: 'A WIP record for this date already exists' },
        { status: 400 }
      );
    }

    if (error.code === 'P2003') {
      return NextResponse.json(
        { message: 'Foreign key constraint failed: Invalid itemId or uomId' },
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
        { message: 'WIP record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error updating WIP record' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/wip/[id]
 * Delete a WIP record
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Check if record exists
    const existing = await prisma.wIPRecord.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'WIP record not found' },
        { status: 404 }
      );
    }

    // Delete the record
    await prisma.wIPRecord.delete({
      where: { id },
    });

    return NextResponse.json({
      message: 'WIP record deleted successfully',
    });
  } catch (error: any) {
    console.error('[API Error] Failed to delete WIP record:', error);

    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'WIP record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error deleting WIP record' },
      { status: 500 }
    );
  }
}
