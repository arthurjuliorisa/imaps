import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { checkBatchStockAvailability } from '@/lib/utils/stock-checker';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import validator from 'validator';

/**
 * Validation schema for import record
 */
const ImportRecordSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  itemCode: z.string().min(1, 'Item code is required'),
  recipientName: z.string().min(1, 'Recipient name is required').max(200, 'Recipient name must not exceed 200 characters'),
  qty: z.number().positive('Quantity must be a positive number'),
  currency: z.enum(['USD', 'IDR', 'CNY', 'EUR', 'JPY'], {
    message: 'Invalid currency. Must be one of: USD, IDR, CNY, EUR, JPY',
  }),
  valueAmount: z.number().nonnegative('Value amount must be non-negative'),
  remarks: z.string().max(500, 'Remarks must not exceed 500 characters').optional(),
});

/**
 * Parse and normalize date to UTC
 */
function parseAndNormalizeDate(dateInput: string): Date {
  const parsed = new Date(dateInput);
  if (isNaN(parsed.getTime())) {
    throw new Error('Invalid date format');
  }

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

  const trimmed = remarks.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.length > 500) {
    throw new Error('Remarks must not exceed 500 characters');
  }

  return validator.escape(trimmed);
}

/**
 * Generate auto document number
 */
function generateDocumentNumber(companyCode: number, date: Date, recipientName: string): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const timestamp = Date.now().toString().slice(-6);
  const recipientCode = recipientName.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
  return `CG-OUT-${companyCode}-${year}${month}${day}-${recipientCode}-${timestamp}`;
}

/**
 * Calculate priority for snapshot recalculation queue
 * Same-day transactions: priority -1 (queued for EOD processing)
 * Backdated transactions: priority 0 (processed immediately)
 */
function calculatePriority(transactionDate: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const txDate = new Date(transactionDate);
  txDate.setHours(0, 0, 0, 0);

  return txDate < today ? 0 : -1;
}

/**
 * Interface for validated record
 */
interface ValidatedRecord {
  index: number;
  date: Date;
  itemCode: string;
  recipientName: string;
  qty: number;
  currency: 'USD' | 'IDR' | 'CNY' | 'EUR' | 'JPY';
  valueAmount: number;
  remarks: string | null;
}

/**
 * Interface for grouped transaction
 */
interface GroupedTransaction {
  date: Date;
  recipientName: string;
  items: Array<{
    itemCode: string;
    qty: number;
    currency: 'USD' | 'IDR' | 'CNY' | 'EUR' | 'JPY';
    valueAmount: number;
    remarks: string | null;
  }>;
}

/**
 * POST /api/customs/capital-goods/outgoing/import
 * Batch import capital goods outgoing transactions from Excel
 *
 * Request body:
 * {
 *   records: [{
 *     date: string,
 *     itemCode: string,
 *     recipientName: string,
 *     qty: number,
 *     currency: string,
 *     valueAmount: number,
 *     remarks?: string
 *   }]
 * }
 *
 * Logic:
 * 1. Validate all records
 * 2. Limit batch size to 1000 records
 * 3. Group records by date + recipientName to create transactions
 * 4. For each group, create one outgoing_goods transaction with multiple items
 * 5. Use serializable transaction for data consistency
 */
