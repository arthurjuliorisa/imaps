import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { checkBatchStockAvailability, type StockCheckItem } from '@/lib/utils/stock-checker';
import { z } from 'zod';

/**
 * Zod schema for stock check request validation
 */
const StockCheckRequestSchema = z.object({
  items: z.array(
    z.object({
      itemCode: z.string().min(1, 'Item code is required'),
      itemType: z.string().min(1, 'Item type is required'),
      qtyRequested: z.number().positive('Quantity must be positive'),
    })
  ).min(1, 'At least one item is required'),
  date: z.string().optional().or(z.date().optional()),
});

/**
 * POST /api/customs/stock/check
 * Check stock availability for multiple items
 *
 * @body items - Array of items to check
 *
 * @returns Stock availability results for all items
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
    const validatedData = StockCheckRequestSchema.parse(body);

    // Determine check date
    let checkDate: Date;
    if (validatedData.date) {
      // Parse provided date
      const parsedDate = new Date(validatedData.date);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { message: 'Invalid date format' },
          { status: 400 }
        );
      }
      checkDate = new Date(Date.UTC(
        parsedDate.getFullYear(),
        parsedDate.getMonth(),
        parsedDate.getDate(),
        0, 0, 0, 0
      ));
    } else {
      // Default to current date
      const today = new Date();
      checkDate = new Date(Date.UTC(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        0, 0, 0, 0
      ));
    }

    console.log('[Stock Check API] Checking stock', {
      itemCount: validatedData.items.length,
      checkDate: checkDate.toISOString(),
      dateProvided: !!validatedData.date,
    });
    
    const result = await checkBatchStockAvailability(
      companyCode,
      validatedData.items as StockCheckItem[],
      checkDate  // ✅ Use provided or default date
    );

    return NextResponse.json(result, { status: 200 });

  } catch (error: any) {
    console.error('[API Error] Failed to check stock:', error);

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

    return NextResponse.json(
      { message: 'Error checking stock availability', error: error.message },
      { status: 500 }
    );
  }
}
