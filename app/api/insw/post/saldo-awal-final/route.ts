import { NextResponse } from 'next/server';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode, validateSEZCompany } from '@/lib/company-validation';

export async function POST() {
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

    const sezValidation = await validateSEZCompany(companyCode);
    if (!sezValidation.success) {
      return sezValidation.response;
    }

    const useTestMode = process.env.INSW_USE_TEST_MODE === 'true';
    const service = new INSWTransmissionService(useTestMode);

    const result = await service.lockSaldoAwal(companyCode);

    return NextResponse.json({
      success: result.status === 'success',
      message: result.message,
      insw_response: result.insw_response,
    });
  } catch (error: any) {
    console.error('Error locking Saldo Awal at INSW:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
