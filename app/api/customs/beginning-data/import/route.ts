import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { Prisma } from '@prisma/client';
import {
  validatePositiveNumber,
  ValidationError,
  getTodayUTC,
} from '@/lib/api-utils';

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
 * POST /api/customs/beginning-data/import
 * Import beginning balance records from Excel file (all item types in one request)
 *
 * Expected Request Body:
 * {
 *   records: [
 *     {
 *       itemType: "ROH",
 *       itemCode: "RM-001",
 *       itemName: "Raw Material A",
 *       uom: "KG",
 *       qty: 100,
 *       balanceDate: "01/01/2025",
 *       remarks: "Optional notes"
 *     },
 *     ...
 *   ]
 * }
 *
 * Process:
 * 1. Validate all records (including item type validation against database)
 * 2. If any errors, return detailed error list
 * 3. If all valid, insert all records in a transaction
 * 4. Return summary with counts by item type
 */
export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
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

    // Get company code from session
    const companyCode = session.user?.companyCode;
    if (!companyCode) {
      return NextResponse.json(
        { message: 'Company code not found in session' },
        { status: 400 }
      );
    }

    // Fetch valid item types from database (dynamic validation)
    const validItemTypes = await prisma.item_types.findMany({
      select: { item_type_code: true, name_id: true, name_en: true },
    });
    const validItemTypeCodes = new Set(validItemTypes.map(it => it.item_type_code));

    const errors: Array<{ row: number; field: string; error: string }> = [];
    const validRecords: Array<{
      row: number;
      itemType: string;
      itemCode: string;
      itemName: string;
      uom: string;
      qty: number;
      balanceDate: Date;
      remarks: string | null;
    }> = [];

    const today = getTodayUTC();

    // Validate each record
    for (let i = 0; i < records.length; i++) {
      const rowNum = i + 3; // Excel row number (header is row 1, format hints row 2, data starts at row 3)
      const row = records[i];

      // Skip completely empty rows
      if (!row.itemType && !row.itemCode && !row.uom && !row.qty && !row.balanceDate) {
        continue;
      }

      // Validate Item Type (required, must exist in database)
      if (!row.itemType || String(row.itemType).trim() === '') {
        errors.push({ row: rowNum, field: 'Item Type', error: 'Item Type is required' });
        continue;
      }

      const itemTypeCode = String(row.itemType).trim();
      if (!validItemTypeCodes.has(itemTypeCode)) {
        const validCodes = Array.from(validItemTypeCodes).join(', ');
        errors.push({
          row: rowNum,
          field: 'Item Type',
          error: `Invalid item type '${itemTypeCode}'. Valid types: ${validCodes}`
        });
        continue;
      }

      // Validate Item Code (required)
      if (!row.itemCode || String(row.itemCode).trim() === '') {
        errors.push({ row: rowNum, field: 'Item Code', error: 'Item Code is required' });
        continue;
      }

      // Validate Item Name (required)
      if (!row.itemName || String(row.itemName).trim() === '') {
        errors.push({ row: rowNum, field: 'Item Name', error: 'Item Name is required' });
        continue;
      }

      // Validate UOM (required)
      if (!row.uom || String(row.uom).trim() === '') {
        errors.push({ row: rowNum, field: 'UOM', error: 'UOM is required' });
        continue;
      }

      // Validate Qty (required, must be > 0)
      if (row.qty === null || row.qty === undefined || String(row.qty).trim() === '') {
        errors.push({ row: rowNum, field: 'Qty', error: 'Qty is required' });
        continue;
      }

      let qtyValue: number;
      try {
        qtyValue = validatePositiveNumber(row.qty, 'Qty');
      } catch (error: any) {
        errors.push({ row: rowNum, field: 'Qty', error: error.message });
        continue;
      }

      // Validate Balance Date (required, DD/MM/YYYY format)
      if (!row.balanceDate || String(row.balanceDate).trim() === '') {
        errors.push({ row: rowNum, field: 'Balance Date', error: 'Balance Date is required' });
        continue;
      }

      let dateValue: Date;
      try {
        const dateStr = String(row.balanceDate).trim();
        dateValue = parseDDMMYYYY(dateStr);

        // Validate date is not in future
        if (dateValue > today) {
          throw new Error('Date cannot be in the future');
        }
      } catch (error: any) {
        errors.push({
          row: rowNum,
          field: 'Balance Date',
          error: error.message || 'Invalid date format. Expected DD/MM/YYYY'
        });
        continue;
      }

      // Remarks (optional, no validation needed - will be stored as-is)
      const remarksValue = row.remarks ? String(row.remarks).trim() : null;

      validRecords.push({
        row: rowNum,
        itemType: itemTypeCode,
        itemCode: String(row.itemCode).trim(),
        itemName: String(row.itemName).trim(),
        uom: String(row.uom).trim(),
        qty: qtyValue,
        balanceDate: dateValue,
        remarks: remarksValue || null,
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

    // Import all records in a transaction
    let successCount = 0;
    const byType: Record<string, number> = {};

    try {
      await prisma.$transaction(async (tx) => {
        // Check for duplicates within the batch and with existing records
        for (const record of validRecords) {
          const existing = await tx.beginning_balances.findFirst({
            where: {
              company_code: companyCode,
              item_code: record.itemCode,
              balance_date: record.balanceDate,
            },
          });

          if (existing) {
            errors.push({
              row: record.row,
              field: 'Duplicate',
              error: `A beginning balance record for item '${record.itemCode}' on this date already exists`,
            });
          }
        }

        // If duplicates found, throw error to rollback transaction
        if (errors.length > 0) {
          throw new ValidationError('Duplicate records detected');
        }

        // Insert all records
        for (const record of validRecords) {
          await tx.beginning_balances.create({
            data: {
              company_code: companyCode,
              item_type: record.itemType,
              item_code: record.itemCode,
              item_name: record.itemName,
              uom: record.uom,
              qty: record.qty,
              balance_date: record.balanceDate,
            },
          });

          successCount++;

          // Count by type
          if (!byType[record.itemType]) {
            byType[record.itemType] = 0;
          }
          byType[record.itemType]++;
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
      total: successCount,
      byType,
      successCount,
      errorCount: 0,
      errors: [],
    });
  } catch (error: any) {
    console.error('[API Error] Failed to import beginning balance records:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: 'Invalid request format' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error importing beginning balance records', error: error.message },
      { status: 500 }
    );
  }
}
