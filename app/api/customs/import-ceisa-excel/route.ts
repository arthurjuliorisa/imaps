import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { parseCeisa40Excel, validateParsedData, type ParsedCeisaData } from '@/lib/ceisa40ExcelParser';
import { checkBatchStockAvailability } from '@/lib/utils/stock-checker';
import { logActivity } from '@/lib/log-activity';
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
 * Validate scrap items against scrap_items table
 * Checks if scrap_code exists, scrap_name matches, and UOM matches
 */
async function validateScrapItems(
  tx: any,
  items: Array<{ itemCode: string; itemName: string; unit: string }>
): Promise<void> {
  for (const item of items) {
    const scrapItem = await tx.scrap_items.findUnique({
      where: { scrap_code: item.itemCode },
      select: { scrap_code: true, scrap_name: true, uom: true },
    });

    if (!scrapItem) {
      throw new Error(
        `Scrap code '${item.itemCode}' tidak ditemukan di database scrap_items`
      );
    }

    if (scrapItem.scrap_name !== item.itemName) {
      throw new Error(
        `Scrap name tidak sesuai untuk kode '${item.itemCode}': Excel="${item.itemName}", Database="${scrapItem.scrap_name}"`
      );
    }

    if (scrapItem.uom !== item.unit) {
      throw new Error(
        `UOM tidak sesuai untuk scrap '${item.itemCode}': Excel="${item.unit}", Database="${scrapItem.uom}"`
      );
    }
  }
}

/**
 * Valid customs document types enum
 * These must match Prisma schema CustomsDocumentType enum
 */
const VALID_CUSTOMS_DOCUMENT_TYPES = [
  'BC23',  // Import Declaration
  'BC27',  // Other Bonded Zone Release (Incoming & Outgoing)
  'BC40',  // Local Purchase from Non-Bonded Zone
  'BC30',  // Export Declaration
  'BC25',  // Local Sales to Non-Bonded Zone
  'BC261', // Subcontracting - Incoming
  'BC262', // Subcontracting - Outgoing
  'PPKEKTLDDP',  // PPKEK incoming for TLDDP
  'PPKEKLDIN',   // PPKEK incoming for LDP
  'PPKEKLDPOUT', // PPKEK outgoing for LDP
] as const;

/**
 * Map document type code to enum value and validate
 * Converts "25" to "BC25", "27" to "BC27", "41" to "BC41", etc.
 * Also validates that the result is a valid enum value
 * 
 * @throws Error if document type is not valid
 */
function mapDocumentTypeToEnum(docType: string): string {
  const cleanType = docType.trim();

  // Determine the mapped type
  let mappedType: string;
  
  // If already prefixed with BC, use as-is
  if (cleanType.startsWith('BC') || cleanType.startsWith('PPKEK')) {
    mappedType = cleanType;
  } else {
    // Add BC prefix
    mappedType = `BC${cleanType}`;
  }

  // Validate against allowed enum values
  if (!VALID_CUSTOMS_DOCUMENT_TYPES.includes(mappedType as any)) {
    throw new Error(
      `Invalid customs document type: '${cleanType}' (mapped to '${mappedType}'). ` +
      `Allowed values: ${VALID_CUSTOMS_DOCUMENT_TYPES.join(', ')}`
    );
  }

  return mappedType;
}

/**
 * Aggregate items by itemCode to handle multiple rows with same item code
 * Example:
 *   Row 1: Part A qty 10
 *   Row 2: Part A qty 5
 *   Result: Part A qty 15 (aggregated)
 *
 * Returns Map<itemCode, aggregatedQty> for validation
 * Also validates that all rows with same itemCode have same itemName and unit
 */
