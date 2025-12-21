import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
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
  qty: z.number().positive('Quantity must be positive'),
  currency: z.enum(['USD', 'IDR', 'CNY', 'EUR', 'JPY']),
  amount: z.number().nonnegative('Amount must be non-negative'),
  recipientName: z.string().min(1, 'Recipient name is required').trim(),
  remarks: z.string().optional().nullable(),
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
 * POST /api/customs/scrap/outgoing
 * Create outgoing scrap transaction
 *
 * @body date - Transaction date
 * @body scrapCode - Scrap item code
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

    const { date, scrapCode, qty, currency, amount, recipientName, remarks } = validatedData;

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
      // 1. Validate scrap code exists in scrap_items or beginning_balances
      const scrapItem = await tx.scrap_items.findFirst({
        where: {
          company_code: companyCode,
          scrap_code: scrapCode,
          is_active: true,
        },
        select: {
          scrap_code: true,
          scrap_name: true,
          uom: true,
        },
      });

      // If not found in scrap_items, check beginning_balances
      let itemName = scrapItem?.scrap_name || '';
      let uom = scrapItem?.uom || '';

      if (!scrapItem) {
        const beginningBalance = await tx.beginning_balances.findFirst({
          where: {
            company_code: companyCode,
            item_code: scrapCode,
            item_type: 'SCRAP',
          },
          select: {
            item_name: true,
            uom: true,
          },
        });

        if (!beginningBalance) {
          throw new Error(`Scrap code '${scrapCode}' not found in master data or beginning balances`);
        }

        itemName = beginningBalance.item_name;
        uom = beginningBalance.uom;
      }

      // 2. Generate WMS ID and invoice number
      const wmsId = generateWmsId();
      const invoiceNumber = generateInvoiceNumber();

      // 3. Get company default ppkek_number (for now, use empty string)
      const ppkekNumber = '';

      // 4. Create outgoing_goods record
      const outgoingGood = await tx.outgoing_goods.create({
        data: {
          wms_id: wmsId,
          company_code: companyCode,
          owner: companyCode,
          customs_document_type: 'BC27',
          ppkek_number: ppkekNumber,
          customs_registration_date: date,
          outgoing_evidence_number: wmsId,
          outgoing_date: date,
          invoice_number: invoiceNumber,
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
          item_name: itemName,
          production_output_wms_ids: [],
          hs_code: null,
          uom: uom,
          qty: new Prisma.Decimal(qty),
          currency: currency,
          amount: new Prisma.Decimal(amount),
        },
      });

      // 6. Queue snapshot recalculation
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
          reason: `Outgoing scrap transaction: ${wmsId}`,
        },
        update: {
          status: 'PENDING',
          priority: priority,
          reason: `Outgoing scrap transaction: ${wmsId}`,
          queued_at: new Date(),
        },
      });

      return {
        wmsId,
        outgoingGoodId: outgoingGood.id,
        date,
        scrapCode,
        itemName,
        qty,
        currency,
        amount,
        recipientName,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 30000,
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
