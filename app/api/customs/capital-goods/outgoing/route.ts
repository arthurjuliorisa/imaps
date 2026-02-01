import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

/**
 * Validation schema for single outgoing transaction item
 */
const OutgoingItemSchema = z.object({
  itemCode: z.string().min(1, 'Item code is required'),
  qty: z.number().positive('Quantity must be a positive number'),
  currency: z.enum(['USD', 'IDR', 'CNY', 'EUR', 'JPY'], {
    message: 'Invalid currency. Must be one of: USD, IDR, CNY, EUR, JPY',
  }),
  valueAmount: z.number().nonnegative('Value amount must be non-negative'),
  remarks: z.string().optional(),
});

/**
 * Validation schema for outgoing transaction request body
 */
const OutgoingTransactionSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format'),
  recipientName: z.string().min(1, 'Recipient name is required').max(200, 'Recipient name must not exceed 200 characters'),
  documentNumber: z.string().max(50).optional(),
  items: z.array(OutgoingItemSchema).min(1, 'At least one item is required'),
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
 * Generate auto document number
 */
function generateDocumentNumber(companyCode: number, date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const timestamp = Date.now().toString().slice(-6);
  return `CG-OUT-${companyCode}-${year}${month}${day}-${timestamp}`;
}



/**
 * POST /api/customs/capital-goods/outgoing
 * Creates a single outgoing goods transaction for capital goods
 *
 * Capital goods will appear in LPJ Mutasi report as outgoing transactions.
 *
 * Request body:
 * {
 *   date: string (YYYY-MM-DD),
 *   recipientName: string,
 *   documentNumber?: string,
 *   items: [{
 *     itemCode: string,
 *     qty: number,
 *     currency: string,
 *     valueAmount: number,
 *     remarks?: string
 *   }]
 * }
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

    // Validate request body
    const validationResult = OutgoingTransactionSchema.safeParse(body);
    if (!validationResult.success) {
      return NextResponse.json(
        {
          message: 'Validation failed',
          errors: validationResult.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { date, recipientName, documentNumber, items } = validationResult.data;

    // Validate and normalize date
    let parsedDate: Date;
    try {
      parsedDate = parseAndNormalizeDate(date);
    } catch (error) {
      return NextResponse.json(
        { message: 'Invalid date format. Expected YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // Validate date is not in the future
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (parsedDate > today) {
      return NextResponse.json(
        { message: 'Date cannot be in the future' },
        { status: 400 }
      );
    }

    // Generate or use provided document number
    const evidenceNumber = documentNumber || generateDocumentNumber(companyCode, parsedDate);

    // Validate all items exist in beginning_balances and are capital goods
    const itemCodes = items.map(item => item.itemCode);
    const foundItems = await prisma.beginning_balances.findMany({
      where: {
        company_code: companyCode,
        item_code: { in: itemCodes },
        item_type: { in: ['HIBE-M', 'HIBE-E', 'HIBE-T'] },
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

    // Validate all items exist
    const missingItems = itemCodes.filter(code => !itemMap.has(code));
    if (missingItems.length > 0) {
      return NextResponse.json(
        {
          message: 'Invalid items found',
          missingItems,
          details: 'The following item codes do not exist or are not capital goods (HIBE-M, HIBE-E, HIBE-T)',
        },
        { status: 400 }
      );
    }

    // Create transaction with items
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Collect items for direct snapshot calculation
        const snapshotItems: Array<{ itemType: string; itemCode: string; itemName: string; uom: string; date: Date }> = [];

        // Create outgoing_goods record
        const outgoingGoods = await tx.outgoing_goods.create({
          data: {
            wms_id: `CG-${Date.now()}`,
            company_code: companyCode,
            owner: companyCode,
            customs_document_type: 'BC25',
            ppkek_number: evidenceNumber,
            customs_registration_date: parsedDate,
            outgoing_evidence_number: evidenceNumber,
            outgoing_date: parsedDate,
            invoice_number: evidenceNumber,
            invoice_date: parsedDate,
            recipient_name: recipientName,
            timestamp: new Date(),
          },
        });

        // Create outgoing_good_items records
        const itemRecords = items.map(item => {
          const masterItem = itemMap.get(item.itemCode)!;
          const snapItem = {
            itemType: masterItem.item_type,
            itemCode: item.itemCode,
            itemName: masterItem.item_name,
            uom: masterItem.uom,
            date: parsedDate,
          };
          snapshotItems.push(snapItem);
          return {
            outgoing_good_id: outgoingGoods.id,
            outgoing_good_company: companyCode,
            outgoing_good_date: parsedDate,
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

        return {
          transactionId: outgoingGoods.id,
          wmsId: outgoingGoods.wms_id,
          documentNumber: evidenceNumber,
          itemCount: items.length,
          snapshotItems,
        };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      });

      // Execute direct snapshot calculation asynchronously (fire-and-forget)
      if (result.snapshotItems.length > 0) {
        (async () => {
          for (const item of result.snapshotItems) {
            try {
              await prisma.$executeRawUnsafe(
                'SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)',
                companyCode,
                item.itemType,
                item.itemCode,
                item.itemName,
                item.uom,
                item.date
              );
              console.log('[API Info] Direct snapshot calculation executed', {
                companyCode,
                itemType: item.itemType,
                itemCode: item.itemCode,
                date: item.date.toISOString().split('T')[0],
              });
            } catch (snapshotError) {
              console.error('[API Error] Snapshot calculation failed', {
                companyCode,
                itemType: item.itemType,
                itemCode: item.itemCode,
                date: item.date.toISOString().split('T')[0],
                errorMessage: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
              });
            }
          }
        })().catch(err => console.error('[API Error] Background snapshot task failed:', err));
      }

      return NextResponse.json(
        {
          success: true,
          message: 'Outgoing transaction created successfully',
          data: {
            transactionId: result.transactionId,
            wmsId: result.wmsId,
            documentNumber: result.documentNumber,
            itemCount: result.itemCount,
          },
        },
        { status: 201 }
      );
    } catch (error: any) {
      console.error('[API Error] Transaction failed:', error);

      if (error.code === 'P2002') {
        return NextResponse.json(
          { message: 'Duplicate transaction detected' },
          { status: 400 }
        );
      }

      if (error.code === 'P2003') {
        return NextResponse.json(
          { message: 'Foreign key constraint failed - invalid reference' },
          { status: 400 }
        );
      }

      throw error;
    }
  } catch (error: any) {
    console.error('[API Error] Failed to create outgoing transaction:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: 'Invalid JSON in request body' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error creating outgoing transaction', error: error.message },
      { status: 500 }
    );
  }
}
