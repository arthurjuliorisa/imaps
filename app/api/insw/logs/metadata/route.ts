import { NextResponse } from 'next/server';
import { checkInswAuth } from '@/lib/insw-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';

/** Scoped, unpaginated values for the INSW log filters. */
export async function GET(request: Request) {
  try {
    const authCheck = await checkInswAuth();
    if (!authCheck.authenticated) return authCheck.response;

    const companyValidation = validateCompanyCode((authCheck as { session: any }).session);
    if (!companyValidation.success) return companyValidation.response;

    const searchParams = new URL(request.url).searchParams;
    const metadata = await new INSWTransmissionService().getTransmissionLogMetadata({
      company_code: companyValidation.companyCode,
      date_from: searchParams.get('date_from') || undefined,
      date_to: searchParams.get('date_to') || undefined,
    });
    return NextResponse.json({ success: true, data: {
      transactionTypes: [...new Set([...metadata.transactionTypes, 'incoming', 'outgoing', 'material_usage', 'production_output', 'adjustment', 'stock_opname'])].sort(),
      statuses: [...new Set([...metadata.statuses, 'NO_ATTEMPT_LOG'])].sort(),
    } });
  } catch (error: any) {
    console.error('Error getting INSW log metadata:', error);
    return NextResponse.json({ success: false, error: error.message, data: { transactionTypes: [], statuses: [] } }, { status: 500 });
  }
}
