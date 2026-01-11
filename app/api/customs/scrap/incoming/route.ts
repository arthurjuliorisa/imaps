import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
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
 * POST /api/customs/scrap/incoming
 * Create incoming scrap transaction
 *
 * @body date - Transaction date
 * @body scrapCode - Scrap item code
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

    const { date, scrapCode, qty, currency, amount, remarks } = validatedData;

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

      // 4. Create incoming_goods record
      const incomingGood = await tx.incoming_goods.create({
        data: {
          wms_id: wmsId,
          company_code: companyCode,
          owner: companyCode,
          customs_document_type: 'BC27',
          ppkek_number: ppkekNumber,
          customs_registration_date: date,
          incoming_evidence_number: wmsId,
          incoming_date: date,
          invoice_number: invoiceNumber,
          invoice_date: date,
          shipper_name: 'Internal Scrap Collection',
          timestamp: new Date(),
        },
      });

      // 5. Create incoming_good_items record
      await tx.incoming_good_items.create({
        data: {
          incoming_good_id: incomingGood.id,
          incoming_good_company: companyCode,
          incoming_good_date: date,
          item_type: 'SCRAP',
          item_code: scrapCode,
          item_name: itemName,
          hs_code: null,
          uom: uom,
          qty: new Prisma.Decimal(qty),
          currency: currency,
          amount: new Prisma.Decimal(amount),
        },
      });

      return {
        wmsId,
        incomingGoodId: incomingGood.id,
        date,
        scrapCode,
        itemName,
        uom,
        qty,
        currency,
        amount,
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
          result.itemName,
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
