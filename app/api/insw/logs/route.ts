import { NextResponse } from 'next/server';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';

/**
 * GET /api/insw/logs
 *
 * Get INSW transmission logs from insw_tracking_log table
 *
 * Query Parameters:
 * - transaction_type: incoming | outgoing (optional)
 * - insw_status: PENDING | SENT | SUCCESS | FAILED | SKIPPED (optional)
 * - limit: number (optional, default 100)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": [...]
 * }
 */
export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }

    const { companyCode } = companyValidation;
    const { searchParams } = new URL(request.url);

    const transactionType = searchParams.get('transaction_type');
    const inswStatus = searchParams.get('insw_status');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const useTestMode = process.env.INSW_USE_TEST_MODE === 'true';
    const service = new INSWTransmissionService(useTestMode);

    const logs = await service.getTransmissionLogs({
      company_code: companyCode,
      transaction_type: transactionType || undefined,
      insw_status: inswStatus || undefined,
      limit,
    });

    return NextResponse.json({
      success: true,
      data: logs,
    });
  } catch (error: any) {
    console.error('Error getting INSW logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
