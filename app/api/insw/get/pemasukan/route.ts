import { NextResponse } from 'next/server';
import { INSWIntegrationService } from '@/lib/services/insw-integration.service';
import { checkAuth } from '@/lib/api-auth';

export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

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

    const service = new INSWIntegrationService(
      process.env.INSW_API_KEY || 'RqT40lH7Hy202uUybBLkFhtNnfAvxrlp',
      process.env.INSW_UNIQUE_KEY_TEST || '',
      process.env.INSW_USE_TEST_MODE === 'true'
    );

    const result = await service.getPemasukan({ tglAwal, tglAkhir });

    return NextResponse.json({
      success: result.status,
      message: result.message,
      data: result.data,
      inswResponse: result,
    });
  } catch (error: any) {
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
