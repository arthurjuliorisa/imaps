import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { parseCeisa40Excel, validateParsedData, type ParsedCeisaData } from '@/lib/ceisa40ExcelParser';
import { checkBatchStockAvailability } from '@/lib/utils/stock-checker';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

/**
 * Zod schema for import request validation
 */
const ImportRequestSchema = z.object({
  transactionType: z.enum(['SCRAP', 'CAPITAL_GOODS']),
  direction: z.enum(['IN', 'OUT']),
});

type ImportRequest = z.infer<typeof ImportRequestSchema>;

/**
 * Generate unique WMS ID for transactions
 */
function generateWmsId(type: string, direction: string): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${type}-${direction}-${timestamp}-${random}`;
}

/**
 * Calculate priority for snapshot recalculation queue
 */
function calculatePriority(transactionDate: Date): number {
  const now = new Date();
  const today = new Date(Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  ));

  if (transactionDate < today) {
    return 0; // Backdated transaction
  }
  return -1; // Same-day transaction
}

/**
 * Normalize date to UTC midnight
 */
function normalizeDate(dateStr: string): Date {
  const parsed = new Date(dateStr);
  if (isNaN(parsed.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  return new Date(Date.UTC(
    parsed.getFullYear(),
    parsed.getMonth(),
    parsed.getDate(),
    0, 0, 0, 0
  ));
}

/**
 * Map document type code to enum value
 * Converts "25" to "BC25", "27" to "BC27", "41" to "BC41", etc.
 * Valid document types for outgoing transactions: BC25, BC27, BC41
 */
function mapDocumentTypeToEnum(docType: string): string {
  const cleanType = docType.trim();

  // If already prefixed with BC, return as-is
  if (cleanType.startsWith('BC')) {
    return cleanType;
  }

  // Add BC prefix
  return `BC${cleanType}`;
}

/**
 * POST /api/customs/import-ceisa-excel
 * Import Ceisa 4.0 Excel file and create transactions
 *
 * @formdata file - Excel file (.xlsx)
 * @formdata transactionType - SCRAP or CAPITAL_GOODS
 * @formdata direction - IN or OUT
 *
 * @returns Summary of imported transactions
 */
export async function POST(request: Request) {
  try {
    // Check authentication
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };

    // Validate company code
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const transactionType = formData.get('transactionType') as string;
    const direction = formData.get('direction') as string;
    const itemType = formData.get('itemType') as string | null;

    if (!file) {
      return NextResponse.json(
        { message: 'No file provided' },
        { status: 400 }
      );
    }

    // Validate file type
    if (!file.name.endsWith('.xlsx')) {
      return NextResponse.json(
        { message: 'Invalid file type. Only .xlsx files are supported.' },
        { status: 400 }
      );
    }

    // Validate transaction type and direction
    let validatedRequest: ImportRequest;
    try {
      validatedRequest = ImportRequestSchema.parse({
        transactionType,
        direction,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            message: 'Validation failed',
            errors: error.issues.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
          },
          { status: 400 }
        );
      }
      throw error;
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Parse Excel file
    let parsedData: ParsedCeisaData;
    try {
      parsedData = await parseCeisa40Excel(buffer);
    } catch (error) {
      console.error('[Excel Parse Error]', error);
      return NextResponse.json(
        {
          message: error instanceof Error ? error.message : 'Failed to parse Excel file',
        },
        { status: 400 }
      );
    }

    // Validate parsed data
    const validationErrors = validateParsedData(parsedData);
    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          message: 'Excel data validation failed',
          errors: validationErrors,
        },
        { status: 400 }
      );
    }

    // Validate dates
    const docDate = normalizeDate(parsedData.docDate);
    const regDate = normalizeDate(parsedData.regDate);

    const now = new Date();
    const today = new Date(Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0
    ));

    if (docDate > today) {
      return NextResponse.json(
        { message: 'Document date cannot be in the future' },
        { status: 400 }
      );
    }

    // Process import based on transaction type
    let result;
    if (validatedRequest.transactionType === 'SCRAP') {
      result = await importScrapTransactions(
        companyCode,
        parsedData,
        validatedRequest.direction,
        docDate,
        regDate
      );
    } else {
      // Validate item type for capital goods
      if (!itemType || !['HIBE_M', 'HIBE_E', 'HIBE_T'].includes(itemType)) {
        return NextResponse.json(
          { message: 'Item type is required for capital goods and must be one of: HIBE_M, HIBE_E, HIBE_T' },
          { status: 400 }
        );
      }

      result = await importCapitalGoodsTransactions(
        companyCode,
        parsedData,
        validatedRequest.direction,
        docDate,
        regDate,
        itemType
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Import completed successfully',
        data: result,
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('[API Error] Failed to import Ceisa Excel:', error);

    // Handle specific Prisma errors
    if (error.code === 'P2002') {
      return NextResponse.json(
        { message: 'Duplicate transaction detected', error: error.message },
        { status: 400 }
      );
    }

    if (error.code === 'P2003') {
      return NextResponse.json(
        { message: 'Foreign key constraint failed', error: error.message },
        { status: 400 }
      );
    }

    if (error.code === 'P2034') {
      return NextResponse.json(
        { message: 'Transaction conflict detected. Please retry.', error: error.message },
        { status: 409 }
      );
    }

    return NextResponse.json(
      {
        message: error.message || 'Error importing Excel file',
        error: error.message
      },
      { status: 500 }
    );
  }
}

/**
 * Import scrap transactions (incoming or outgoing)
 */
async function importScrapTransactions(
  companyCode: number,
  data: ParsedCeisaData,
  direction: string,
  docDate: Date,
  regDate: Date
) {
  return await prisma.$transaction(async (tx) => {
    const wmsId = generateWmsId('SCRAP', direction);
    const importedItems: any[] = [];

    if (direction === 'IN') {
      // Create incoming_goods record
      const incomingGood = await tx.incoming_goods.create({
        data: {
          wms_id: wmsId,
          company_code: companyCode,
          owner: companyCode,
          customs_document_type: mapDocumentTypeToEnum(data.docType || '27') as any,
          ppkek_number: data.ppkekNumber,
          customs_registration_date: regDate,
          incoming_evidence_number: data.docNumber,
          incoming_date: docDate,
          invoice_number: data.docNumber,
          invoice_date: docDate,
          shipper_name: data.recipientName || 'Unknown',
          timestamp: new Date(),
        },
      });

      // Create incoming_good_items for each item
      for (const item of data.items) {
        await tx.incoming_good_items.create({
          data: {
            incoming_good_id: incomingGood.id,
            incoming_good_company: companyCode,
            incoming_good_date: docDate,
            item_type: 'SCRAP',
            item_code: item.itemCode,
            item_name: item.itemName,
            hs_code: null,
            uom: item.unit,
            qty: new Prisma.Decimal(item.quantity),
            currency: data.currency as any,
            amount: new Prisma.Decimal(item.valueAmount),
          },
        });

        importedItems.push({
          itemCode: item.itemCode,
          itemName: item.itemName,
          quantity: item.quantity,
        });

        // Queue snapshot recalculation
        const priority = calculatePriority(docDate);
        await tx.snapshot_recalc_queue.upsert({
          where: {
            company_code_recalc_date_item_type_item_code: {
              company_code: companyCode,
              recalc_date: docDate,
              item_type: 'SCRAP',
              item_code: item.itemCode,
            },
          },
          create: {
            company_code: companyCode,
            item_type: 'SCRAP',
            item_code: item.itemCode,
            recalc_date: docDate,
            status: 'PENDING',
            priority: priority,
            reason: `Excel import: ${wmsId}`,
          },
          update: {
            status: 'PENDING',
            priority: priority,
            reason: `Excel import: ${wmsId}`,
            queued_at: new Date(),
          },
        });
      }

      return {
        wmsId,
        transactionId: incomingGood.id,
        direction: 'IN',
        itemCount: importedItems.length,
        items: importedItems,
      };
    } else {
      // Validate stock availability for all items (all-or-nothing)
      const itemsToValidate = data.items.map(item => ({
        itemCode: item.itemCode,
        itemType: 'SCRAP',
        qtyRequested: item.quantity,
      }));

      const stockValidation = await checkBatchStockAvailability(
        companyCode,
        itemsToValidate
      );

      if (!stockValidation.allAvailable) {
        const insufficientItems = stockValidation.results
          .filter(r => !r.available)
          .map(r => `${r.itemCode}: stock ${r.currentStock}, diminta ${r.qtyRequested}`);

        throw new Error(`Import ditolak: stock tidak mencukupi untuk item berikut: ${insufficientItems.join('; ')}`);
      }

      // Create outgoing_goods record
      const outgoingGood = await tx.outgoing_goods.create({
        data: {
          wms_id: wmsId,
          company_code: companyCode,
          owner: companyCode,
          customs_document_type: mapDocumentTypeToEnum(data.docType || '27') as any,
          ppkek_number: data.ppkekNumber,
          customs_registration_date: regDate,
          outgoing_evidence_number: data.docNumber,
          outgoing_date: docDate,
          invoice_number: data.docNumber,
          invoice_date: docDate,
          recipient_name: data.recipientName || 'Unknown',
          timestamp: new Date(),
        },
      });

      // Create outgoing_good_items for each item
      for (const item of data.items) {
        await tx.outgoing_good_items.create({
          data: {
            outgoing_good_id: outgoingGood.id,
            outgoing_good_company: companyCode,
            outgoing_good_date: docDate,
            item_type: 'SCRAP',
            item_code: item.itemCode,
            item_name: item.itemName,
            hs_code: null,
            uom: item.unit,
            qty: new Prisma.Decimal(item.quantity),
            currency: data.currency as any,
            amount: new Prisma.Decimal(item.valueAmount),
          },
        });

        importedItems.push({
          itemCode: item.itemCode,
          itemName: item.itemName,
          quantity: item.quantity,
        });

        // Queue snapshot recalculation
        const priority = calculatePriority(docDate);
        await tx.snapshot_recalc_queue.upsert({
          where: {
            company_code_recalc_date_item_type_item_code: {
              company_code: companyCode,
              recalc_date: docDate,
              item_type: 'SCRAP',
              item_code: item.itemCode,
            },
          },
          create: {
            company_code: companyCode,
            item_type: 'SCRAP',
            item_code: item.itemCode,
            recalc_date: docDate,
            status: 'PENDING',
            priority: priority,
            reason: `Excel import: ${wmsId}`,
          },
          update: {
            status: 'PENDING',
            priority: priority,
            reason: `Excel import: ${wmsId}`,
            queued_at: new Date(),
          },
        });
      }

      return {
        wmsId,
        transactionId: outgoingGood.id,
        direction: 'OUT',
        itemCount: importedItems.length,
        items: importedItems,
      };
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 60000,
  });
}

/**
 * Import capital goods transactions (incoming or outgoing)
 */
async function importCapitalGoodsTransactions(
  companyCode: number,
  data: ParsedCeisaData,
  direction: string,
  docDate: Date,
  regDate: Date,
  itemType: string
) {
  return await prisma.$transaction(async (tx) => {
    const wmsId = generateWmsId('CAPITAL', direction);
    const importedItems: any[] = [];

    if (direction === 'IN') {
      // Capital goods incoming is not supported
      // Only outgoing capital goods transactions are available
      throw new Error('Capital goods incoming transactions are not supported. Only outgoing transactions are available.');
    } else {
      // Validate stock availability for all items (all-or-nothing)
      const itemsToValidate = data.items.map(item => ({
        itemCode: item.itemCode,
        itemType: itemType,
        qtyRequested: item.quantity,
      }));

      const stockValidation = await checkBatchStockAvailability(
        companyCode,
        itemsToValidate
      );

      if (!stockValidation.allAvailable) {
        const insufficientItems = stockValidation.results
          .filter(r => !r.available)
          .map(r => `${r.itemCode}: stock ${r.currentStock}, diminta ${r.qtyRequested}`);

        throw new Error(`Import ditolak: stock tidak mencukupi untuk item berikut: ${insufficientItems.join('; ')}`);
      }

      // Create outgoing_goods record for capital goods
      const outgoingGood = await tx.outgoing_goods.create({
        data: {
          wms_id: wmsId,
          company_code: companyCode,
          owner: companyCode,
          customs_document_type: mapDocumentTypeToEnum(data.docType || '27') as any,
          ppkek_number: data.ppkekNumber,
          customs_registration_date: regDate,
          outgoing_evidence_number: data.docNumber,
          outgoing_date: docDate,
          invoice_number: data.docNumber,
          invoice_date: docDate,
          recipient_name: data.recipientName || 'Unknown',
          timestamp: new Date(),
        },
      });

      // Create outgoing_good_items for each item
      for (const item of data.items) {
        await tx.outgoing_good_items.create({
          data: {
            outgoing_good_id: outgoingGood.id,
            outgoing_good_company: companyCode,
            outgoing_good_date: docDate,
            item_type: itemType,
            item_code: item.itemCode,
            item_name: item.itemName,
            production_output_wms_ids: [],
            hs_code: null,
            uom: item.unit,
            qty: new Prisma.Decimal(item.quantity),
            currency: data.currency as any,
            amount: new Prisma.Decimal(item.valueAmount),
          },
        });

        importedItems.push({
          itemCode: item.itemCode,
          itemName: item.itemName,
          itemType: itemType,
          quantity: item.quantity,
        });

        // Queue snapshot recalculation
        const priority = calculatePriority(docDate);
        await tx.snapshot_recalc_queue.upsert({
          where: {
            company_code_recalc_date_item_type_item_code: {
              company_code: companyCode,
              recalc_date: docDate,
              item_type: itemType,
              item_code: item.itemCode,
            },
          },
          create: {
            company_code: companyCode,
            item_type: itemType,
            item_code: item.itemCode,
            recalc_date: docDate,
            status: 'PENDING',
            priority: priority,
            reason: `Excel import: ${wmsId}`,
          },
          update: {
            status: 'PENDING',
            priority: priority,
            reason: `Excel import: ${wmsId}`,
            queued_at: new Date(),
          },
        });
      }

      return {
        wmsId,
        transactionId: outgoingGood.id,
        direction: 'OUT',
        itemCount: importedItems.length,
        items: importedItems,
      };
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    timeout: 60000,
  });
}
