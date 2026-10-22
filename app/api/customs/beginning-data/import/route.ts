import { beginningBalanceUploadErrors, normalizeBeginningBalanceItemCode, parseBeginningBalanceDate, parseBeginningBalanceQty } from '@/lib/beginning-balance-upload-validation';
import { NextResponse } from 'next/server';
import { inspect } from 'node:util';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { logActivity } from '@/lib/log-activity';
import { Prisma } from '@prisma/client';
import {
  ValidationError,
  getTodayUTC,
} from '@/lib/api-utils';
import { validateBeginningBalanceItemsBatch } from '@/lib/beginning-data-validation';
import {
  BEGINNING_BALANCE_UPLOAD_DB_BATCH_SIZE,
  BEGINNING_BALANCE_UPLOAD_MAX_ROWS,
} from '@/lib/constants/beginning-balance-upload';
import {
  BeginningBalanceSnapshotError,
  createRequiredBeginningBalanceSnapshots,
} from '@/lib/services/beginning-balance-snapshot.service';

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
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
    const { records } = body ?? {};

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
    if (records.length > BEGINNING_BALANCE_UPLOAD_MAX_ROWS) {
      return NextResponse.json(
        { message: `Batch size exceeds maximum limit of ${BEGINNING_BALANCE_UPLOAD_MAX_ROWS.toLocaleString()} records` },
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

    // Convert company code to integer for database operations
    const companyCodeInt = parseInt(companyCode, 10);
    if (isNaN(companyCodeInt)) {
      return NextResponse.json(
        { message: 'Invalid company code format' },
        { status: 400 }
      );
    }

    const inputErrors = beginningBalanceUploadErrors(records);
    if (inputErrors.length) return NextResponse.json({ success: false, message: 'Invalid upload values', successCount: 0, errorCount: inputErrors.length, errors: inputErrors }, { status: 400 });

    // Fetch valid item types from database (dynamic validation)
    // Only fetch ACTIVE item types
    const validItemTypes = await prisma.item_types.findMany({
      where: { is_active: true },
      select: { item_type_code: true, name_id: true, name_en: true, is_active: true },
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
      ppkekNumbers: string[];
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
      const itemCode = normalizeBeginningBalanceItemCode(row.itemCode);
      if (!itemCode) {
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
        qtyValue = parseBeginningBalanceQty(row.qty);
      } catch (error: any) {
        errors.push({ row: rowNum, field: 'Qty', error: error.message });
        continue;
      }

      // Validate Balance Date (required, MM/DD/YYYY format)
      if (!row.balanceDate || String(row.balanceDate).trim() === '') {
        errors.push({ row: rowNum, field: 'Balance Date', error: 'Balance Date is required' });
        continue;
      }

      let dateValue: Date;
      try {
        const dateStr = String(row.balanceDate).trim();
        dateValue = parseBeginningBalanceDate(dateStr);

        // Validate date is not in future
        if (dateValue > today) {
          throw new Error('Date cannot be in the future');
        }
      } catch (error: any) {
        errors.push({
          row: rowNum,
          field: 'Balance Date',
          error: error.message || 'Invalid date format. Expected MM/DD/YYYY'
        });
        continue;
      }

      // Remarks (optional, no validation needed - will be stored as-is)
      const remarksValue = row.remarks ? String(row.remarks).trim() : null;

      // Parse PPKEK Numbers (optional, comma-separated string)
      let ppkekNumbers: string[] = [];
      if (row.ppkekNumbers) {
        const ppkekStr = String(row.ppkekNumbers).trim();
        if (ppkekStr.length > 0) {
          ppkekNumbers = ppkekStr
            .split(',')
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0);
        }
      }

      validRecords.push({
        row: rowNum,
        itemType: itemTypeCode,
        itemCode,
        itemName: String(row.itemName).trim(),
        uom: String(row.uom).trim(),
        qty: qtyValue,
        balanceDate: dateValue,
        remarks: remarksValue || null,
        ppkekNumbers,
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

    // Validate items for duplicates and existing transactions (batch validation)
    const itemsToValidate = validRecords.map(record => ({
      itemCode: record.itemCode,
      itemName: record.itemName,
      itemType: record.itemType,
      uom: record.uom,
    }));

    const validationResults = await validateBeginningBalanceItemsBatch(
      companyCodeInt,
      itemsToValidate
    );

    // Check validation results and collect errors
    const validationErrors: Array<{ row: number; field: string; error: string }> = [];
    for (const record of validRecords) {
      const key = `${record.itemCode}|${record.uom}|${record.itemName}|${record.itemType}`;
      const validationResult = validationResults[key];

      if (validationResult && !validationResult.valid) {
        // Add all validation errors for this record
        for (const validationError of validationResult.errors) {
          validationErrors.push({
            row: record.row,
            field: 'Item Code',
            error: validationError.reason,
          });
        }
      }
    }

    // If there are validation errors, return them
    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          success: false,
          message: `Validation failed: ${validationErrors.length} item(s) cannot be added`,
          successCount: 0,
          errorCount: validationErrors.length,
          errors: validationErrors,
        },
        { status: 400 }
      );
    }

    // Import all records in a transaction
    let successCount = 0;
    const byType: Record<string, number> = {};
    const uniqueBalanceDates = new Set(validRecords.map(r => r.balanceDate.getTime()));

    try {
      await prisma.$transaction(async (tx) => {
        // Note: Duplicate and transaction validation is already done before this transaction
        // This ensures we fail fast and don't start a transaction if validation fails

        // OPTIMIZATION: Bulk insert all records at once instead of one-by-one
        const insertData = validRecords.map(record => ({
          company_code: companyCodeInt,
          item_type: record.itemType,
          item_code: record.itemCode,
          item_name: record.itemName,
          uom: record.uom,
          qty: record.qty,
          balance_date: record.balanceDate,
          remarks: record.remarks,
        }));

        for (const batch of chunkArray(insertData, BEGINNING_BALANCE_UPLOAD_DB_BATCH_SIZE)) {
          await tx.beginning_balances.createMany({
            data: batch,
          });
        }

        // Create ppkek associations - fetch created records and link ppkeks
        const createdWithIds = await tx.beginning_balances.findMany({
          where: {
            company_code: companyCodeInt,
            item_code: { in: validRecords.map(r => r.itemCode) },
            uom: { in: validRecords.map(r => r.uom) },
            balance_date: { in: Array.from(uniqueBalanceDates).map(t => new Date(t)) }
          },
          select: { id: true, item_code: true, uom: true, balance_date: true },
        });

        const createdRecordMap = new Map(
          createdWithIds.map(record => [
            `${record.item_code}|${record.uom}|${record.balance_date.getTime()}`,
            record.id,
          ])
        );

        const ppkekInsertData: Array<{
          beginning_balance_id: number;
          ppkek_number: string;
        }> = [];

        for (const record of validRecords) {
          if (record.ppkekNumbers.length > 0) {
            const createdRecordId = createdRecordMap.get(
              `${record.itemCode}|${record.uom}|${record.balanceDate.getTime()}`
            );
            if (!createdRecordId) {
              throw new Error(
                `Unable to resolve imported beginning balance for PPKEK association at row ${record.row}`
              );
            }
            ppkekInsertData.push(
              ...record.ppkekNumbers.map(ppkek => ({
                beginning_balance_id: createdRecordId,
                ppkek_number: ppkek,
              }))
            );
          }
        }

        for (const batch of chunkArray(ppkekInsertData, BEGINNING_BALANCE_UPLOAD_DB_BATCH_SIZE)) {
          await tx.beginning_balance_ppkeks.createMany({
            data: batch,
          });
        }

        await createRequiredBeginningBalanceSnapshots(
          tx,
          companyCodeInt,
          validRecords.map((record) => ({
            item_type: record.itemType,
            item_code: record.itemCode,
            item_name: record.itemName,
            uom: record.uom,
            snapshot_date: record.balanceDate,
          }))
        );

        successCount = validRecords.length;

        // Count by type
        for (const record of validRecords) {
          if (!byType[record.itemType]) {
            byType[record.itemType] = 0;
          }
          byType[record.itemType]++;
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 60000, // Allow larger 10,000-row bulk operations to complete
      });
    } catch (error: any) {
      if (!(error instanceof BeginningBalanceSnapshotError)) console.error('[API Error] Transaction failed during import:', error);

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

      if (error instanceof BeginningBalanceSnapshotError) {
        console.error('[API Error] Required beginning balance snapshots failed:', inspect({
          companyCode: companyCodeInt,
          requested: validRecords.length,
          failed: error.failedIdentities.length,
          failedSample: error.failedIdentities.slice(0, 5),
          diagnostics: error.diagnostics,
          cause: error.cause instanceof Error
            ? { name: error.cause.name, message: error.cause.message.slice(0, 500) }
            : undefined,
        }, { depth: null, maxArrayLength: 5, colors: false }));
        return NextResponse.json(
          {
            success: false,
            message: 'Beginning balances were not imported because required baseline snapshots could not be created',
            successCount: 0,
            errorCount: error.failedIdentities.length,
            errors: error.failedIdentities.slice(0, 5).map((item) => ({
              row: 0,
              field: 'Snapshot',
              error: `${item.item_type}/${item.item_code}/${item.uom} on ${item.snapshot_date.toISOString().slice(0, 10)}`,
            })),
          },
          { status: 500 }
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

    // Log activity
    await logActivity({
      action: 'IMPORT_BEGINNING_DATA_FROM_EXCEL',
      description: `Imported ${successCount} beginning balance record(s) from Excel`,
      status: 'success',
      metadata: {
        successCount,
        byType,
        companyCode,
      },
    });

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
