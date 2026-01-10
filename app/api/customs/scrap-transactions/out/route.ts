import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { checkStockAvailability } from '@/lib/utils/stock-checker';
import { logActivity } from '@/lib/log-activity';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

/**
 * Zod schema for outgoing scrap transaction validation
 */
const OutgoingScrapSchema = z.object({
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
  scrapCode: z.string().min(1, 'Scrap code is required').trim(),
  scrapName: z.string().min(1, 'Scrap name is required').trim(),
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

type OutgoingScrapInput = z.infer<typeof OutgoingScrapSchema>;

/**
 * Generate unique WMS ID for outgoing scrap transaction
 */
function generateWmsId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SCRAP-OUT-${timestamp}-${random}`;
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
 * Map document type to enum value if not already prefixed with BC
 */
function mapDocumentTypeToEnum(docType: string | null | undefined): string {
  if (!docType) return 'BC27'; // Default
  const cleanType = docType.trim();
  if (cleanType.startsWith('BC')) {
    return cleanType;
  }
  return `BC${cleanType}`;
}

/**
 * POST /api/customs/scrap-transactions/out
 * Create outgoing scrap transaction
 *
 * @body date - Transaction date
 * @body scrapCode - Scrap item code
 * @body scrapName - Scrap item name
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
    let validatedData: OutgoingScrapInput;

    try {
      validatedData = OutgoingScrapSchema.parse(body);
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

    const { date, scrapCode, scrapName, uom, qty, currency, amount, recipientName, remarks, ppkekNumber, registrationDate, documentType, incomingPpkekNumbers } = validatedData;

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
      scrapCode,
      'SCRAP',
      qty,
      date
    );

    if (!stockCheck.available) {
      return NextResponse.json(
        {
          message: `Stock tidak cukup untuk ${scrapCode}. Tersedia: ${stockCheck.currentStock}, Diminta: ${qty}`,
          data: {
            itemCode: scrapCode,
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
      // 1. Generate WMS ID and document number
      const wmsId = generateWmsId();
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const documentNumber = `SCRAP-OUT-${timestamp}-${random}`;

      // 2. Create scrap_transactions header record
      const scrapTransaction = await tx.scrap_transactions.create({
        data: {
          company_code: companyCode,
          transaction_date: date,
          transaction_type: 'OUT',
          document_number: documentNumber,
          recipient_name: recipientName,
          disposal_method: 'Sold as scrap',
          remarks: remarks,
          ppkek_number: ppkekNumber || null,
          customs_registration_date: registrationDate || null,
          customs_document_type: documentType || null,
          timestamp: new Date(),
        },
      });

      // 3. Create scrap_transaction_items record
      await tx.scrap_transaction_items.create({
        data: {
          scrap_transaction_id: scrapTransaction.id,
          scrap_transaction_company: companyCode,
          scrap_transaction_date: date,
          item_type: 'SCRAP',
          item_code: scrapCode,
          item_name: scrapName,
          uom: uom,
          qty: new Prisma.Decimal(qty),
          currency: currency,
          amount: new Prisma.Decimal(amount),
          scrap_reason: remarks,
        },
      });

      // 4. Create outgoing_goods record (for integration with WMS)
      const outgoingGood = await tx.outgoing_goods.create({
        data: {
          wms_id: wmsId,
          company_code: companyCode,
          owner: companyCode,
          customs_document_type: mapDocumentTypeToEnum(documentType) as any,
          ppkek_number: ppkekNumber || 'N/A',
          customs_registration_date: registrationDate || new Date(),
          outgoing_evidence_number: documentNumber,
          outgoing_date: date,
          invoice_number: documentNumber,
          invoice_date: date,
          recipient_name: recipientName,
          timestamp: new Date(),
        },
      });

      // 5. Create outgoing_good_items record
      await tx.outgoing_good_items.create({
        data: {
          outgoing_good_id: outgoingGood.id,
          outgoing_good_company: companyCode,
          outgoing_good_date: date,
          item_type: 'SCRAP',
          item_code: scrapCode,
          item_name: scrapName,
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
        documentNumber,
        transactionId: scrapTransaction.id,
        outgoingGoodId: outgoingGood.id,
        date,
        scrapCode,
        scrapName,
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
          'SCRAP',
          result.scrapCode,
          result.scrapName,
          result.uom,
          result.date
        );
        console.log(
          '[API Info] Direct snapshot calculation executed',
          {
            companyCode,
            itemType: 'SCRAP',
            itemCode: result.scrapCode,
            date: result.date.toISOString().split('T')[0],
          }
        );
      } catch (snapshotError) {
        console.error(
          '[API Error] Snapshot calculation failed',
          {
            companyCode,
            itemType: 'SCRAP',
            itemCode: result.scrapCode,
            date: result.date.toISOString().split('T')[0],
            errorMessage: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
          }
        );
      }
    })().catch(err => console.error('[API Error] Background snapshot task failed:', err));

    // Log activity
    await logActivity({
      action: 'ADD_OUT_SCRAP_TRANSACTION',
      description: `Created outgoing scrap transaction: ${result.documentNumber} - ${result.scrapName} (${result.qty} ${uom}) to ${result.recipientName}`,
      status: 'success',
      metadata: {
        wmsId: result.wmsId,
        documentNumber: result.documentNumber,
        transactionId: result.transactionId.toString(),
        outgoingGoodId: result.outgoingGoodId.toString(),
        itemCode: result.scrapCode,
        itemName: result.scrapName,
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
        message: 'Outgoing scrap transaction created successfully',
        data: result,
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('[API Error] Failed to create outgoing scrap transaction:', error);

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
      { message: 'Error creating outgoing scrap transaction', error: error.message },
      { status: 500 }
    );
  }
}
