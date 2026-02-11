import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateBeginningBalanceItemsBatch } from '@/lib/beginning-data-validation';

/**
 * POST /api/customs/beginning-data/validate
 * Validate beginning balance records WITHOUT importing them
 * Used for real-time validation when Excel file is loaded
 *
 * Expected Request Body:
 * {
 *   records: [
 *     {
 *       itemType: "ROH",
 *       itemCode: "RM-001",
 *       itemName: "Raw Material A",
 *       uom: "KG",
 *     },
 *     ...
 *   ]
 * }
 *
 * Returns:
 * {
 *   success: true,
 *   validationResults: {
 *     "item_code|uom|item_name|item_type": {
 *       valid: boolean,
 *       errors: [{ itemCode, reason }]
 *     }
 *   }
 * }
 */
export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const body = await request.json();
    const { records } = body;

    if (!records || !Array.isArray(records)) {
      return NextResponse.json(
        { message: 'Invalid request body. Expected { records: Array }' },
        { status: 400 }
      );
    }

    if (records.length === 0) {
      return NextResponse.json({
        success: true,
        validationResults: {},
      });
    }

    // Get company code from session
    const companyCode = session.user?.companyCode;
    if (!companyCode) {
      return NextResponse.json(
        { message: 'Company code not found in session' },
        { status: 400 }
      );
    }

    const companyCodeInt = parseInt(companyCode, 10);
    if (isNaN(companyCodeInt)) {
      return NextResponse.json(
        { message: 'Invalid company code format' },
        { status: 400 }
      );
    }

    // Validate records using the batch validation function
    const validationResults = await validateBeginningBalanceItemsBatch(
      companyCodeInt,
      records
    );

    return NextResponse.json({
      success: true,
      validationResults,
    });
  } catch (error: any) {
    console.error('[API Error] Failed to validate beginning balance records:', error);

    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { message: 'Invalid request format' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error validating beginning balance records', error: error.message },
      { status: 500 }
    );
  }
}
