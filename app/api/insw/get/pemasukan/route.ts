import { NextResponse } from 'next/server';
import { INSWRetrievalDateError, normalizeINSWRetrievalParams } from '@/lib/utils/insw-retrieval-params';
import { checkAuth } from '@/lib/api-auth';
import { createInswIntegrationService } from '@/lib/services/insw-service.factory';

export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyCode = Number(session?.user?.companyCode);
    const body = await request.json();
    const { tglAwal, tglAkhir } = body ?? {};
    const params = normalizeINSWRetrievalParams({ tglAwal, tglAkhir });

    if (!Number.isFinite(companyCode) || companyCode <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Company code is required for company-specific INSW credentials',
        },
        { status: 400 }
      );
    }

    const service = createInswIntegrationService(companyCode);

    const result = await service.getPemasukan(params);

    return NextResponse.json({
      success: result.status,
      message: result.message,
      data: result.data,
      inswResponse: result,
    });
  } catch (error: any) {
    if (error instanceof INSWRetrievalDateError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 400 });
    }
    console.error('Error getting Pemasukan from INSW:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
