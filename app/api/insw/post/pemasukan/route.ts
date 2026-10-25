import { NextResponse } from 'next/server';
import { IncomingAdmissionError, submitIncomingOriginals } from '@/lib/insw-queue/incoming-coordination';
import { prisma } from '@/lib/db/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode, validateSEZCompany } from '@/lib/company-validation';

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

    const sezValidation = await validateSEZCompany(companyCode);
    if (!sezValidation.success) {
      return sezValidation.response;
    }

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
    const result = await submitIncomingOriginals(prisma, companyCode, ids, String(session.user.id));
    return NextResponse.json(result, { status: result.status === 'not_eligible' ? 409 : result.status === 'capture_failed' ? 503 : 202 });
  } catch (error: any) {
    if (error instanceof IncomingAdmissionError) return NextResponse.json({ success: false, status: 'not_eligible', error: error.message }, { status: 409 });
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
