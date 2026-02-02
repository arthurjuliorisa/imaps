import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { logActivity } from '@/lib/log-activity';
import {
  calculateEndStock,
  calculateVariance,
  getItemDetails,
} from '@/lib/stock-opname-helpers';
import { z } from 'zod';
import { Decimal } from '@prisma/client/runtime/library';
import validator from 'validator';

/**
 * Validation schema for import record
 */
const ImportRecordSchema = z.object({
  itemCode: z.string().min(1, 'Item code is required'),
  stoQty: z.number().nonnegative('STO quantity must be non-negative'),
  reportArea: z
    .string()
    .max(100, 'Report area must not exceed 100 characters')
    .optional(),
  remark: z.string().max(1000, 'Remark must not exceed 1000 characters').optional(),
});

/**
 * Sanitize and validate text input
 */
function sanitizeText(text: string | null | undefined, maxLength: number): string | null {
  if (!text) return null;

  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  if (trimmed.length > maxLength) {
    throw new Error(`Text must not exceed ${maxLength} characters`);
  }

  return validator.escape(trimmed);
}

/**
 * Interface for validated record
 */
interface ValidatedRecord {
  index: number;
  itemCode: string;
  stoQty: Decimal;
  reportArea: string | null;
  remark: string | null;
}

/**
 * POST /api/customs/stock-opname/[id]/items/upload
 * Bulk upload items from Excel file
 *
 * Request body:
 * {
 *   records: [{
 *     itemCode: string,
 *     stoQty: number,
 *     reportArea?: string,
 *     remark?: string
 *   }]
 * }
 *
 * Logic:
 * 1. Validate all records
 * 2. Limit batch size to 500 records
 * 3. Check for duplicate item codes
 * 4. Verify all items exist in items master
 * 5. Calculate end stock and variance for each item
 * 6. Insert all items in a single transaction
 * 7. Update stock opname status to PROCESS
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const { id } = await params;
    const stockOpnameId = parseInt(id);

    if (isNaN(stockOpnameId)) {
      return NextResponse.json(
        { message: 'Invalid stock opname ID' },
        { status: 400 }
      );
    }

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
    if (records.length > 500) {
      return NextResponse.json(
        { message: 'Batch size exceeds maximum limit of 500 records' },
        { status: 400 }
      );
    }

    // Get stock opname header
    const stockOpname = await prisma.stock_opnames.findFirst({
      where: {
        id: stockOpnameId,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!stockOpname) {
      return NextResponse.json(
        { message: 'Stock opname not found' },
        { status: 404 }
      );
    }

    const validationErrors: Array<{ index: number; record: any; error: string }> = [];
    const validatedRecords: ValidatedRecord[] = [];
    const itemCodeSet = new Set<string>();

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

      const { itemCode, stoQty, reportArea, remark } = validationResult.data;

      // Check for duplicate item codes within the upload
      if (itemCodeSet.has(itemCode)) {
        validationErrors.push({
          index: i,
          record,
          error: `Duplicate item code: ${itemCode}`,
        });
        continue;
      }

      itemCodeSet.add(itemCode);

      // Sanitize text fields
      let sanitizedReportArea: string | null = null;
      let sanitizedRemark: string | null = null;

      try {
        sanitizedReportArea = sanitizeText(reportArea, 100);
        sanitizedRemark = sanitizeText(remark, 1000);
      } catch (error) {
        validationErrors.push({
          index: i,
          record,
          error: error instanceof Error ? error.message : 'Validation error',
        });
        continue;
      }

      validatedRecords.push({
        index: i,
        itemCode,
        stoQty: new Decimal(stoQty),
        reportArea: sanitizedReportArea,
        remark: sanitizedRemark,
      });
    }

    // If there are validation errors, return them
    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          message: 'Validation failed for some records',
          errors: validationErrors,
          successCount: 0,
          errorCount: validationErrors.length,
        },
        { status: 400 }
      );
    }

    // Check for existing items in this stock opname
    const existingItems = await prisma.stock_opname_items.findMany({
      where: {
        stock_opname_id: stockOpnameId,
        item_code: { in: Array.from(itemCodeSet) },
        deleted_at: null,
      },
      select: { item_code: true },
    });

    if (existingItems.length > 0) {
      const existingCodes = existingItems.map(item => item.item_code);
      return NextResponse.json(
        {
          message: `The following item codes already exist in this stock opname: ${existingCodes.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Verify all items exist in items master
    const itemsFromMaster = await prisma.items.findMany({
      where: {
        company_code: companyCode,
        item_code: { in: Array.from(itemCodeSet) },
        deleted_at: null,
        is_active: true,
      },
      select: {
        item_code: true,
        item_name: true,
        item_type: true,
        uom: true,
      },
    });

    const itemsMap = new Map(
      itemsFromMaster.map(item => [item.item_code, item])
    );

    // Check for items not found in master
    const notFoundItems: string[] = [];
    for (const record of validatedRecords) {
      if (!itemsMap.has(record.itemCode)) {
        notFoundItems.push(record.itemCode);
      }
    }

    if (notFoundItems.length > 0) {
      return NextResponse.json(
        {
          message: `The following item codes were not found or are inactive: ${notFoundItems.join(', ')}`,
        },
        { status: 400 }
      );
    }

    // Insert all items in a single transaction
    const result = await prisma.$transaction(async (tx) => {
      const createdItems = [];

      for (const record of validatedRecords) {
        const itemDetails = itemsMap.get(record.itemCode)!;

        // Calculate end stock based on sto_datetime
        const endStock = await calculateEndStock(
          companyCode,
          record.itemCode,
          stockOpname.sto_datetime
        );

        // Calculate variance
        const variance = calculateVariance(record.stoQty, endStock);

        // Create item
        const item = await tx.stock_opname_items.create({
          data: {
            stock_opname_id: stockOpnameId,
            company_code: companyCode,
            item_code: record.itemCode,
            item_name: itemDetails.item_name,
            item_type: itemDetails.item_type,
            uom: itemDetails.uom,
            sto_qty: record.stoQty,
            end_stock: endStock,
            variant: variance,
            report_area: record.reportArea,
            remark: record.remark,
          },
        });

        createdItems.push(item);
      }

      // Update stock opname status to PROCESS if it's OPEN
      if (stockOpname.status === 'OPEN') {
        await tx.stock_opnames.update({
          where: { id: stockOpnameId },
          data: { status: 'PROCESS' },
        });
      }

      return createdItems;
    });

    // Log activity
    await logActivity({
      action: 'BULK_UPLOAD_STOCK_OPNAME_ITEMS',
      description: `Bulk uploaded ${result.length} items to stock opname ${stockOpname.sto_number}`,
      status: 'success',
      metadata: {
        stock_opname_id: stockOpnameId,
        sto_number: stockOpname.sto_number,
        items_count: result.length,
      },
    });

    return NextResponse.json({
      message: `Successfully uploaded ${result.length} items`,
      successCount: result.length,
      errorCount: 0,
      items: serializeBigInt(result),
    });
  } catch (error) {
    console.error('[API Error] Failed to bulk upload stock opname items:', error);

    // Log failed activity
    await logActivity({
      action: 'BULK_UPLOAD_STOCK_OPNAME_ITEMS',
      description: 'Failed to bulk upload stock opname items',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Error uploading stock opname items' },
      { status: 500 }
    );
  }
}
