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
  customsDocumentType: z.enum(['BC25', 'BC27', 'BC41']),
  transactionNumber: z.string().optional().nullable(),
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
function mapDocumentTypeToEnum(docType: string | null | undefined): 'BC25' | 'BC27' | 'BC41' {
  if (!docType) return 'BC27'; // Default
  
  const cleanType = docType.trim().toUpperCase();
  
  // Direct matches
  if (cleanType === 'BC25') return 'BC25';
  if (cleanType === 'BC27') return 'BC27';
  if (cleanType === 'BC41') return 'BC41';
  
  // Number-only matches
  if (cleanType === '25') return 'BC25';
  if (cleanType === '27') return 'BC27';
  if (cleanType === '41') return 'BC41';
  
  // Default fallback
  return 'BC27';
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

    const { date, scrapCode, scrapName, uom, qty, currency, amount, recipientName, remarks, ppkekNumber, registrationDate, customsDocumentType, transactionNumber, incomingPpkekNumbers } = validatedData;

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
      const wmsId = transactionNumber || generateWmsId();
      const documentNumber = transactionNumber || (() => {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
        return `SCRAP-OUT-${timestamp}-${random}`;
      })();

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
          customs_document_type: customsDocumentType,
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
          customs_document_type: mapDocumentTypeToEnum(customsDocumentType),
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

        // FIX: Cascade recalculate snapshots for all future dates
        // This ensures forward-looking balance updates when a past transaction is inserted
        await prisma.$executeRawUnsafe(
          'SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)',
          companyCode,
          'SCRAP',
          result.scrapCode,
          result.date
        );
        console.log(
          '[API Info] Cascaded snapshot recalculation executed',
          {
            companyCode,
            itemType: 'SCRAP',
            itemCode: result.scrapCode,
            fromDate: result.date.toISOString().split('T')[0],
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

/**
 * PUT /api/customs/scrap-transactions/out?id=SCRAP_TRANS_ID
 * Update outgoing scrap transaction
 */
export async function PUT(request: Request) {
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

    // Get transaction ID from URL query
    const url = new URL(request.url);
    const transactionId = url.searchParams.get('id');
    if (!transactionId) {
      return NextResponse.json(
        { message: 'Transaction ID is required' },
        { status: 400 }
      );
    }

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

    const { date, scrapCode, scrapName, uom, qty, currency, amount, recipientName, remarks, ppkekNumber, registrationDate, customsDocumentType, incomingPpkekNumbers } = validatedData;

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

    // Execute transaction
    const result = await prisma.$transaction(async (tx) => {
      // 1. Find existing scrap_transaction
      const existingTransaction = await tx.scrap_transactions.findUnique({
        where: { id: parseInt(transactionId) },
        include: {
          items: true,
        },
      });

      if (!existingTransaction) {
        throw new Error(`Scrap transaction with ID ${transactionId} not found`);
      }

      // 2. Find associated outgoing_goods record
      const existingItem = existingTransaction.items[0];
      const outgoingGood = await tx.outgoing_goods.findFirst({
        where: {
          company_code: companyCode,
          outgoing_evidence_number: existingTransaction.document_number,
        },
      });

      if (!outgoingGood) {
        throw new Error('Associated outgoing goods record not found');
      }

      // 3. Update scrap_transactions
      // Map document type to ensure valid enum value
      const mappedDocumentType = mapDocumentTypeToEnum(customsDocumentType);
      
      await tx.scrap_transactions.update({
        where: { id: existingTransaction.id },
        data: {
          transaction_date: date,
          recipient_name: recipientName,
          remarks: remarks,
          ppkek_number: ppkekNumber || null,
          customs_registration_date: registrationDate || null,
          customs_document_type: mappedDocumentType,
        },
      });

      // 4. Update scrap_transaction_items
      if (existingItem) {
        await tx.scrap_transaction_items.update({
          where: { id: existingItem.id },
          data: {
            scrap_transaction_date: date,
            item_name: scrapName,
            uom: uom,
            qty: new Prisma.Decimal(qty),
            currency: currency,
            amount: new Prisma.Decimal(amount),
            scrap_reason: remarks,
          },
        });
      }

      // 5. Update outgoing_goods (IMPORTANT: Must include customs_document_type)
      await tx.outgoing_goods.update({
        where: { id: outgoingGood.id },
        data: {
          customs_document_type: mappedDocumentType,
          ppkek_number: ppkekNumber || outgoingGood.ppkek_number,
          customs_registration_date: registrationDate || outgoingGood.customs_registration_date,
          recipient_name: recipientName,
          outgoing_date: date,
          invoice_date: date,
        },
      });

      // 6. Update outgoing_good_items
      const outgoingItems = await tx.outgoing_good_items.findMany({
        where: {
          outgoing_good_id: outgoingGood.id,
        },
      });

      if (outgoingItems.length > 0) {
        await tx.outgoing_good_items.update({
          where: { id: outgoingItems[0].id },
          data: {
            outgoing_good_date: date,
            item_name: scrapName,
            uom: uom,
            qty: new Prisma.Decimal(qty),
            currency: currency,
            amount: new Prisma.Decimal(amount),
            incoming_ppkek_numbers: incomingPpkekNumbers || outgoingItems[0].incoming_ppkek_numbers,
          },
        });
      }

      return {
        transactionId: existingTransaction.id,
        outgoingGoodId: outgoingGood.id,
        documentNumber: existingTransaction.document_number,
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

    // Execute snapshot recalculation (outside transaction, non-blocking)
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
          '[API Info] Snapshot recalculation executed for edit',
          {
            companyCode,
            itemType: 'SCRAP',
            itemCode: result.scrapCode,
            date: result.date.toISOString().split('T')[0],
          }
        );

        // Cascade recalculate snapshots for all future dates
        await prisma.$executeRawUnsafe(
          'SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)',
          companyCode,
          'SCRAP',
          result.scrapCode,
          result.date
        );
        console.log(
          '[API Info] Cascaded snapshot recalculation executed',
          {
            companyCode,
            itemType: 'SCRAP',
            itemCode: result.scrapCode,
            fromDate: result.date.toISOString().split('T')[0],
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
      action: 'EDIT_OUT_SCRAP_TRANSACTION',
      description: `Updated outgoing scrap transaction: ${result.documentNumber} - ${result.scrapName} (${result.qty} ${result.uom}) to ${result.recipientName}`,
      status: 'success',
      metadata: {
        transactionId: result.transactionId.toString(),
        outgoingGoodId: result.outgoingGoodId.toString(),
        documentNumber: result.documentNumber,
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
        message: 'Outgoing scrap transaction updated successfully',
        data: result,
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('[API Error] Failed to update outgoing scrap transaction:', error);

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
      { message: 'Error updating outgoing scrap transaction', error: error.message },
      { status: 500 }
    );
  }
}
