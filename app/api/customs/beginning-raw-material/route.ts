import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  parseAndNormalizeDate,
  validateDateNotFuture,
  sanitizeRemarks,
  validatePositiveNumber,
  validateItemType,
  ValidationError,
} from '@/lib/api-utils';

/**
 * Helper function to recalculate mutation records after beginning stock changes
 * @param tx - Prisma transaction client
 * @param itemId - Item ID to recalculate
 * @param fromDate - Date to start recalculation from
 * @param newBeginningBalance - New beginning balance to use
 */
async function recalculateMutationRecords(
  tx: Prisma.TransactionClient,
  itemId: string,
  fromDate: Date,
  newBeginningBalance: number
): Promise<void> {
  // Get the first mutation record on or after the beginning date
  const firstMutation = await tx.rawMaterialMutation.findFirst({
    where: {
      itemId,
      date: { gte: fromDate },
    },
    orderBy: { date: 'asc' },
  });

  if (!firstMutation) {
    // No mutation records to update
    return;
  }

  // Update the first mutation's beginning balance
  const newEnding = newBeginningBalance + firstMutation.incoming - firstMutation.outgoing + firstMutation.adjustment;

  await tx.rawMaterialMutation.update({
    where: { id: firstMutation.id },
    data: {
      beginning: newBeginningBalance,
      ending: newEnding,
      variant: firstMutation.stockOpname > 0 ? firstMutation.stockOpname - newEnding : 0,
    },
  });

  // Get all subsequent mutation records
  const subsequentMutations = await tx.rawMaterialMutation.findMany({
    where: {
      itemId,
      date: { gt: firstMutation.date },
    },
    orderBy: { date: 'asc' },
  });

  // Update all subsequent records sequentially to avoid transaction conflicts
  let runningEnding = newEnding;

  for (let i = 0; i < subsequentMutations.length; i++) {
    const mutation = subsequentMutations[i];
    const newBeginning = runningEnding;
    const calculatedEnding = newBeginning + mutation.incoming - mutation.outgoing + mutation.adjustment;

    await tx.rawMaterialMutation.update({
      where: { id: mutation.id },
      data: {
        beginning: newBeginning,
        ending: calculatedEnding,
        variant: mutation.stockOpname > 0 ? mutation.stockOpname - calculatedEnding : 0,
      },
    });

    runningEnding = calculatedEnding;
  }
}

