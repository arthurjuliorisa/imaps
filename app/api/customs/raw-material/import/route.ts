// @ts-nocheck
// TODO: This file needs to be rewritten - items model doesn't exist in schema
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
 * Interface for import record validation (INCOMING-only)
 */
interface ImportRecord {
  date: string | Date;
  itemCode: string;
  incoming: number;
  remarks?: string;
}

/**
 * Interface for import result tracking
 */
interface ImportResult {
  success: boolean;
  successCount: number;
  errorCount: number;
  errors: Array<{
    index: number;
    record: any;
    error: string;
  }>;
}

/**
 * Interface for records to process within transaction
 */
interface RecordToProcess {
  index: number;
  date: Date;
  itemId: string;
  itemCode: string;
  uomId: string;
  incoming: number;
  remarks: string | null;
}

/**
 * POST /api/customs/raw-material/import
 * Import INCOMING-only raw material mutations from Excel
 * Uses itemCode to lookup items, automatically calculates beginning and ending
 *
 * FIXES APPLIED:
 * - Bug #2: Sequential balance calculation inside transaction with proper sorting
 * - Bug #5, #12: Enhanced input validation (future dates, positive values)
 * - Bug #13: Request body size limits and comprehensive error handling
 * - Bug #14: Input sanitization for remarks
 * - Bug #16: Proper date normalization to UTC midnight
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { records } = body;

    // Validate that records array is provided
    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { message: 'Invalid request: records array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Bug #13: Limit batch size to prevent resource exhaustion
    if (records.length > 1000) {
      return NextResponse.json(
        { message: 'Batch size exceeds maximum limit of 1000 records' },
        { status: 400 }
      );
    }

    const result: ImportResult = {
      success: true,
      successCount: 0,
      errorCount: 0,
      errors: [],
    };

    // Get current date for future date validation
    const now = new Date();
    const today = new Date(Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0
    ));

    // Validate all records first before processing
    const validatedRecords: Array<{
      index: number;
      data: {
        date: Date;
        itemCode: string;
        incoming: number;
        remarks: string | null;
      };
    }> = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      // Validate required fields
      if (!record.date || !record.itemCode || record.incoming === undefined || record.incoming === null) {
        result.errors.push({
          index: i,
          record,
          error: 'Missing required fields: date, itemCode, and incoming are required',
        });
        result.errorCount++;
        continue;
      }

      // Validate and normalize date (Bug #16)
      let parsedDate: Date;
      try {
        parsedDate = parseAndNormalizeDate(record.date);
      } catch (error) {
        result.errors.push({
          index: i,
          record,
          error: 'Invalid date format',
        });
        result.errorCount++;
        continue;
      }

      // Validate date is not in the future (Bug #5)
      if (parsedDate > today) {
        result.errors.push({
          index: i,
          record,
          error: 'Date cannot be in the future',
        });
        result.errorCount++;
        continue;
      }

      // Validate incoming is a positive number > 0 (Bug #12)
      const incoming = parseFloat(String(record.incoming));
      if (isNaN(incoming) || incoming <= 0) {
        result.errors.push({
          index: i,
          record,
          error: 'Invalid incoming value: must be a positive number greater than 0',
        });
        result.errorCount++;
        continue;
      }

      // Sanitize and validate remarks (Bug #14)
      let sanitizedRemarks: string | null = null;
      try {
        sanitizedRemarks = sanitizeRemarks(record.remarks);
      } catch (error: any) {
        result.errors.push({
          index: i,
          record,
          error: error.message,
        });
        result.errorCount++;
        continue;
      }

      validatedRecords.push({
        index: i,
        data: {
          date: parsedDate,
          itemCode: record.itemCode.trim(),
          incoming,
          remarks: sanitizedRemarks,
        },
      });
    }

    // If all records failed validation, return early
    if (validatedRecords.length === 0) {
      return NextResponse.json(
        {
          ...result,
          success: false,
          message: 'All records failed validation',
        },
        { status: 400 }
      );
    }

    // Get all unique itemCodes for batch lookup
    const itemCodes = [...new Set(validatedRecords.map((r) => r.data.itemCode))];

    // Lookup all items by code
    const items = await prisma.items.findMany({
      where: { code: { in: itemCodes } },
      select: { id: true, code: true, uomId: true },
    });

    // Create a map of itemCode to item data
    const itemMap = new Map(items.map((item) => [item.code, { id: item.id, uomId: item.uomId }]));

    // Prepare records with item IDs
    const recordsToProcess: RecordToProcess[] = [];

    for (const record of validatedRecords) {
      const item = itemMap.get(record.data.itemCode);

      if (!item) {
        result.errors.push({
          index: record.index,
          record: records[record.index],
          error: `Invalid itemCode: Item '${record.data.itemCode}' does not exist`,
        });
        result.errorCount++;
        continue;
      }

      recordsToProcess.push({
        index: record.index,
        date: record.data.date,
        itemId: item.id,
        itemCode: record.data.itemCode,
        uomId: item.uomId,
        incoming: record.data.incoming,
        remarks: record.data.remarks,
      });
    }

    // FIX BUG #2: Sort records by itemId first, then by date
    // This ensures we process records in chronological order within each item
    const sortedRecords = recordsToProcess.sort((a, b) => {
      const itemCompare = a.itemId.localeCompare(b.itemId);
      if (itemCompare !== 0) return itemCompare;
      return a.date.getTime() - b.date.getTime();
    });

    // Process all valid records in a Serializable transaction
    try {
      const results = await prisma.$transaction(async (tx) => {
        const processedResults = [];
        // Track running balances per item within this batch
        const itemBalances = new Map<string, number>();

        for (const record of sortedRecords) {
          // Get previous ending - either from our batch or from database
          let beginning: number;

          if (itemBalances.has(record.itemId)) {
            // Use the ending from previous record in this batch
            beginning = itemBalances.get(record.itemId)!;
          } else {
            // Query database for most recent record before this date
            const previousRecord = await tx.rawMaterialMutation.findFirst({
              where: {
                itemId: record.itemId,
                date: { lt: record.date },
              },
              orderBy: { date: 'desc' },
              select: { ending: true },
            });
            beginning = previousRecord?.ending ?? 0;
          }

          const ending = beginning + record.incoming;

          // Upsert the record (handles duplicates)
          const result = await tx.rawMaterialMutation.upsert({
            where: {
              date_itemId: {
                date: record.date,
                itemId: record.itemId,
              },
            },
            update: {
              uomId: record.uomId,
              beginning,
              incoming: record.incoming,
              ending,
              outgoing: 0,
              adjustment: 0,
              stockOpname: 0,
              variant: 0,
              remarks: record.remarks,
            },
            create: {
              id: `RM-${record.date.getTime()}-${record.itemId}`,
              date: record.date,
              itemId: record.itemId,
              uomId: record.uomId,
              beginning,
              incoming: record.incoming,
              ending,
              outgoing: 0,
              adjustment: 0,
              stockOpname: 0,
              variant: 0,
              remarks: record.remarks,
              updatedAt: new Date(),
            },
          });

          // Update running balance for this item
          itemBalances.set(record.itemId, ending);
          processedResults.push(result);
        }

        // After processing all records, recalculate subsequent records for each affected item
        const affectedItems = [...new Set(sortedRecords.map(r => r.itemId))];

        for (const itemId of affectedItems) {
          // Get the latest date we processed for this item
          const latestProcessedDate = Math.max(
            ...sortedRecords.filter(r => r.itemId === itemId).map(r => r.date.getTime())
          );
          const latestDate = new Date(latestProcessedDate);

          // Get all subsequent records for this item
          const subsequentRecords = await tx.rawMaterialMutation.findMany({
            where: {
              itemId,
              date: { gt: latestDate },
            },
            orderBy: { date: 'asc' },
          });

          // Recalculate balances for all subsequent records
          let runningEnding = itemBalances.get(itemId)!;
          for (const subRecord of subsequentRecords) {
            const newBeginning = runningEnding;
            const newEnding = newBeginning + subRecord.incoming - subRecord.outgoing + subRecord.adjustment;

            await tx.rawMaterialMutation.update({
              where: { id: subRecord.id },
              data: {
                beginning: newBeginning,
                ending: newEnding,
                variant: subRecord.stockOpname > 0 ? subRecord.stockOpname - newEnding : 0,
              },
            });

            runningEnding = newEnding;
          }
        }

        return processedResults;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000, // 30 second timeout for bulk operations
      });

      result.successCount = results.length;
    } catch (error: any) {
      console.error('[API Error] Transaction failed during import:', error);

      // Bug #13: Enhanced error handling
      if (error.code === 'P2002') {
        return NextResponse.json(
          {
            success: false,
            message: 'Duplicate records detected in batch',
            error: error.message,
          },
          { status: 400 }
        );
      }

      if (error.code === 'P2003') {
        return NextResponse.json(
          {
            success: false,
            message: 'Foreign key constraint failed - invalid itemId or uomId',
            error: error.message,
          },
          { status: 400 }
        );
      }

      if (error.code === 'P2025') {
        return NextResponse.json(
          {
            success: false,
            message: 'Record not found during update',
            error: error.message,
          },
          { status: 404 }
        );
      }

      if (error.code === 'P2000') {
        return NextResponse.json(
          {
            success: false,
            message: 'Value provided is too long for the column',
            error: error.message,
          },
          { status: 400 }
        );
      }

      if (error.code === 'P2034') {
        return NextResponse.json(
          {
            success: false,
            message: 'Transaction conflict detected. Please retry your import.',
            error: error.message,
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: 'Transaction failed during import',
          error: error.message,
        },
        { status: 500 }
      );
    }

    // Determine overall success
    result.success = result.errorCount === 0;

    return NextResponse.json({
      success: result.success,
      message: result.success
        ? `Successfully imported ${result.successCount} records`
        : `Imported ${result.successCount} records with ${result.errorCount} errors`,
      successCount: result.successCount,
      errorCount: result.errorCount,
      errors: result.errors,
    });
  } catch (error: any) {
    console.error('[API Error] Failed to import raw material mutations:', error);

    // Handle JSON parsing errors
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error importing raw material mutations' },
      { status: 500 }
    );
  }
}
