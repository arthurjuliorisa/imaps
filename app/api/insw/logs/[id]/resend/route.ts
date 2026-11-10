import { WmsAdmissionError, resendWmsLog, wmsLogTypes } from '@/lib/insw-queue/wms-coordination';
import { NextResponse } from 'next/server';
import { checkInswAuth } from '@/lib/insw-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { prisma } from '@/lib/prisma';
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkInswAuth('edit');
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }

    const { companyCode } = companyValidation;
    const { id: idParam } = await params;
    if (!/^[1-9][0-9]{0,18}$/.test(idParam)) return NextResponse.json({ success: false, message: 'Invalid log ID' }, { status: 400 });
    const logId = BigInt(idParam);

    const log = await prisma.insw_tracking_log.findFirst({
      where: { id: logId, company_code: companyCode }, select: { transaction_type: true },
    });

    if (!log) {
      return NextResponse.json(
        { success: false, message: 'Log tidak ditemukan' },
        { status: 404 }
      );
    }

    if (wmsLogTypes.some(type => type === log.transaction_type)) {
      const body = await request.json().catch(() => ({}));
      const result = await resendWmsLog(prisma, companyCode, logId, String(session.user.id), body.reason || 'Operator confirmed INSW-log RESEND');
      return NextResponse.json(result, { status: 202 });
    }

    return NextResponse.json({ success: false, status: 'not_eligible',
      message: 'Frozen exhausted queue and approved last failure evidence required for ordinary Manual Resend.' }, { status: 409 });
  } catch (error: any) {
    if (error instanceof WmsAdmissionError) return NextResponse.json({ success: false, status: 'not_eligible', message: error.message }, { status: 409 });
    console.error('Error resending INSW log:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Gagal mengirim ulang data ke INSW' },
      { status: 500 }
    );
  }
}
