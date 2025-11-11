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
 * GET /api/customs/wip
 * Fetch WIP records with date range filtering
 * Query params: startDate, endDate
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build where clause for date filtering
    const where: any = {};

    // Default to last 30 days if no dates specified
    if (!startDate && !endDate) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      where.date = { gte: parseAndNormalizeDate(thirtyDaysAgo) };
    } else if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = parseAndNormalizeDate(startDate);
      }
      if (endDate) {
        where.date.lte = parseAndNormalizeDate(endDate);
      }
    }

    // Fetch WIP records with relations
    const wipRecords = await prisma.wIPRecord.findMany({
      where,
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
      orderBy: {
        date: 'desc',
      },
    });

    // Transform response with flattened relations
    const transformedData = wipRecords.map((record) => ({
      ...record,
      itemCode: record.item.code,
      itemName: record.item.name,
      itemType: record.item.type,
      uomCode: record.uom.code,
      uomName: record.uom.name,
    }));

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error('[API Error] Failed to fetch WIP records:', error);
    return NextResponse.json(
      { message: 'Error fetching WIP records' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customs/wip
 * Create a new WIP record
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { date, itemId, uomId, quantity, remarks } = body;

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

    // Create the WIP record
    const wipRecord = await prisma.wIPRecord.create({
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

    return NextResponse.json(wipRecord, { status: 201 });
  } catch (error: any) {
    console.error('[API Error] Failed to create WIP record:', error);

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

    return NextResponse.json(
      { message: 'Error creating WIP record' },
      { status: 500 }
    );
  }
}
