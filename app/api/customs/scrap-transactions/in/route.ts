import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { logActivity } from '@/lib/log-activity';
import { z } from 'zod';
import { Prisma } from '@prisma/client';

/**
 * Zod schema for incoming scrap transaction validation
 */
const IncomingScrapSchema = z.object({
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
  remarks: z.string().optional().nullable(),
});

type IncomingScrapInput = z.infer<typeof IncomingScrapSchema>;

/**
 * Generate unique WMS ID for incoming scrap transaction
 */
function generateWmsId(): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `SCRAP-IN-${timestamp}-${random}`;
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
 * Calculate priority for snapshot recalculation queue
 * Backdated transactions (date < today) should have priority 0
 * Same-day transactions (date = today) should have priority -1
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
  } else if (transactionDate.getTime() === today.getTime()) {
    return -1; // Same-day transaction
  }
  return -1; // Default to same-day priority
}

/**
 * POST /api/customs/scrap-transactions/in
 * Create incoming scrap transaction
 *
 * @body date - Transaction date
 * @body scrapCode - Scrap item code
 * @body scrapName - Scrap item name
 * @body uom - Unit of measure
 * @body qty - Quantity
 * @body currency - Currency code
 * @body amount - Transaction amount
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
    let validatedData: IncomingScrapInput;

    try {
      validatedData = IncomingScrapSchema.parse(body);
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

    const { date, scrapCode, scrapName, uom, qty, currency, amount, remarks } = validatedData;

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
      // 1. Generate document number (using wms_id format for consistency)
      const timestamp = Date.now();
      const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      const documentNumber = `SCRAP-IN-${timestamp}-${random}`;

      // 2. Create scrap_transactions header record
      const scrapTransaction = await tx.scrap_transactions.create({
        data: {
          company_code: companyCode,
          transaction_date: date,
          transaction_type: 'IN',
          document_number: documentNumber,
          source: remarks || `Scrap incoming - ${currency} ${amount}`,
          remarks: remarks,
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

      // 4. Queue snapshot recalculation
      const priority = calculatePriority(date);

      await tx.snapshot_recalc_queue.upsert({
        where: {
          company_code_recalc_date_item_type_item_code: {
            company_code: companyCode,
            recalc_date: date,
            item_type: 'SCRAP',
            item_code: scrapCode,
          },
        },
        create: {
          company_code: companyCode,
          item_type: 'SCRAP',
          item_code: scrapCode,
          recalc_date: date,
          status: 'PENDING',
          priority: priority,
          reason: `Incoming scrap transaction: ${documentNumber}`,
        },
        update: {
          status: 'PENDING',
          priority: priority,
          reason: `Incoming scrap transaction: ${documentNumber}`,
          queued_at: new Date(),
        },
      });

      return {
        documentNumber,
        transactionId: scrapTransaction.id,
        date,
        scrapCode,
        scrapName,
        qty,
        currency,
        amount,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
    });

    // Log activity
    await logActivity({
      action: 'ADD_IN_SCRAP_TRANSACTION',
      description: `Created incoming scrap transaction: ${result.documentNumber} - ${result.scrapName} (${result.qty} ${uom})`,
      status: 'success',
      metadata: {
        documentNumber: result.documentNumber,
        transactionId: result.transactionId.toString(),
        itemCode: result.scrapCode,
        itemName: result.scrapName,
        qty: result.qty,
        currency: result.currency,
        amount: result.amount,
        companyCode,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Incoming scrap transaction created successfully',
        data: result,
      },
      { status: 201 }
    );

  } catch (error: any) {
    console.error('[API Error] Failed to create incoming scrap transaction:', error);

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
      { message: 'Error creating incoming scrap transaction', error: error.message },
      { status: 500 }
    );
  }
}
