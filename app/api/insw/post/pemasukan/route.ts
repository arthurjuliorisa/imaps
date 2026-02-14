import { NextResponse } from 'next/server';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';

export async function POST(request: Request) {
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
    const body = await request.json();
    const { ids } = body;

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'ids is required and must be a non-empty array',
        },
        { status: 400 }
      );
    }

    const useTestMode = process.env.INSW_USE_TEST_MODE === 'true';
    const service = new INSWTransmissionService(useTestMode);

    const result = await service.transmitIncomingGoods(companyCode, ids);

    return NextResponse.json({
      success: result.status === 'success',
      message: result.message,
      total: result.total,
      success_count: result.success_count,
      failed_count: result.failed_count,
      results: result.results,
    });
  } catch (error: any) {
    console.error('Error posting Pemasukan to INSW:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
