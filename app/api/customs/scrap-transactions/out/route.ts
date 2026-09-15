import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { acquireStockIdentityLocks, checkStockAvailability, type StockCheckResult } from '@/lib/utils/stock-checker';
import { logActivity } from '@/lib/log-activity';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import {
  normalizeScrapDate,
  utcToday,
  validateScrapMasterIdentity,
} from '@/lib/scrap-validation';
import { SCRAP_CUSTOMS_TYPES } from '@/lib/validators/constants/customs-document-types';

class ScrapInputValidationError extends Error {}

/**
 * Zod schema for outgoing scrap transaction validation
 */
const OutgoingScrapSchema = z.object({
  date: z.string().or(z.date()).transform((val, ctx) => {
    const parsed = normalizeScrapDate(val);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'Transaction date is invalid' });
      return z.NEVER;
    }
    return parsed;
  }),
  scrapCode: z.string().trim().min(1, 'Scrap Code is required'),
  scrapName: z.string().trim().min(1, 'Scrap Name is required'),
  uom: z.string().trim().min(1, 'UOM is required'),
  qty: z.number().finite('Quantity must be a finite number').positive('Quantity must be greater than 0'),
  currency: z.enum(['USD', 'IDR', 'CNY', 'EUR', 'JPY']),
  amount: z.number().finite('Amount must be a finite number').nonnegative('Amount must be non-negative'),
  recipientName: z.string().min(1, 'Recipient name is required').trim(),
  remarks: z.string().max(500, 'Remarks cannot exceed 500 characters').optional().nullable(),
  ppkekNumber: z.string().optional().nullable(),
  registrationDate: z.string().or(z.date()).optional().nullable().transform((val, ctx) => {
    if (!val) return null;
    const parsed = normalizeScrapDate(val);
    if (!parsed) {
      ctx.addIssue({ code: 'custom', message: 'Registration date is invalid' });
      return z.NEVER;
    }
    return parsed;
  }),
  customsDocumentType: z.enum(SCRAP_CUSTOMS_TYPES),
  transactionNumber: z.string().optional().nullable(),
  incomingPpkekNumbers: z.array(z.string()).optional().nullable(),
});

type OutgoingScrapInput = z.infer<typeof OutgoingScrapSchema>;

