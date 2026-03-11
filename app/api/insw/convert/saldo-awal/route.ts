import { NextResponse } from 'next/server';
import { INSWIntegrationService } from '@/lib/services/insw-integration.service';
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
    const { balanceDate } = body;

    const service = new INSWIntegrationService(
      process.env.INSW_API_KEY || 'RqT40lH7Hy202uUybBLkFhtNnfAvxrlp',
      process.env.INSW_UNIQUE_KEY_TEST || '',
      process.env.INSW_USE_TEST_MODE === 'true'
    );

    const payload = await service.convertSaldoAwalToINSW(
      companyCode,
      balanceDate ? new Date(balanceDate) : undefined
    );

    return NextResponse.json({
      success: true,
      message: 'Data successfully converted to INSW format',
      data: payload,
    });
  } catch (error: any) {
    console.error('Error converting Saldo Awal to INSW:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
