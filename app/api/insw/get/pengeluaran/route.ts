import { NextResponse } from 'next/server';
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
    const { tglAwal, tglAkhir } = body;

    if (!tglAwal || !tglAkhir) {
      return NextResponse.json(
        {
          success: false,
          error: 'tglAwal and tglAkhir are required (format: DD-MM-YYYY)',
        },
        { status: 400 }
      );
    }

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

    const result = await service.getPengeluaran({ tglAwal, tglAkhir });

    return NextResponse.json({
      success: result.status,
      message: result.message,
      data: result.data,
      inswResponse: result,
    });
  } catch (error: any) {
    console.error('Error getting Pengeluaran from INSW:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