class InsufficientScrapStockError extends Error {
  constructor(public readonly stockCheck: StockCheckResult) {
    super('INSUFFICIENT_SCRAP_STOCK');
  }
}

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
function mapDocumentTypeToEnum(docType: string | null | undefined): 'BC25' | 'BC27' | 'BC27OUT' | 'BC41' | 'BC261' {
  if (!docType) return 'BC27'; // Default
  
  const cleanType = docType.trim().toUpperCase();
  
  // Direct matches
  if (cleanType === 'BC25') return 'BC25';
  if (cleanType === 'BC27') return 'BC27';
  if (cleanType === 'BC27OUT') return 'BC27OUT';
  if (cleanType === 'BC41') return 'BC41';
  if (cleanType === 'BC261') return 'BC261';
  
  // Number-only matches
  if (cleanType === '25') return 'BC25';
  if (cleanType === '27') return 'BC27';
  if (cleanType === '27OUT') return 'BC27OUT';
  if (cleanType === '41') return 'BC41';
  if (cleanType === '261') return 'BC261';
  
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
    const today = utcToday();

    if (date > today) {
      return NextResponse.json(
        { message: 'Transaction date cannot be in the future' },
        { status: 400 }
      );
    }
    if (registrationDate && registrationDate > today) {
      return NextResponse.json(
        { message: 'Registration date cannot be in the future' },
        { status: 400 }
      );
    }

    // Execute transaction
    const result = await prisma.$transaction(async (tx) => {
      const master = await tx.scrap_items.findFirst({
        where: { company_code: companyCode, scrap_code: scrapCode },
        select: { scrap_code: true, scrap_name: true, uom: true, is_active: true, deleted_at: true },
      });
      const identityErrors = validateScrapMasterIdentity(master ?? undefined, { scrapCode, scrapName, uom });
      if (identityErrors.length > 0) throw new ScrapInputValidationError(identityErrors.join('; '));

      await acquireStockIdentityLocks(tx, companyCode, [{ itemType: 'SCRAP', itemCode: scrapCode, uom }]);

      const stockCheck = await checkStockAvailability(
        companyCode,
        scrapCode,
        'SCRAP',
        qty,
        date,
        undefined,
        uom,
        tx
      );

      if (!stockCheck.available) {
        throw new InsufficientScrapStockError(stockCheck);
      }

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
          ppkek_number: ppkekNumber || 'N/A',
          customs_registration_date: registrationDate || date,
          customs_document_type: customsDocumentType,
          timestamp: new Date(),
        },
      });

      // 3. Create scrap_transaction_items record
      const scrapTransactionItem = await tx.scrap_transaction_items.create({
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
          customs_registration_date: registrationDate || date,
          outgoing_evidence_number: documentNumber,
          outgoing_date: date,
          invoice_number: documentNumber,
          invoice_date: date,
          recipient_name: recipientName,
          timestamp: new Date(),
        },
      });
      await tx.$executeRaw`
        UPDATE outgoing_goods
        SET scrap_transaction_id = ${scrapTransaction.id}
        WHERE company_code = ${companyCode}
          AND id = ${outgoingGood.id}
          AND outgoing_date = ${date}::DATE
      `;

      // 5. Create outgoing_good_items record
      const outgoingGoodItem = await tx.outgoing_good_items.create({
        data: {
          outgoing_good_id: outgoingGood.id,
          outgoing_good_company: companyCode,
          outgoing_good_date: date,
          item_type: 'SCRAP',
          item_code: scrapCode,
          item_name: scrapName,
          incoming_ppkek_numbers: incomingPpkekNumbers || [],
          hs_code: null,
          uom: uom,
          qty: new Prisma.Decimal(qty),
          currency: currency,
          amount: new Prisma.Decimal(amount),
        },
      });
      await tx.$executeRaw`
        UPDATE outgoing_good_items
        SET scrap_transaction_item_id = ${scrapTransactionItem.id}
        WHERE id = ${outgoingGoodItem.id}
          AND outgoing_good_company = ${companyCode}
          AND outgoing_good_date = ${date}::DATE
      `;

      // Keep the snapshot current before releasing the stock-identity lock.
      await tx.$executeRaw`
        SELECT upsert_item_stock_snapshot(
          ${companyCode}::INTEGER,
          ${'SCRAP'}::VARCHAR,
          ${scrapCode}::VARCHAR,
          ${scrapName}::VARCHAR,
          ${uom}::VARCHAR,
          ${date}::DATE
        )
      `;

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
          'SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::varchar, $5::date)',
          companyCode,
          'SCRAP',
          result.scrapCode,
          result.uom,
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

    if (error instanceof ScrapInputValidationError) {
      return NextResponse.json({ message: error.message }, { status: 400 });
    }

    if (error instanceof InsufficientScrapStockError) {
      const stockCheck = error.stockCheck;
      return NextResponse.json(
        {
          message: `Stock tidak cukup untuk ${stockCheck.itemCode}. Tersedia: ${stockCheck.currentStock}, Diminta: ${stockCheck.qtyRequested}`,
          data: {
            itemCode: stockCheck.itemCode,
            uom: stockCheck.uom,
            currentStock: stockCheck.currentStock,
            requestedQty: stockCheck.qtyRequested,
            shortfall: stockCheck.shortfall,
          },
        },
        { status: 400 }
      );
    }

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
 * Legacy header-only edit is intentionally disabled. Mutations must use the
 * line-addressable /api/customs/scrap-transactions/[id] endpoint.
 */
export async function PUT() {
  return NextResponse.json(
    { message: 'Header-only Scrap OUT edit is no longer supported. Refresh the Scrap Transaction page and edit a specific line.' },
    { status: 410 }
  );
}
