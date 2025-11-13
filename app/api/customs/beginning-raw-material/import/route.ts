import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  parseAndNormalizeDate,
  validateDateNotFuture,
  sanitizeRemarks,
  validatePositiveNumber,
  ValidationError,
  getTodayUTC,
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
 * Parse DD/MM/YYYY format to Date
 */
function parseDDMMYYYY(dateStr: string): Date {
  const parts = dateStr.split('/');
  if (parts.length !== 3) {
    throw new Error('Invalid date format. Expected DD/MM/YYYY');
  }

  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1; // Months are 0-indexed
  const year = parseInt(parts[2], 10);

  if (isNaN(day) || isNaN(month) || isNaN(year)) {
    throw new Error('Invalid date format. Expected DD/MM/YYYY');
  }

  // Create UTC date
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

/**
 * POST /api/customs/beginning-raw-material/import
 * Import beginning stock records from Excel file
 *
 * Expected Excel format:
 * - Column A: Item Code* (required)
 * - Column B: Item Name (informational, ignored)
 * - Column C: UOM Code* (required)
 * - Column D: Beginning Balance* (required, number > 0)
 * - Column E: Beginning Date* (required, DD/MM/YYYY format)
 * - Column F: Remarks (optional)
 *
 * Process:
 * 1. Parse Excel file
 * 2. Validate all rows
 * 3. If any errors, return detailed error list
 * 4. If all valid, insert all records in a transaction
 * 5. Recalculate affected mutation records
 */
export async function POST(request: Request) {
  try {
    // FIX: Accept JSON body (frontend parses Excel client-side)
    const body = await request.json();
    const { records } = body;

    if (!records || !Array.isArray(records)) {
      return NextResponse.json(
        { message: 'Invalid request body. Expected { records: Array }' },
        { status: 400 }
      );
    }

    if (records.length === 0) {
      return NextResponse.json(
        { message: 'No records provided' },
        { status: 400 }
      );
    }

    // Limit batch size
    if (records.length > 1000) {
      return NextResponse.json(
        { message: 'Batch size exceeds maximum limit of 1000 records' },
        { status: 400 }
      );
    }

    // Transform frontend records format to match validation
    const jsonData = records.map((record: any) => ({
      itemCode: record.itemCode,
      uomCode: record.uomCode || record.uom, // Support both field names
      beginningBalance: record.beginningBalance,
      beginningDate: record.beginningDate,
      remarks: record.remarks,
    }));

    const errors: Array<{ row: number; field: string; error: string }> = [];
    const validRecords: Array<{
      row: number;
      itemCode: string;
      uomCode: string;
      beginningBalance: number;
      beginningDate: Date;
      remarks: string | null;
    }> = [];

    const today = getTodayUTC();

    // Validate each row
    for (let i = 0; i < jsonData.length; i++) {
      const rowNum = i + 3; // Actual row number in Excel (3-based)
      const row = jsonData[i];

      // Skip completely empty rows
      if (!row.itemCode && !row.uomCode && !row.beginningBalance && !row.beginningDate) {
        continue;
      }

      // Validate Item Code (required)
      if (!row.itemCode || String(row.itemCode).trim() === '') {
        errors.push({ row: rowNum, field: 'Item Code', error: 'Item Code is required' });
        continue;
      }

      // Validate UOM Code (required)
      if (!row.uomCode || String(row.uomCode).trim() === '') {
        errors.push({ row: rowNum, field: 'UOM Code', error: 'UOM Code is required' });
        continue;
      }

      // Validate Beginning Balance (required, must be > 0)
      if (row.beginningBalance === null || row.beginningBalance === undefined || String(row.beginningBalance).trim() === '') {
        errors.push({ row: rowNum, field: 'Beginning Balance', error: 'Beginning Balance is required' });
        continue;
      }

      let balanceValue: number;
      try {
        balanceValue = validatePositiveNumber(row.beginningBalance, 'Beginning Balance');
      } catch (error: any) {
        errors.push({ row: rowNum, field: 'Beginning Balance', error: error.message });
        continue;
      }

      // Validate Beginning Date (required, DD/MM/YYYY format)
      if (!row.beginningDate || String(row.beginningDate).trim() === '') {
        errors.push({ row: rowNum, field: 'Beginning Date', error: 'Beginning Date is required' });
        continue;
      }

      let dateValue: Date;
      try {
        const dateStr = String(row.beginningDate).trim();
        dateValue = parseDDMMYYYY(dateStr);

        // Validate date is not in future
        if (dateValue > today) {
          throw new Error('Date cannot be in the future');
        }
      } catch (error: any) {
        errors.push({ row: rowNum, field: 'Beginning Date', error: error.message || 'Invalid date format. Expected DD/MM/YYYY' });
        continue;
      }

      // Sanitize remarks (optional)
      let sanitizedRemarks: string | null = null;
      if (row.remarks) {
        try {
          sanitizedRemarks = sanitizeRemarks(row.remarks);
        } catch (error: any) {
          errors.push({ row: rowNum, field: 'Remarks', error: error.message });
          continue;
        }
      }

      validRecords.push({
        row: rowNum,
        itemCode: String(row.itemCode).trim(),
        uomCode: String(row.uomCode).trim(),
        beginningBalance: balanceValue,
        beginningDate: dateValue,
        remarks: sanitizedRemarks,
      });
    }

    // If there are validation errors, return them
    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Validation failed for ${errors.length} row(s)`,
          successCount: 0,
          errorCount: errors.length,
          errors,
        },
        { status: 400 }
      );
    }

    // If no valid records after filtering empty rows
    if (validRecords.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'No valid records found to import',
          successCount: 0,
          errorCount: 0,
          errors: [],
        },
        { status: 400 }
      );
    }

    // Lookup all items and UOMs
    const itemCodes = [...new Set(validRecords.map(r => r.itemCode))];
    const uomCodes = [...new Set(validRecords.map(r => r.uomCode))];

    const [items, uoms] = await Promise.all([
      prisma.item.findMany({
        where: { code: { in: itemCodes } },
        select: { id: true, code: true, type: true, uomId: true },
      }),
      prisma.uOM.findMany({
        where: { code: { in: uomCodes } },
        select: { id: true, code: true },
      }),
    ]);

    // Create lookup maps
    const itemMap = new Map(items.map(item => [item.code, item]));
    const uomMap = new Map(uoms.map(uom => [uom.code, uom]));

    // Validate all items and UOMs exist and have correct types
    const recordsToImport: Array<{
      row: number;
      itemId: string;
      uomId: string;
      beginningBalance: number;
      beginningDate: Date;
      remarks: string | null;
    }> = [];

    for (const record of validRecords) {
      const item = itemMap.get(record.itemCode);
      if (!item) {
        errors.push({
          row: record.row,
          field: 'Item Code',
          error: `Item '${record.itemCode}' does not exist in the system`,
        });
        continue;
      }

      if (item.type !== 'RM') {
        errors.push({
          row: record.row,
          field: 'Item Code',
          error: `Item '${record.itemCode}' is not a Raw Material (type: ${item.type})`,
        });
        continue;
      }

      const uom = uomMap.get(record.uomCode);
      if (!uom) {
        errors.push({
          row: record.row,
          field: 'UOM Code',
          error: `UOM '${record.uomCode}' does not exist in the system`,
        });
        continue;
      }

      recordsToImport.push({
        row: record.row,
        itemId: item.id,
        uomId: uom.id,
        beginningBalance: record.beginningBalance,
        beginningDate: record.beginningDate,
        remarks: record.remarks,
      });
    }

    // If there are validation errors after lookup, return them
    if (errors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Validation failed for ${errors.length} row(s)`,
          successCount: 0,
          errorCount: errors.length,
          errors,
        },
        { status: 400 }
      );
    }

    // Import all records in a transaction
    let successCount = 0;
    try {
      await prisma.$transaction(async (tx) => {
        // Check for duplicates within the batch and with existing records
        for (const record of recordsToImport) {
          const existing = await tx.beginningStock.findFirst({
            where: {
              type: 'RAW_MATERIAL',
              itemId: record.itemId,
              beginningDate: record.beginningDate,
            },
          });

          if (existing) {
            errors.push({
              row: record.row,
              field: 'Duplicate',
              error: `A beginning stock record for this item and date already exists`,
            });
          }
        }

        // If duplicates found, throw error to rollback transaction
        if (errors.length > 0) {
          throw new ValidationError('Duplicate records detected');
        }

        // Insert all records
        for (const record of recordsToImport) {
          await tx.beginningStock.create({
            data: {
              type: 'RAW_MATERIAL',
              itemId: record.itemId,
              uomId: record.uomId,
              beginningBalance: record.beginningBalance,
              beginningDate: record.beginningDate,
              remarks: record.remarks,
            },
          });

          successCount++;
        }

        // Recalculate affected mutation records for each unique item
        const uniqueItems = new Map<string, { itemId: string; date: Date; balance: number }[]>();
        for (const record of recordsToImport) {
          if (!uniqueItems.has(record.itemId)) {
            uniqueItems.set(record.itemId, []);
          }
          uniqueItems.get(record.itemId)!.push({
            itemId: record.itemId,
            date: record.beginningDate,
            balance: record.beginningBalance,
          });
        }

        // Recalculate for each item (use the earliest date and its balance)
        for (const [itemId, records] of uniqueItems.entries()) {
          // Sort by date and use the earliest
          records.sort((a, b) => a.date.getTime() - b.date.getTime());
          const earliest = records[0];
          await recalculateMutationRecords(tx, itemId, earliest.date, earliest.balance);
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000, // 30 second timeout for bulk operations
      });
    } catch (error: any) {
      console.error('[API Error] Transaction failed during import:', error);

      if (error instanceof ValidationError) {
        return NextResponse.json(
          {
            success: false,
            message: error.message,
            successCount: 0,
            errorCount: errors.length,
            errors,
          },
          { status: 400 }
        );
      }

      if (error.code === 'P2002') {
        return NextResponse.json(
          {
            success: false,
            message: 'Duplicate records detected in batch',
            successCount: 0,
            errorCount: 1,
            errors: [{ row: 0, field: 'Duplicate', error: 'Duplicate records detected' }],
          },
          { status: 400 }
        );
      }

      if (error.code === 'P2034') {
        return NextResponse.json(
          {
            success: false,
            message: 'Transaction conflict detected. Please retry your import.',
            successCount: 0,
            errorCount: 1,
            errors: [{ row: 0, field: 'Transaction', error: 'Transaction conflict' }],
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          message: 'Transaction failed during import',
          error: error.message,
          successCount: 0,
          errorCount: 1,
          errors: [{ row: 0, field: 'Transaction', error: error.message }],
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Successfully imported ${successCount} record(s)`,
      successCount,
      errorCount: 0,
      errors: [],
    });
  } catch (error: any) {
    console.error('[API Error] Failed to import beginning stock records:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: 'Invalid request format' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error importing beginning stock records', error: error.message },
      { status: 500 }
    );
  }
}