function aggregateItemsByCode(
  items: Array<{ itemCode: string; itemName: string; unit: string; quantity: number }>
): Map<string, { totalQty: number; itemName: string; unit: string }> {
  const aggregated = new Map<string, { totalQty: number; itemName: string; unit: string }>();

  for (const item of items) {
    if (!aggregated.has(item.itemCode)) {
      aggregated.set(item.itemCode, {
        totalQty: item.quantity,
        itemName: item.itemName,
        unit: item.unit,
      });
    } else {
      // Item code already exists - aggregate qty
      const existing = aggregated.get(item.itemCode)!;
      existing.totalQty += item.quantity;

      // Validate consistency: itemName and unit should be the same
      if (existing.itemName !== item.itemName) {
        throw new Error(
          `Inconsistent item name for '${item.itemCode}': Row 1="${existing.itemName}", This row="${item.itemName}"`
        );
      }

      if (existing.unit !== item.unit) {
        throw new Error(
          `Inconsistent unit for '${item.itemCode}': Row 1="${existing.unit}", This row="${item.unit}"`
        );
      }
    }
  }

  return aggregated;
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

    // Validate item type exists and is active
    let itemTypesToValidate: string[] = [];
    if (validatedRequest.transactionType === 'SCRAP') {
      itemTypesToValidate = ['SCRAP'];
    } else {
      // Capital goods item types
      if (!itemType || !['HIBE-M', 'HIBE-E', 'HIBE-T'].includes(itemType)) {
        return NextResponse.json(
          { message: 'Item type is required for capital goods and must be one of: HIBE-M, HIBE-E, HIBE-T' },
          { status: 400 }
        );
      }
      itemTypesToValidate = [itemType];
    }

    // Check if all item types are active in database
    const validItemTypes = await prisma.item_types.findMany({
      where: {
        item_type_code: { in: itemTypesToValidate },
        is_active: true,
      },
      select: { item_type_code: true },
    });

    const validCodes = new Set(validItemTypes.map(t => t.item_type_code));
    const invalidTypes = itemTypesToValidate.filter(type => !validCodes.has(type));

    if (invalidTypes.length > 0) {
      return NextResponse.json(
        { message: `Invalid or inactive item type: ${invalidTypes.join(', ')}` },
        { status: 400 }
      );
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
    let snapshotItems: Array<{ itemType: string; itemCode: string; itemName: string; uom: string }> = [];

    if (validatedRequest.transactionType === 'SCRAP') {
      const txResult = await importScrapTransactions(
        companyCode,
        parsedData,
        validatedRequest.direction,
        docDate,
        regDate
      );
      result = txResult.result;
      snapshotItems = txResult.snapshotItems;
    } else {
      const txResult = await importCapitalGoodsTransactions(
        companyCode,
        parsedData,
        validatedRequest.direction,
        docDate,
        regDate,
        itemType as string
      );
      result = txResult.result;
      snapshotItems = txResult.snapshotItems;
    }

    // Execute direct snapshot recalculation for all affected items (outside transaction, non-blocking)
    if (snapshotItems.length > 0) {
      // Fire-and-forget: execute snapshots in background without waiting
      (async () => {
        for (const item of snapshotItems) {
          try {
            // Step 1: Upsert snapshot for the import date
            await prisma.$executeRawUnsafe(
              'SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)',
              companyCode,
              item.itemType,
              item.itemCode,
              item.itemName,
              item.uom,
              docDate
            );
            console.log(
              '[API Info] Direct snapshot calculation executed',
              {
                companyCode,
                itemType: item.itemType,
                itemCode: item.itemCode,
                date: docDate.toISOString().split('T')[0],
              }
            );

            // Step 2: Cascade recalculate snapshots for all future dates
            // This ensures all forward-looking balance updates when importing transactions
            await prisma.$executeRawUnsafe(
              'SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)',
              companyCode,
              item.itemType,
              item.itemCode,
              docDate
            );
            console.log(
              '[API Info] Cascaded snapshot recalculation executed',
              {
                companyCode,
                itemType: item.itemType,
                itemCode: item.itemCode,
                fromDate: docDate.toISOString().split('T')[0],
              }
            );
          } catch (snapshotError) {
            console.error(
              '[API Error] Snapshot calculation failed',
              {
                companyCode,
                itemType: item.itemType,
                itemCode: item.itemCode,
                date: docDate.toISOString().split('T')[0],
                errorMessage: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
              }
            );
          }
        }
      })().catch(err => console.error('[API Error] Background snapshot task failed:', err));
    }

    // Log activity
    await logActivity({
      action: `IMPORT_${validatedRequest.transactionType}_${validatedRequest.direction}_FROM_EXCEL`,
      description: `Imported ${validatedRequest.transactionType} ${validatedRequest.direction} transactions from Excel: ${file.name}`,
      status: 'success',
      metadata: {
        fileName: file.name,
        transactionType: validatedRequest.transactionType,
        direction: validatedRequest.direction,
        itemType: itemType || 'N/A',
        companyCode,
        result,
      },
    });

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
 * Returns both the transaction result and list of items affected for direct snapshot calculation
 */
async function importScrapTransactions(
  companyCode: number,
  data: ParsedCeisaData,
  direction: string,
  docDate: Date,
  regDate: Date
): Promise<{ result: any; snapshotItems: Array<{ itemType: string; itemCode: string; itemName: string; uom: string }> }> {
  const snapshotItems: Array<{ itemType: string; itemCode: string; itemName: string; uom: string }> = [];

  const result = await prisma.$transaction(async (tx) => {
    // Validate scrap items against scrap_items table
    await validateScrapItems(tx, data.items);

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

      // Prepare all incoming_good_items data
      const incomingGoodItemsData = data.items.map(item => ({
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
      }));

      // Create all incoming_good_items at once
      await tx.incoming_good_items.createMany({
        data: incomingGoodItemsData,
      });

      // Collect snapshot items for direct calculation
      data.items.forEach(item => {
        importedItems.push({
          itemCode: item.itemCode,
          itemName: item.itemName,
          quantity: item.quantity,
        });
        snapshotItems.push({
          itemType: 'SCRAP',
          itemCode: item.itemCode,
          itemName: item.itemName,
          uom: item.unit,
        });
      });

      return {
        wmsId,
        transactionId: incomingGood.id,
        direction: 'IN',
        itemCount: importedItems.length,
        items: importedItems,
      };
    } else {
      // Aggregate items by itemCode to handle multiple rows with same item code
      const aggregatedItems = aggregateItemsByCode(data.items);

      // Validate stock availability for all items as of transaction date (all-or-nothing)
      // ✅ Now validates TOTAL qty across all rows with same itemCode
      const itemsToValidate = Array.from(aggregatedItems.entries()).map(([itemCode, item]) => ({
        itemCode,
        itemType: 'SCRAP',
        qtyRequested: item.totalQty,
      }));

      const stockValidation = await checkBatchStockAvailability(
        companyCode,
        itemsToValidate,
        docDate  // ✅ Pass transaction date for historical stock validation
      );

      if (!stockValidation.allAvailable) {
        const insufficientItems = stockValidation.results
          .filter(r => !r.available)
          .map(r => `${r.itemCode}: stock pada ${docDate.toLocaleDateString('en-US')} adalah ${r.currentStock}, diminta ${r.qtyRequested}`);

        throw new Error(`Import ditolak: stock tidak mencukupi pada tanggal ${docDate.toLocaleDateString('en-US')} untuk item berikut: ${insufficientItems.join('; ')}`);
      }

      // Create scrap_transactions header (for snapshot calculation to query scrap_transaction_items)
      const scrapTransaction = await tx.scrap_transactions.create({
        data: {
          company_code: companyCode,
          transaction_date: docDate,
          transaction_type: 'OUT',
          document_number: data.docNumber,
          recipient_name: data.recipientName || 'Unknown',
          disposal_method: 'Sold as scrap',
          remarks: null,
          ppkek_number: data.ppkekNumber || null,
          customs_registration_date: regDate || null,
          customs_document_type: mapDocumentTypeToEnum(data.docType || '27') as any,
          timestamp: new Date(),
        },
      });

      // Create scrap_transaction_items for each item (for snapshot calculation to query)
      const scrapTransactionItemsData = data.items.map(item => ({
        scrap_transaction_id: scrapTransaction.id,
        scrap_transaction_company: companyCode,
        scrap_transaction_date: docDate,
        item_type: 'SCRAP',
        item_code: item.itemCode,
        item_name: item.itemName,
        uom: item.unit,
        qty: new Prisma.Decimal(item.quantity),
        currency: data.currency as any,
        amount: new Prisma.Decimal(item.valueAmount),
        scrap_reason: null,
      }));

      await tx.scrap_transaction_items.createMany({
        data: scrapTransactionItemsData,
      });

      // Create outgoing_goods record (for WMS integration)
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

      // Prepare all outgoing_good_items data
      const outgoingGoodItemsData = data.items.map(item => ({
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
        incoming_ppkek_numbers: item.incomingPpkekNumbers || [],
      }));

      // Create all outgoing_good_items at once
      await tx.outgoing_good_items.createMany({
        data: outgoingGoodItemsData,
      });

      // Collect snapshot items for direct calculation
      data.items.forEach(item => {
        importedItems.push({
          itemCode: item.itemCode,
          itemName: item.itemName,
          quantity: item.quantity,
        });
        // Add to snapshot items if not already added (for aggregated items)
        if (!snapshotItems.some(s => s.itemCode === item.itemCode)) {
          snapshotItems.push({
            itemType: 'SCRAP',
            itemCode: item.itemCode,
            itemName: item.itemName,
            uom: item.unit,
          });
        }
      });

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

  return { result, snapshotItems };
}

/**
 * Import capital goods transactions (incoming or outgoing)
 * Returns both the transaction result and list of items affected for direct snapshot calculation
 */
async function importCapitalGoodsTransactions(
  companyCode: number,
  data: ParsedCeisaData,
  direction: string,
  docDate: Date,
  regDate: Date,
  itemType: string
): Promise<{ result: any; snapshotItems: Array<{ itemType: string; itemCode: string; itemName: string; uom: string }> }> {
  const snapshotItems: Array<{ itemType: string; itemCode: string; itemName: string; uom: string }> = [];

  const result = await prisma.$transaction(async (tx) => {
    const wmsId = generateWmsId('CAPITAL', direction);
    const importedItems: any[] = [];

    if (direction === 'IN') {
      // Capital goods incoming is not supported
      // Only outgoing capital goods transactions are available
      throw new Error('Capital goods incoming transactions are not supported. Only outgoing transactions are available.');
    } else {
      // Aggregate items by itemCode to handle multiple rows with same item code
      const aggregatedItems = aggregateItemsByCode(data.items);

      // Validate stock availability for all items as of transaction date (all-or-nothing)
      // ✅ Now validates TOTAL qty across all rows with same itemCode
      const itemsToValidate = Array.from(aggregatedItems.entries()).map(([itemCode, item]) => ({
        itemCode,
        itemType: itemType,
        qtyRequested: item.totalQty,
      }));

      const stockValidation = await checkBatchStockAvailability(
        companyCode,
        itemsToValidate,
        docDate  // ✅ Pass transaction date for historical stock validation
      );

      if (!stockValidation.allAvailable) {
        const insufficientItems = stockValidation.results
          .filter(r => !r.available)
          .map(r => `${r.itemCode}: stock pada ${docDate.toLocaleDateString('en-US')} adalah ${r.currentStock}, diminta ${r.qtyRequested}`);

        throw new Error(`Import ditolak: stock tidak mencukupi pada tanggal ${docDate.toLocaleDateString('en-US')} untuk item berikut: ${insufficientItems.join('; ')}`);
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

      // Prepare all outgoing_good_items data
      const outgoingGoodItemsData = data.items.map(item => ({
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
        incoming_ppkek_numbers: item.incomingPpkekNumbers || [],
      }));

      // Create all outgoing_good_items at once
      await tx.outgoing_good_items.createMany({
        data: outgoingGoodItemsData,
      });

      // Collect snapshot items for direct calculation
      data.items.forEach(item => {
        importedItems.push({
          itemCode: item.itemCode,
          itemName: item.itemName,
          itemType: itemType,
          quantity: item.quantity,
        });
        // Add to snapshot items if not already added (for aggregated items)
        if (!snapshotItems.some(s => s.itemCode === item.itemCode)) {
          snapshotItems.push({
            itemType: itemType,
            itemCode: item.itemCode,
            itemName: item.itemName,
            uom: item.unit,
          });
        }
      });

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

  return { result, snapshotItems };
}
