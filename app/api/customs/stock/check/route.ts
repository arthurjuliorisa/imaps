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

    // Check stock for all items
    const result = await checkBatchStockAvailability(
      companyCode,
      validatedData.items as StockCheckItem[]
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
