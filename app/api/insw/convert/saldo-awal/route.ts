import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { createInswPayloadConverter } from '@/lib/services/insw-service.factory';

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

    const service = createInswPayloadConverter();

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
