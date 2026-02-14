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
    const { ids, wmsIds } = body;

    const useTestMode = process.env.INSW_USE_TEST_MODE === 'true';
    const service = new INSWTransmissionService(useTestMode);

    let result;
    let method = '';

    if (wmsIds && Array.isArray(wmsIds) && wmsIds.length > 0) {
      result = await service.transmitOutgoingGoodsByWmsIds(companyCode, wmsIds);
      method = 'wmsIds';
    } else if (ids && Array.isArray(ids) && ids.length > 0) {
      result = await service.transmitOutgoingGoodsByIds(companyCode, ids);
      method = 'ids';
    } else {
      return NextResponse.json(
        {
          success: false,
          error:
            'Either ids or wmsIds is required and must be a non-empty array',
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: result.status === 'success',
      message: result.message,
      method: method,
      total: result.total,
      success_count: result.success_count,
      failed_count: result.failed_count,
      results: result.results,
    });
  } catch (error: any) {
    console.error('Error posting Pengeluaran to INSW:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
