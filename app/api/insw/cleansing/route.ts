import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { resolveInswCompanyNpwp } from '@/lib/config/insw-company-config';
import { createInswIntegrationService } from '@/lib/services/insw-service.factory';

export async function DELETE(request: Request) {
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

    if (session.user?.role !== 'ADMIN' && session.user?.role !== 'SUPERADMIN') {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: Only ADMIN can perform cleansing data',
        },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const requestedNpwp = searchParams.get('npwp');

    if (!requestedNpwp) {
      return NextResponse.json(
        {
          success: false,
          error: 'NPWP is required',
        },
        { status: 400 }
      );
    }

    const npwp = resolveInswCompanyNpwp(companyCode);
    if (requestedNpwp.trim() !== npwp) {
      return NextResponse.json(
        {
          success: false,
          error: 'NPWP does not match configured company NPWP',
        },
        { status: 400 }
      );
    }

    const service = createInswIntegrationService(companyCode);

    const result = await service.cleansingData(npwp);

    return NextResponse.json({
      success: result.status,
      message: result.message,
      data: result.data,
      inswResponse: result,
    });
  } catch (error: any) {
    console.error('Error cleansing INSW data:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 }
    );
  }
}