/**
 * GET /api/customs/beginning-raw-material
 * Fetch beginning stock records for raw materials with filtering
 *
 * Query Parameters:
 * - itemCode: Filter by item code (partial match)
 * - itemName: Filter by item name (partial match)
 * - startDate: Filter beginning date >= startDate
 * - endDate: Filter beginning date <= endDate
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const itemCode = searchParams.get('itemCode');
    const itemName = searchParams.get('itemName');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build where clause with proper typing
    const where: Prisma.BeginningStockWhereInput = {
      type: 'RAW_MATERIAL',
    };

    // Item filtering - use proper nested where with OR logic for search
    if (itemCode || itemName) {
      const itemFilters: Prisma.ItemWhereInput = {};

      // If both are the same (from search box), use OR logic
      if (itemCode && itemName && itemCode === itemName) {
        where.item = {
          OR: [
            { code: { contains: itemCode } },
            { name: { contains: itemName } },
          ],
        };
      } else {
        // If different, use AND logic
        if (itemCode) {
          itemFilters.code = { contains: itemCode };
        }
        if (itemName) {
          itemFilters.name = { contains: itemName };
        }
        where.item = itemFilters;
      }
    }

    // Date filtering
    if (startDate || endDate) {
      const dateFilter: Prisma.DateTimeFilter = {};
      if (startDate) {
        try {
          dateFilter.gte = parseAndNormalizeDate(startDate);
        } catch (error) {
          return NextResponse.json(
            { message: 'Invalid startDate format' },
            { status: 400 }
          );
        }
      }
      if (endDate) {
        try {
          dateFilter.lte = parseAndNormalizeDate(endDate);
        } catch (error) {
          return NextResponse.json(
            { message: 'Invalid endDate format' },
            { status: 400 }
          );
        }
      }
      where.beginningDate = dateFilter;
    }

    const beginningStocks = await prisma.beginningStock.findMany({
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
      orderBy: { beginningDate: 'desc' },
    });

    // Secondary sort by item code in JavaScript
    beginningStocks.sort((a, b) => {
      const dateA = new Date(a.beginningDate).getTime();
      const dateB = new Date(b.beginningDate).getTime();
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      return (a.item?.code || '').localeCompare(b.item?.code || '');
    });

    return NextResponse.json(beginningStocks);
  } catch (error: unknown) {
    console.error('[API Error] Failed to fetch beginning raw material stocks:', error);

    if (error instanceof Error) {
      console.error('[API Error] Error stack:', error.stack);
    }

    return NextResponse.json(
      {
        message: 'Error fetching beginning stock records',
        ...(process.env.NODE_ENV === 'development' && error instanceof Error && { error: error.message }),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customs/beginning-raw-material
 * Create a new beginning stock record for raw material
 *
 * Request Body:
 * - itemId: string (required)
 * - uomId: string (required)
 * - beginningBalance: number (required, must be > 0)
 * - beginningDate: string (required, ISO date format)
 * - remarks: string (optional, max 1000 chars)
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { itemId, uomId, beginningBalance, beginningDate, remarks } = body;

    // Validate required fields
    if (!itemId || !uomId || beginningBalance === undefined || beginningBalance === null || !beginningDate) {
      return NextResponse.json(
        { message: 'Missing required fields: itemId, uomId, beginningBalance, and beginningDate are required' },
        { status: 400 }
      );
    }

    // Validate and normalize date
    let normalizedDate: Date;
    try {
      normalizedDate = parseAndNormalizeDate(beginningDate);
      validateDateNotFuture(normalizedDate);
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message || 'Invalid date' },
        { status: 400 }
      );
    }

    // Validate beginning balance
    let balanceValue: number;
    try {
      balanceValue = validatePositiveNumber(beginningBalance, 'Beginning balance');
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Sanitize remarks
    let sanitizedRemarks: string | null = null;
    try {
      sanitizedRemarks = sanitizeRemarks(remarks);
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Validate item exists and is of type RAW_MATERIAL
    try {
      await validateItemType(prisma, itemId, 'RM');
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Validate UOM exists
    const uomExists = await prisma.uOM.findUnique({
      where: { id: uomId },
    });

    if (!uomExists) {
      return NextResponse.json(
        { message: 'Invalid uomId: UOM does not exist' },
        { status: 400 }
      );
    }

    // Create beginning stock record and update mutation records in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Check for duplicate (same item + date + type)
      const existing = await tx.beginningStock.findFirst({
        where: {
          type: 'RAW_MATERIAL',
          itemId,
          beginningDate: normalizedDate,
        },
      });

      if (existing) {
        throw new ValidationError('A beginning stock record for this item and date already exists');
      }

      // Create the beginning stock record
      const beginningStock = await tx.beginningStock.create({
        data: {
          type: 'RAW_MATERIAL',
          itemId,
          uomId,
          beginningBalance: balanceValue,
          beginningDate: normalizedDate,
          remarks: sanitizedRemarks,
        },
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

      // Recalculate affected mutation records
      await recalculateMutationRecords(tx, itemId, normalizedDate, balanceValue);

      return beginningStock;
    }, {
      isolationLevel: 'Serializable' as const,
      timeout: 10000,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: unknown) {
    console.error('[API Error] Failed to create beginning stock record:', error);

    if (error instanceof Error) {
      console.error('[API Error] Error stack:', error.stack);
    }

    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Handle Prisma errors
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === 'P2002') {
        return NextResponse.json(
          { message: 'A beginning stock record with this combination already exists' },
          { status: 400 }
        );
      }

      if (error.code === 'P2003') {
        return NextResponse.json(
          { message: 'Invalid itemId or uomId: Foreign key constraint failed' },
          { status: 400 }
        );
      }

      if (error.code === 'P2025') {
        return NextResponse.json(
          { message: 'Record not found' },
          { status: 404 }
        );
      }

      if (error.code === 'P2034') {
        return NextResponse.json(
          { message: 'Transaction conflict detected. Please retry your request.' },
          { status: 409 }
        );
      }
    }

    return NextResponse.json(
      {
        message: 'Error creating beginning stock record',
        ...(process.env.NODE_ENV === 'development' && error instanceof Error && { error: error.message }),
      },
      { status: 500 }
    );
  }
}
