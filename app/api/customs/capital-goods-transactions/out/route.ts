import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { checkStockAvailability } from '@/lib/utils/stock-checker';
import { logActivity } from '@/lib/log-activity';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

/**
 * Zod schema for outgoing capital goods transaction validation
 */
const OutgoingCapitalGoodsSchema = z.object({
  date: z.string().or(z.date()).transform((val) => {
    const parsed = new Date(val);
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
  }),
  itemType: z.enum(['HIBE-M', 'HIBE-E', 'HIBE-T'], {
    message: 'Item type must be HIBE-M, HIBE-E, or HIBE-T'
  }),
  itemCode: z.string().min(1, 'Item code is required').trim(),
  itemName: z.string().min(1, 'Item name is required').trim(),
  uom: z.string().min(1, 'UOM is required').trim(),
  qty: z.number().positive('Quantity must be positive'),
  currency: z.enum(['USD', 'IDR', 'CNY', 'EUR', 'JPY']),
  amount: z.number().nonnegative('Amount must be non-negative'),
  recipientName: z.string().min(1, 'Recipient name is required').trim(),
  remarks: z.string().optional().nullable(),
  ppkekNumber: z.string().optional().nullable(),
  registrationDate: z.string().or(z.date()).optional().nullable().transform((val) => {
    if (!val) return null;
    const parsed = new Date(val);
    if (isNaN(parsed.getTime())) {
      throw new Error('Invalid registration date format');
    }
    // Normalize to UTC midnight
    return new Date(Date.UTC(
      parsed.getFullYear(),
      parsed.getMonth(),
      parsed.getDate(),
      0, 0, 0, 0
    ));
  }),
  documentType: z.enum(['BC25', 'BC27', 'BC41']).optional().nullable(),
  incomingPpkekNumbers: z.array(z.string()).optional().nullable(),
});

type OutgoingCapitalGoodsInput = z.infer<typeof OutgoingCapitalGoodsSchema>;

/**
 * Generate unique WMS ID for outgoing capital goods transaction
 */
function generateWmsId(itemType: string): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `${itemType}-OUT-${timestamp}-${random}`;
}

/**
 * Generate invoice number
 */
function generateInvoiceNumber(): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `INV-${dateStr}-${random}`;
}

/**
 * POST /api/customs/capital-goods-transactions/out
 * Create outgoing capital goods transaction
 *
 * @body date - Transaction date
 * @body itemType - Capital goods item type (HIBE-M, HIBE-E, or HIBE-T)
 * @body itemCode - Item code
 * @body itemName - Item name
 * @body uom - Unit of measure
 * @body qty - Quantity
 * @body currency - Currency code
 * @body amount - Transaction amount
 * @body recipientName - Recipient name
 * @body remarks - Optional remarks
 *
 * @returns Created transaction with wms_id
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

    // Parse and validate request body
    const body = await request.json();
    let validatedData: OutgoingCapitalGoodsInput;

    try {
      validatedData = OutgoingCapitalGoodsSchema.parse(body);
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

    const { date, itemType, itemCode, itemName, uom, qty, currency, amount, recipientName, remarks, ppkekNumber, registrationDate, documentType, incomingPpkekNumbers } = validatedData;

    // Validate date is not in the future
    const now = new Date();
    const today = new Date(Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0
    ));

    if (date > today) {
      return NextResponse.json(
        { message: 'Transaction date cannot be in the future' },
        { status: 400 }
      );
    }

    // Check stock availability
    const stockCheck = await checkStockAvailability(
      companyCode,
      itemCode,
      itemType,
      qty,
      date
    );

    if (!stockCheck.available) {
      return NextResponse.json(
        {
          message: `Stock tidak cukup untuk ${itemCode}. Tersedia: ${stockCheck.currentStock}, Diminta: ${qty}`,
          data: {
            itemCode: itemCode,
            itemType: itemType,
            currentStock: stockCheck.currentStock,
            requestedQty: qty,
            shortfall: stockCheck.shortfall,
          },
        },
        { status: 400 }
      );
    }

    // Execute transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Generate WMS ID and invoice number
      const wmsId = generateWmsId(itemType);
      const invoiceNumber = generateInvoiceNumber();

      // 2. Create outgoing_goods record
      const outgoingGood = await tx.outgoing_goods.create({
        data: {
          wms_id: wmsId,
          company_code: companyCode,
          owner: companyCode,
          customs_document_type: documentType || 'BC27',
          ppkek_number: ppkekNumber || '',
          customs_registration_date: registrationDate || date,
          outgoing_evidence_number: wmsId,
          outgoing_date: date,
          invoice_number: invoiceNumber,
          invoice_date: date,
          recipient_name: recipientName,
          timestamp: new Date(),
        },
      });

      // 3. Create outgoing_good_items record
      await tx.outgoing_good_items.create({
        data: {
          outgoing_good_id: outgoingGood.id,
          outgoing_good_company: companyCode,
          outgoing_good_date: date,
          item_type: itemType,
          item_code: itemCode,
          item_name: itemName,
          production_output_wms_ids: [],
          hs_code: null,
          uom: uom,
          qty: new Prisma.Decimal(qty),
          currency: currency,
          amount: new Prisma.Decimal(amount),
          incoming_ppkek_numbers: incomingPpkekNumbers || [],
        },
      });

      // Return transaction details
      return {
        wmsId,
        outgoingGoodId: outgoingGood.id,
        date,
        itemType,
        itemCode,
        itemName,
        uom,
        qty,
        currency,
        amount,
        recipientName,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    });

    // Execute direct snapshot recalculation (outside transaction, non-blocking)
    (async () => {
      try {
        await prisma.$executeRawUnsafe(
          'SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)',
          companyCode,
          result.itemType,
          result.itemCode,
          result.itemName,
          result.uom,
          result.date
        );
        console.log(
          '[API Info] Direct snapshot calculation executed',
          {
            companyCode,
            itemType: result.itemType,
            itemCode: result.itemCode,
            date: result.date.toISOString().split('T')[0],
          }
        );
      } catch (snapshotError) {
        console.error(
          '[API Error] Snapshot calculation failed',
          {
            companyCode,
            itemType: result.itemType,
            itemCode: result.itemCode,
            date: result.date.toISOString().split('T')[0],
            errorMessage: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
          }
        );
      }
    })().catch(err => console.error('[API Error] Background snapshot task failed:', err));

    // Log activity
    await logActivity({
      action: 'ADD_OUT_CAPITAL_GOODS_TRANSACTION',
      description: `Created outgoing capital goods transaction: ${result.wmsId} - ${result.itemName} (${result.qty} ${uom}) to ${result.recipientName}`,
      status: 'success',
      metadata: {
        wmsId: result.wmsId,
        outgoingGoodId: result.outgoingGoodId.toString(),
        itemType: result.itemType,
        itemCode: result.itemCode,
        itemName: result.itemName,
        qty: result.qty,
        currency: result.currency,
        amount: result.amount,
        recipientName: result.recipientName,
        companyCode,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Outgoing capital goods transaction created successfully',
        data: result,
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('[API Error] Failed to create outgoing capital goods transaction:', error);

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

    // Handle custom validation errors
    if (error.message && error.message.includes('not found')) {
      return NextResponse.json(
        { message: error.message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error creating outgoing capital goods transaction', error: error.message },
      { status: 500 }
    );
  }
}