export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Parse request body
    const body = await request.json();
    const { records } = body;

    // Validate that records array is provided
    if (!Array.isArray(records) || records.length === 0) {
      return NextResponse.json(
        { message: 'Invalid request: records array is required and must not be empty' },
        { status: 400 }
      );
    }

    // Limit batch size to prevent resource exhaustion
    if (records.length > 1000) {
      return NextResponse.json(
        { message: 'Batch size exceeds maximum limit of 1000 records' },
        { status: 400 }
      );
    }

    const validationErrors: Array<{ index: number; record: any; error: string }> = [];
    const validatedRecords: ValidatedRecord[] = [];

    // Get current date for future date validation
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Validate all records first
    for (let i = 0; i < records.length; i++) {
      const record = records[i];

      // Validate required fields
      const validationResult = ImportRecordSchema.safeParse(record);
      if (!validationResult.success) {
        validationErrors.push({
          index: i,
          record,
          error: validationResult.error.issues.map(e => e.message).join(', '),
        });
        continue;
      }

      const { date, itemCode, recipientName, qty, currency, valueAmount, remarks } = validationResult.data;

      // Validate and normalize date
      let parsedDate: Date;
      try {
        parsedDate = parseAndNormalizeDate(date);
      } catch (error) {
        validationErrors.push({
          index: i,
          record,
          error: 'Invalid date format',
        });
        continue;
      }

      // Validate date is not in the future
      if (parsedDate > today) {
        validationErrors.push({
          index: i,
          record,
          error: 'Date cannot be in the future',
        });
        continue;
      }

      // Sanitize remarks
      let sanitizedRemarks: string | null = null;
      try {
        sanitizedRemarks = sanitizeRemarks(remarks);
      } catch (error: any) {
        validationErrors.push({
          index: i,
          record,
          error: error.message,
        });
        continue;
      }

      validatedRecords.push({
        index: i,
        date: parsedDate,
        itemCode: itemCode.trim(),
        recipientName: recipientName.trim(),
        qty,
        currency,
        valueAmount,
        remarks: sanitizedRemarks,
      });
    }

    // If all records failed validation, return early
    if (validatedRecords.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'All records failed validation',
          successCount: 0,
          errorCount: validationErrors.length,
          errors: validationErrors,
        },
        { status: 400 }
      );
    }

    // Get all unique item codes for batch lookup
    const itemCodes = [...new Set(validatedRecords.map(r => r.itemCode))];

    // Lookup all items in beginning_balances (capital goods only)
    const foundItems = await prisma.beginning_balances.findMany({
      where: {
        company_code: companyCode,
        item_code: { in: itemCodes },
        item_type: { in: ['HIBE_M', 'HIBE_E', 'HIBE_T'] },
      },
      select: {
        item_code: true,
        item_name: true,
        item_type: true,
        uom: true,
      },
      distinct: ['item_code'],
    });

    // Create a map for quick lookup
    const itemMap = new Map(foundItems.map(item => [item.item_code, item]));

    // Validate all items exist and filter out invalid ones
    const validRecords: ValidatedRecord[] = [];
    for (const record of validatedRecords) {
      if (!itemMap.has(record.itemCode)) {
        validationErrors.push({
          index: record.index,
          record: records[record.index],
          error: `Invalid itemCode: Capital goods item '${record.itemCode}' does not exist or is not a capital goods type (HIBE_M, HIBE_E, HIBE_T)`,
        });
      } else {
        validRecords.push(record);
      }
    }

    // If no valid records after item validation, return early
    if (validRecords.length === 0) {
      return NextResponse.json(
        {
          success: false,
          message: 'No valid records to import after validation',
          successCount: 0,
          errorCount: validationErrors.length,
          errors: validationErrors,
        },
        { status: 400 }
      );
    }

    // Group records by date + recipientName
    const groupMap = new Map<string, GroupedTransaction>();

    for (const record of validRecords) {
      const groupKey = `${record.date.toISOString()}_${record.recipientName}`;

      if (!groupMap.has(groupKey)) {
        groupMap.set(groupKey, {
          date: record.date,
          recipientName: record.recipientName,
          items: [],
        });
      }

      groupMap.get(groupKey)!.items.push({
        itemCode: record.itemCode,
        qty: record.qty,
        currency: record.currency,
        valueAmount: record.valueAmount,
        remarks: record.remarks,
      });
    }

    // Validate stock availability for all items grouped by date
    // Since different records can have different dates, validate per-date
    const recordsByDate = new Map<string, typeof validRecords>();
    
    for (const record of validRecords) {
      const dateKey = record.date.toISOString().split('T')[0]; // YYYY-MM-DD
      if (!recordsByDate.has(dateKey)) {
        recordsByDate.set(dateKey, []);
      }
      recordsByDate.get(dateKey)!.push(record);
    }

    // Validate stock for each date group
    for (const [dateStr, recordsForDate] of recordsByDate) {
      const dateObj = new Date(dateStr);
      
      const itemsToValidate = recordsForDate.map(record => {
        const masterItem = itemMap.get(record.itemCode)!;
        return {
          itemCode: record.itemCode,
          itemType: masterItem.item_type,
          qtyRequested: record.qty,
        };
      });

      const stockValidation = await checkBatchStockAvailability(
        companyCode,
        itemsToValidate,
        dateObj  // ✅ Pass transaction date for historical stock validation
      );

      if (!stockValidation.allAvailable) {
        const insufficientItems = stockValidation.results
          .filter(r => !r.available)
          .map(r => `${r.itemCode} (${r.itemType}): stock pada ${dateStr} adalah ${r.currentStock}, diminta ${r.qtyRequested}`);

        return NextResponse.json(
          {
            success: false,
            message: `Import ditolak: stock tidak mencukupi pada tanggal ${dateStr} untuk item berikut`,
            errors: insufficientItems.map((msg, idx) => ({
              index: idx,
              record: null,
              error: msg,
            })),
          },
          { status: 400 }
        );
      }
    }

    // Process all grouped transactions
    let successCount = 0;

    try {
      await prisma.$transaction(async (tx) => {
        for (const [groupKey, group] of groupMap) {
          const documentNumber = generateDocumentNumber(companyCode, group.date, group.recipientName);

          // Create outgoing_goods record
          const outgoingGoods = await tx.outgoing_goods.create({
            data: {
              wms_id: `CG-IMPORT-${Date.now()}-${groupKey}`,
              company_code: companyCode,
              owner: companyCode,
              customs_document_type: 'BC25',
              ppkek_number: documentNumber,
              customs_registration_date: group.date,
              outgoing_evidence_number: documentNumber,
              outgoing_date: group.date,
              invoice_number: documentNumber,
              invoice_date: group.date,
              recipient_name: group.recipientName,
              timestamp: new Date(),
            },
          });

          // Create outgoing_good_items records
          const itemRecords = group.items.map(item => {
            const masterItem = itemMap.get(item.itemCode)!;
            return {
              outgoing_good_id: outgoingGoods.id,
              outgoing_good_company: companyCode,
              outgoing_good_date: group.date,
              item_type: masterItem.item_type,
              item_code: item.itemCode,
              item_name: masterItem.item_name,
              production_output_wms_ids: [],
              hs_code: null,
              uom: masterItem.uom,
              qty: new Prisma.Decimal(item.qty),
              currency: item.currency as any,
              amount: new Prisma.Decimal(item.valueAmount),
            };
          });

          await tx.outgoing_good_items.createMany({
            data: itemRecords,
          });

          // Queue snapshot recalculation for each item
          const priority = calculatePriority(group.date);

          for (const itemRecord of itemRecords) {
            await tx.snapshot_recalc_queue.upsert({
              where: {
                company_code_recalc_date_item_type_item_code: {
                  company_code: companyCode,
                  recalc_date: group.date,
                  item_type: itemRecord.item_type,
                  item_code: itemRecord.item_code,
                },
              },
              create: {
                company_code: companyCode,
                item_type: itemRecord.item_type,
                item_code: itemRecord.item_code,
                recalc_date: group.date,
                status: 'PENDING',
                priority: priority,
                reason: `Capital goods outgoing import: ${outgoingGoods.wms_id}`,
              },
              update: {
                status: 'PENDING',
                priority: priority,
                reason: `Capital goods outgoing import: ${outgoingGoods.wms_id}`,
                queued_at: new Date(),
              },
            });
          }

          successCount += group.items.length;
        }
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 30000,
      });

      const finalSuccess = validationErrors.length === 0;

      return NextResponse.json({
        success: finalSuccess,
        message: finalSuccess
          ? `Successfully imported ${successCount} records in ${groupMap.size} transactions`
          : `Imported ${successCount} records with ${validationErrors.length} errors`,
        successCount,
        errorCount: validationErrors.length,
        transactionCount: groupMap.size,
        errors: validationErrors,
      });
    } catch (error: any) {
      console.error('[API Error] Transaction failed during import:', error);

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
            message: 'Foreign key constraint failed - invalid reference',
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
  } catch (error: any) {
    console.error('[API Error] Failed to import capital goods outgoing transactions:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error importing capital goods outgoing transactions', error: error.message },
      { status: 500 }
    );
  }
}
