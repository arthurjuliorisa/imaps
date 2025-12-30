import { NextResponse } from 'next/server';
import { checkStockAvailability } from '@/lib/utils/stock-checker';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { z } from 'zod';

/**
 * Zod schema for stock check request
 */
const StockCheckSchema = z.object({
  itemCode: z.string().min(1, 'Item code is required'),
  itemType: z.string().min(1, 'Item type is required'),
  qtyRequested: z.number().positive('Quantity must be positive'),
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
});

type StockCheckInput = z.infer<typeof StockCheckSchema>;

/**
 * POST /api/customs/stock/check-availability
 * Check stock availability for a specific item at a specific date
 * Used for pre-check validation in forms (real-time feedback)
 *
 * @body itemCode - Item code
 * @body itemType - Item type (SCRAP, HIBE_M, HIBE_E, HIBE_T)
 * @body qtyRequested - Quantity requested
 * @body date - Transaction date
 *
 * @returns Stock check result with available flag, current stock, and shortfall
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
    let validatedData: StockCheckInput;

    try {
      validatedData = StockCheckSchema.parse(body);
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

    const { itemCode, itemType, qtyRequested, date } = validatedData;

    // Check stock availability
    const result = await checkStockAvailability(
      companyCode,
      itemCode,
      itemType,
      qtyRequested,
      date
    );

    return NextResponse.json(
      {
        available: result.available,
        currentStock: result.currentStock,
        requestedQty: result.qtyRequested,
        shortfall: result.shortfall,
        message: result.available 
          ? `Stock available: ${result.currentStock} units`
          : `Stock tidak cukup. Tersedia: ${result.currentStock}, Diminta: ${result.qtyRequested}, Kurang: ${result.shortfall}`,
      },
      { status: 200 }
    );

  } catch (error: any) {
    console.error('[API Error] Failed to check stock availability:', error);

    return NextResponse.json(
      { message: 'Error checking stock availability', error: error.message },
      { status: 500 }
    );
  }
}
