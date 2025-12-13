// @ts-nocheck
// TODO: This file needs to be rewritten - rawMaterialMutation model doesn't exist
import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import validator from 'validator';
import { Prisma } from '@prisma/client';

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
 * GET /api/customs/raw-material
 * Fetch raw material mutations with date range filtering
 * Query params: startDate (ISO string), endDate (ISO string)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Build where clause for date filtering
    const where: any = {};

    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = parseAndNormalizeDate(startDate);
      }
      if (endDate) {
        where.date.lte = parseAndNormalizeDate(endDate);
      }
    }

    const rawMaterialMutations = await prisma.rawMaterialMutation.findMany({
      where,
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
      // FIX: Simplified orderBy to avoid nested relation issues in production
      orderBy: { date: 'desc' },
    });

    // Transform the response to include flattened item and UOM data
    const transformedData = rawMaterialMutations.map((mutation) => ({
      ...mutation,
      itemCode: mutation.Item.code,
      itemName: mutation.Item.name,
      uomCode: mutation.UOM.code,
      uomName: mutation.UOM.name,
      unit: mutation.UOM.code,
      // Fix property name mismatch: database uses 'incoming'/'outgoing' but component expects 'in'/'out'
      in: mutation.incoming,
      out: mutation.outgoing,
    }));

    // Secondary sort by item code (ascending) for records with the same date
    transformedData.sort((a, b) => {
      const dateA = new Date(a.date).getTime();
      const dateB = new Date(b.date).getTime();
      if (dateB !== dateA) {
        return dateB - dateA;
      }
      return a.itemCode.localeCompare(b.itemCode);
    });

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error('[API Error] Failed to fetch raw material mutations:', error);
    return NextResponse.json(
      { message: 'Error fetching raw material mutations' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customs/raw-material
 * Create a single INCOMING-only raw material mutation entry
 * Automatically fetches previous ending balance and calculates new ending
 *
 * FIXES APPLIED:
 * - Bug #1: Race condition prevention using Serializable transaction
 * - Bug #3: Recalculates all subsequent records for the item
 * - Bug #5, #12: Enhanced input validation
 * - Bug #14: Input sanitization for remarks
 * - Bug #16: Proper date normalization to UTC midnight
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      date,
      itemId,
      uomId,
      incoming,
      remarks,
    } = body;

    // Validate required fields
    if (!date || !itemId || !uomId || incoming === undefined || incoming === null) {
      return NextResponse.json(
        { message: 'Missing required fields: date, itemId, uomId, and incoming are required' },
        { status: 400 }
      );
    }

    // Validate and normalize date (Bug #16: timezone fix)
    let normalizedDate: Date;
    try {
      normalizedDate = parseAndNormalizeDate(date);
    } catch (error) {
      return NextResponse.json(
        { message: 'Invalid date format' },
        { status: 400 }
      );
    }

    // Validate date is not in the future (Bug #5)
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

    // Validate incoming is a positive number > 0, not just >= 0 (Bug #12)
    const incomingValue = parseFloat(String(incoming));
    if (isNaN(incomingValue) || incomingValue <= 0) {
      return NextResponse.json(
        { message: 'Invalid incoming value: must be a positive number greater than 0' },
        { status: 400 }
      );
    }

    // Sanitize and validate remarks (Bug #14)
    let sanitizedRemarks: string | null = null;
    try {
      sanitizedRemarks = sanitizeRemarks(remarks);
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Validate that itemId and uomId exist (moved inside transaction for consistency)
    // These checks are done outside transaction to fail fast
    const itemExists = await prisma.item.findUnique({
      where: { id: itemId },
    });

    if (!itemExists) {
      return NextResponse.json(
        { message: 'Invalid itemId: Item does not exist' },
        { status: 400 }
      );
    }

    const uomExists = await prisma.uOM.findUnique({
      where: { id: uomId },
    });

    if (!uomExists) {
      return NextResponse.json(
        { message: 'Invalid uomId: UOM does not exist' },
        { status: 400 }
      );
    }

    // FIX BUG #1 & #3: Use Serializable transaction to prevent race conditions
    // and recalculate subsequent records
    const result = await prisma.$transaction(async (tx) => {
      // Step 1: Read previous ending balance INSIDE transaction (Bug #1 fix)
      const previousRecord = await tx.rawMaterialMutation.findFirst({
        where: {
          itemId,
          date: { lt: normalizedDate },
        },
        orderBy: { date: 'desc' },
        select: { ending: true },
      });

      const beginning = previousRecord?.ending ?? 0;
      const ending = beginning + incomingValue;

      // Step 2: Create the new record
      const id = `RM-${normalizedDate.getTime()}-${itemId}`;
      const rawMaterialMutation = await tx.rawMaterialMutation.create({
        data: {
          id,
          date: normalizedDate,
          itemId,
          uomId,
          beginning,
          incoming: incomingValue,
          outgoing: 0,
          adjustment: 0,
          ending,
          stockOpname: 0,
          variant: 0,
          remarks: sanitizedRemarks,
          updatedAt: new Date(),
        },
        include: {
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
        },
      });

      // Step 3: FIX BUG #3 - Recalculate all subsequent records for this item
      const subsequentRecords = await tx.rawMaterialMutation.findMany({
        where: {
          itemId,
          date: { gt: normalizedDate },
        },
        orderBy: { date: 'asc' },
      });

      // Recalculate balances for all subsequent records
      let runningEnding = rawMaterialMutation.ending;
      for (const record of subsequentRecords) {
        const newBeginning = runningEnding;
        const newEnding = newBeginning + record.incoming - record.outgoing + record.adjustment;

        await tx.rawMaterialMutation.update({
          where: { id: record.id },
          data: {
            beginning: newBeginning,
            ending: newEnding,
            // Recalculate variant if stockOpname exists
            variant: record.stockOpname > 0 ? record.stockOpname - newEnding : 0,
          },
        });

        runningEnding = newEnding;
      }

      return rawMaterialMutation;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10000, // 10 second timeout
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    console.error('[API Error] Failed to create raw material mutation:', error);

    // Bug #13: Enhanced error handling for Prisma errors
    if (error.code === 'P2002') {
      return NextResponse.json(
        { message: 'A raw material mutation for this item and date already exists' },
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

    if (error.code === 'P2000') {
      return NextResponse.json(
        { message: 'Value provided is too long for the column' },
        { status: 400 }
      );
    }

    // Handle transaction timeout or serialization failures
    if (error.code === 'P2034') {
      return NextResponse.json(
        { message: 'Transaction conflict detected. Please retry your request.' },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { message: 'Error creating raw material mutation' },
      { status: 500 }
    );
  }
}

