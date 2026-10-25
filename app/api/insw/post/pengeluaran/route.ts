import { NextResponse } from 'next/server';
import { WmsAdmissionError, submitOutgoingOriginals } from '@/lib/insw-queue/wms-coordination';
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
    const { ids, wmsIds } = body;
    const byReference = Array.isArray(wmsIds) && wmsIds.length > 0;
    const result = await submitOutgoingOriginals(prisma, companyCode, byReference ? wmsIds : ids, byReference, String(session.user.id));
    return NextResponse.json({ ...result, method: byReference ? 'wmsIds' : 'ids' },
      { status: ['accepted', 'already_pending'].includes(result.status) ? 202 : 409 });
  } catch (error: any) {
    if (error instanceof WmsAdmissionError) return NextResponse.json({ success: false, status: 'not_eligible', message: error.message }, { status: 400 });
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
