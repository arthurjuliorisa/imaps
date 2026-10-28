import { NextResponse } from 'next/server';
import type { Session } from 'next-auth';
import { checkAuthWithRole } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { prisma } from '@/lib/prisma';
import { logActivity } from '@/lib/log-activity';
import { assertBeginningBalanceCompanyScope, BeginningBalanceStateError, lockBeginningBalanceLocally } from '@/lib/beginning-balance-state';

export async function POST(request: Request) {
  let localActor: { userId: string; companyCode: number } | undefined;
  try {
    // ADMIN is the existing canonical role used by checkAuthWithRole callers and menu access.
    const authCheck = await checkAuthWithRole(['ADMIN']);
    if (!authCheck.authenticated) return authCheck.response;

    const session = authCheck.session as Session;
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) return companyValidation.response;
    const { companyCode } = companyValidation;
    // An empty POST can still expose a body stream (e.g. through the Next adapter).
    const requestText = await request.text();
    let body: Record<string, unknown> | undefined;
    if (requestText.trim()) {
      try {
        body = JSON.parse(requestText);
      } catch {
        return NextResponse.json({ success: false, message: 'Invalid JSON in request body' }, { status: 400 });
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return NextResponse.json({ success: false, message: 'Request body must be a JSON object' }, { status: 400 });
      }
    }
    assertBeginningBalanceCompanyScope(request, companyCode, body);
    const company = await prisma.companies.findUnique({
      where: { code: companyCode }, select: { company_type: true },
    });

    if (company?.company_type === 'BZ') {
      localActor = { userId: session!.user.id, companyCode };
      const result = await prisma.$transaction(
        tx => lockBeginningBalanceLocally(tx, companyCode),
        { isolationLevel: 'ReadCommitted', timeout: 60000 }
      );
      await logActivity({
        ...localActor,
        action: 'LOCK_BEGINNING_DATA',
        description: result.alreadyLocked ? 'BZ Beginning Balance already locked locally' : 'BZ Beginning Balance locked locally in iMAPS',
        status: 'success',
        metadata: { ...result, companyCode, companyType: 'BZ', outcome: result.alreadyLocked ? 'already_locked' : 'locked' },
      });
      return NextResponse.json({
        success: true,
        message: result.alreadyLocked
          ? 'Beginning Balance is already locked locally in iMAPS. No data was sent to INSW.'
          : 'Beginning Balance locked locally in iMAPS. No data was sent to INSW.',
      });
    }

    if (company?.company_type !== 'SEZ') {
      return NextResponse.json({ success: false, error: 'COMPANY_TYPE_NOT_ALLOWED', message: 'Beginning Balance LOCK requires a BZ or SEZ company' }, { status: 403 });
    }

    // Import only for SEZ: BZ never constructs a converter/client or resolves INSW config.
    const { INSWTransmissionService } = await import('@/lib/services/insw-transmission.service');
    const result = await new INSWTransmissionService().lockSaldoAwal(companyCode);
    return NextResponse.json({
      success: result.status === 'success', message: result.message, insw_response: result.insw_response,
    });
  } catch (error: any) {
    if (localActor) await logActivity({
      ...localActor, action: 'LOCK_BEGINNING_DATA', description: 'BZ local Beginning Balance lock failed',
      status: 'failed', metadata: { companyCode: localActor.companyCode, outcome: 'failed', error: error.message },
    });
    if (error instanceof BeginningBalanceStateError) return NextResponse.json({ success: false, message: error.message }, { status: error.status });
    console.error('Error locking Beginning Balance:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
