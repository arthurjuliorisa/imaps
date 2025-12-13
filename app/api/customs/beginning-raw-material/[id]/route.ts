// @ts-nocheck
// TODO: This file needs to be rewritten to match the current database schema
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
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
 */
async function recalculateMutationRecords(
  tx: any,
  itemId: string,
  fromDate: Date,
  newBeginningBalance: number
): Promise<void> {
  const firstMutation = await tx.rawMaterialMutation.findFirst({
    where: {
      itemId,
      date: { gte: fromDate },
    },
    orderBy: { date: 'asc' },
  });

  if (!firstMutation) {
    return;
  }

  const newEnding = newBeginningBalance + firstMutation.incoming - firstMutation.outgoing + firstMutation.adjustment;

  await tx.rawMaterialMutation.update({
    where: { id: firstMutation.id },
    data: {
      beginning: newBeginningBalance,
      ending: newEnding,
      variant: firstMutation.stockOpname > 0 ? firstMutation.stockOpname - newEnding : 0,
    },
  });

  const subsequentMutations = await tx.rawMaterialMutation.findMany({
    where: {
      itemId,
      date: { gt: firstMutation.date },
    },
    orderBy: { date: 'asc' },
  });

  let runningEnding = newEnding;
  for (const mutation of subsequentMutations) {
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
 * GET /api/customs/beginning-raw-material/[id]
 * Get a single beginning stock record by ID with full relations
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    const beginningStock = await prisma.beginning_balances.findUnique({
      where: { id },
      include: {
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
      },
    });

    if (!beginningStock) {
      return NextResponse.json(
        { message: 'Beginning stock record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(beginningStock);
  } catch (error) {
    console.error('[API Error] Failed to fetch beginning stock record:', error);
    return NextResponse.json(
      { message: 'Error fetching beginning stock record' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/customs/beginning-raw-material/[id]
 * Update a beginning stock record
 *
 * Request Body:
 * - itemId: string (required)
 * - uomId: string (required)
 * - beginningBalance: number (required, must be > 0)
 * - beginningDate: string (required, ISO date format)
 * - remarks: string (optional, max 1000 chars)
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const body = await request.json();
    const { itemId, uomId, beginningBalance, beginningDate, remarks } = body;

    // Check if record exists
    const existing = await prisma.beginning_balances.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Beginning stock record not found' },
        { status: 404 }
      );
    }

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
    let item: any;
    try {
      item = await validateItemType(prisma, itemId, 'RM');
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

    // Update beginning stock record and recalculate mutation records in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Check for duplicate if item or date changed
      if (itemId !== existing.itemId || normalizedDate.getTime() !== existing.beginningDate.getTime()) {
        const duplicate = await tx.beginningStock.findFirst({
          where: {
            itemId,
            beginningDate: normalizedDate,
            id: { not: id },
          },
        });

        if (duplicate) {
          throw new ValidationError('A beginning stock record for this item and date already exists');
        }
      }

      // Update the beginning stock record
      const updated = await tx.beginningStock.update({
        where: { id },
        data: {
          itemId,
          uomId,
          beginningBalance: balanceValue,
          beginningDate: normalizedDate,
          remarks: sanitizedRemarks,
        },
        include: {
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
        },
      });

      // If date or balance changed, recalculate affected mutation records
      if (
        normalizedDate.getTime() !== existing.beginningDate.getTime() ||
        balanceValue !== existing.beginningBalance ||
        itemId !== existing.itemId
      ) {
        // If item changed, need to recalculate both old and new item
        if (itemId !== existing.itemId) {
          // Recalculate old item (use 0 as beginning balance)
          await recalculateMutationRecords(tx, existing.itemId, existing.beginningDate, 0);
        }

        // Recalculate new/current item
        await recalculateMutationRecords(tx, itemId, normalizedDate, balanceValue);
      }

      return updated;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10000,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[API Error] Failed to update beginning stock record:', error);

    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Handle Prisma errors
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
        { message: 'Beginning stock record not found' },
        { status: 404 }
      );
    }

    if (error.code === 'P2034') {
      return NextResponse.json(
        { message: 'Transaction conflict detected. Please retry your request.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { message: 'Error updating beginning stock record' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/beginning-raw-material/[id]
 * Delete a beginning stock record
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;

    // Check if record exists
    const existing = await prisma.beginning_balances.findUnique({
      where: { id },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Beginning stock record not found' },
        { status: 404 }
      );
    }

    // Delete record and recalculate mutation records in transaction
    await prisma.$transaction(async (tx) => {
      // Delete the beginning stock record
      await tx.beginningStock.delete({
        where: { id },
      });

      // Recalculate affected mutation records (use 0 as beginning balance)
      await recalculateMutationRecords(tx, existing.itemId, existing.beginningDate, 0);
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10000,
    });

    return NextResponse.json({
      message: 'Beginning stock record deleted successfully',
    });
  } catch (error: any) {
    console.error('[API Error] Failed to delete beginning stock record:', error);

    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Beginning stock record not found' },
        { status: 404 }
      );
    }

    if (error.code === 'P2034') {
      return NextResponse.json(
        { message: 'Transaction conflict detected. Please retry your request.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { message: 'Error deleting beginning stock record' },
      { status: 500 }
    );
  }
}
