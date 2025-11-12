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
 * GET /api/customs/incoming
 * Fetch incoming documents with date range filtering and pagination
 * Query params: startDate, endDate, page, pageSize
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const page = parseInt(searchParams.get('page') || '1');
    const pageSize = parseInt(searchParams.get('pageSize') || '50');

    // Validate pagination parameters
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { message: 'Invalid pagination parameters. Page must be >= 1, pageSize between 1-100' },
        { status: 400 }
      );
    }

    // Build where clause for date filtering
    const where: any = {};

    // Default to last 30 days if no dates specified
    if (!startDate && !endDate) {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      where.registerDate = { gte: parseAndNormalizeDate(thirtyDaysAgo) };
    } else if (startDate || endDate) {
      where.registerDate = {};
      if (startDate) {
        where.registerDate.gte = parseAndNormalizeDate(startDate);
      }
      if (endDate) {
        where.registerDate.lte = parseAndNormalizeDate(endDate);
      }
    }

    // Get total count for pagination
    const totalCount = await prisma.incomingDocument.count({ where });

    // Calculate pagination
    const totalPages = Math.ceil(totalCount / pageSize);
    const skip = (page - 1) * pageSize;

    // Fetch documents with relations
    const documents = await prisma.incomingDocument.findMany({
      where,
      include: {
        shipper: {
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
      orderBy: [
        { registerDate: 'desc' },
        { docNumber: 'desc' },
      ],
      skip,
      take: pageSize,
    });

    // Transform response with flattened relations
    const transformedData = documents.map((doc) => ({
      ...doc,
      qty: doc.quantity, // Transform quantity to qty for frontend
      shipper: doc.shipper.name, // Flatten for display
      uom: doc.uom.code, // Flatten for display
      currency: doc.currency.code, // Flatten for display
      shipperCode: doc.shipper.code,
      shipperName: doc.shipper.name,
      itemCode: doc.item.code,
      itemName: doc.item.name,
      itemType: doc.item.type,
      uomCode: doc.uom.code,
      uomName: doc.uom.name,
      currencyCode: doc.currency.code,
      currencyName: doc.currency.name,
    }));

    return NextResponse.json({
      data: transformedData,
      pagination: {
        totalCount,
        totalPages,
        currentPage: page,
        pageSize,
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch incoming documents:', error);
    return NextResponse.json(
      { message: 'Error fetching incoming documents' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customs/incoming
 * Create a new incoming document
 */
export async function POST(request: Request) {
  try {
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

    // Create the document
    const document = await prisma.incomingDocument.create({
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
        shipper: {
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

    return NextResponse.json(document, { status: 201 });
  } catch (error: any) {
    console.error('[API Error] Failed to create incoming document:', error);

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

    return NextResponse.json(
      { message: 'Error creating incoming document' },
      { status: 500 }
    );
  }
}
