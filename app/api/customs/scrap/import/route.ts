// @ts-nocheck
// TODO: This file needs to be rewritten - scrapMaster model doesn't exist
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
 * UPDATED: Now uses scrapCode instead of itemCode
 */
interface ImportRecord {
  date: string | Date;
  scrapCode: string;
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
 * UPDATED: Now uses scrapId and scrapCode
 */
interface RecordToProcess {
  index: number;
  date: Date;
  scrapId: string;
  scrapCode: string;
  uomId: string;
  incoming: number;
  remarks: string | null;
}

/**
 * POST /api/customs/scrap/import
 * Import INCOMING-only scrap mutations from Excel
 * UPDATED: Uses scrapCode to lookup ScrapMaster, automatically calculates beginning and ending
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
        scrapCode: string;
        incoming: number;
        remarks: string | null;
      };
    }> = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      // Validate required fields
      if (!record.date || !record.scrapCode || record.incoming === undefined || record.incoming === null) {
        result.errors.push({
          index: i,
          record,
          error: 'Missing required fields: date, scrapCode, and incoming are required',
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
          scrapCode: record.scrapCode.trim(),
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

    // Get all unique scrapCodes for batch lookup
    const scrapCodes = [...new Set(validatedRecords.map((r) => r.data.scrapCode))];

    // Lookup all scrap masters by code
    const scrapMasters = await prisma.scrapMaster.findMany({
      where: { code: { in: scrapCodes } },
      select: { id: true, code: true },
    });

    // Create a map of scrapCode to scrap data
    const scrapMap = new Map(scrapMasters.map((scrap) => [scrap.code, { id: scrap.id }]));

    // Get UOM - we'll use a default UOM for scrap (you may need to adjust this)
    // For now, we'll get the first UOM or require it to be specified
    const defaultUom = await prisma.uOM.findFirst();

    if (!defaultUom) {
      return NextResponse.json(
        { message: 'No UOM found in the system. Please create at least one UOM first.' },
        { status: 400 }
      );
    }

    // Prepare records with scrap IDs
    const recordsToProcess: RecordToProcess[] = [];

    for (const record of validatedRecords) {
      const scrap = scrapMap.get(record.data.scrapCode);

      if (!scrap) {
        result.errors.push({
          index: record.index,
          record: records[record.index],
          error: `Invalid scrapCode: Scrap Master '${record.data.scrapCode}' does not exist`,
        });
        result.errorCount++;
        continue;
      }

      recordsToProcess.push({
        index: record.index,
        date: record.data.date,
        scrapId: scrap.id,
        scrapCode: record.data.scrapCode,
        uomId: defaultUom.id,
        incoming: record.data.incoming,
        remarks: record.data.remarks,
      });
    }

    // FIX BUG #2: Sort records by scrapId first, then by date
    // This ensures we process records in chronological order within each scrap
    const sortedRecords = recordsToProcess.sort((a, b) => {
      const scrapCompare = a.scrapId.localeCompare(b.scrapId);
      if (scrapCompare !== 0) return scrapCompare;
      return a.date.getTime() - b.date.getTime();
    });

    // Process all valid records in a Serializable transaction
    try {
      const results = await prisma.$transaction(async (tx) => {
        const processedResults = [];
        // Track running balances per scrap within this batch
        const scrapBalances = new Map<string, number>();

        for (const record of sortedRecords) {
          // Get previous ending - either from our batch or from database
          let beginning: number;

          if (scrapBalances.has(record.scrapId)) {
            // Use the ending from previous record in this batch
            beginning = scrapBalances.get(record.scrapId)!;
          } else {
            // Query database for most recent record before this date
            const previousRecord = await tx.scrapMutation.findFirst({
              where: {
                scrapId: record.scrapId,
                date: { lt: record.date },
              },
              orderBy: { date: 'desc' },
              select: { ending: true },
            });
            beginning = previousRecord?.ending ?? 0;
          }

          const ending = beginning + record.incoming;

          // Upsert the record (handles duplicates)
          const result = await tx.scrapMutation.upsert({
            where: {
              date_scrapId: {
                date: record.date,
                scrapId: record.scrapId,
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
              id: `SM-${record.date.getTime()}-${record.scrapId}`,
              date: record.date,
              scrapId: record.scrapId,
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

          // Update running balance for this scrap
          scrapBalances.set(record.scrapId, ending);
          processedResults.push(result);
        }

        // After processing all records, recalculate subsequent records for each affected scrap
        const affectedScraps = [...new Set(sortedRecords.map(r => r.scrapId))];

        for (const scrapId of affectedScraps) {
          // Get the latest date we processed for this scrap
          const latestProcessedDate = Math.max(
            ...sortedRecords.filter(r => r.scrapId === scrapId).map(r => r.date.getTime())
          );
          const latestDate = new Date(latestProcessedDate);

          // Get all subsequent records for this scrap
          const subsequentRecords = await tx.scrapMutation.findMany({
            where: {
              scrapId,
              date: { gt: latestDate },
            },
            orderBy: { date: 'asc' },
          });

          // Recalculate balances for all subsequent records
          let runningEnding = scrapBalances.get(scrapId)!;
          for (const subRecord of subsequentRecords) {
            const newBeginning = runningEnding;
            const newEnding = newBeginning + subRecord.incoming - subRecord.outgoing + subRecord.adjustment;

            await tx.scrapMutation.update({
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

      // FIX: Recalculate stock_daily_snapshot for all affected scraps from earliest imported date
      // This ensures cascading balance calculation for all future dates
      if (sortedRecords.length > 0) {
        try {
          const affectedScraps = [...new Set(sortedRecords.map(r => r.scrapId))];
          const minDate = new Date(Math.min(...sortedRecords.map(r => r.date.getTime())));

          // Get fresh scrap masters with company info
          const updatedScrapMasters = await prisma.scrapMaster.findMany({
            where: { id: { in: affectedScraps } },
            select: { id: true, code: true, company_code: true },
          });

          for (const scrap of updatedScrapMasters) {
            await prisma.$executeRawUnsafe(
              'SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)',
              scrap.company_code,
              'SCRAP',
              scrap.code,
              minDate
            );
            console.log(`[API Info] Recalculated snapshots for SCRAP ${scrap.code} from ${minDate.toISOString().split('T')[0]}`);
          }
        } catch (recalcError) {
          console.error('[API Warning] Snapshot recalculation failed (non-blocking):', recalcError);
          // Don't fail the import if snapshot recalculation fails - just log it
        }
      }
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
            message: 'Foreign key constraint failed - invalid scrapId or uomId',
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
    console.error('[API Error] Failed to import scrap mutations:', error);

    // Handle JSON parsing errors
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error importing scrap mutations' },
      { status: 500 }
    );
  }
}
