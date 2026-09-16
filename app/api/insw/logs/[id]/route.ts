import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) return authCheck.response;
    const companyValidation = validateCompanyCode((authCheck as { session: any }).session);
    if (!companyValidation.success) return companyValidation.response;

    const { id } = await params;
    let logId: bigint;
    try { logId = BigInt(id); } catch { return NextResponse.json({ success: false, error: 'Invalid log ID' }, { status: 400 }); }
    const log = await new INSWTransmissionService().getTransmissionLogDetail(companyValidation.companyCode, logId);
    if (!log) return NextResponse.json({ success: false, error: 'Log tidak ditemukan' }, { status: 404 });
    if (log.id !== logId) {
      console.error('INSW log detail identity mismatch', { requestedId: id, returnedId: log.id.toString() });
      return NextResponse.json({ success: false, error: 'Log tidak ditemukan' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: { ...log, id: log.id.toString() } });
  } catch (error: any) {
    console.error('Error getting INSW log detail:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
