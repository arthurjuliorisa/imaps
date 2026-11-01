import { attemptHistory } from '@/lib/insw-queue/attempt-history';
import { prisma } from '@/lib/db/prisma';
import { NextResponse } from 'next/server';
import { currentQueueStates } from '@/lib/insw-queue/operational-logs';
import { logResendEligibility } from '@/lib/insw-log-actions';
import { checkInswAuth } from '@/lib/insw-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authCheck = await checkInswAuth();
    if (!authCheck.authenticated) return authCheck.response;
    const companyValidation = validateCompanyCode((authCheck as { session: any }).session);
    if (!companyValidation.success) return companyValidation.response;

    const { id } = await params;
    if (id.startsWith('queue:')) {
      const queueId = id.slice(6);
      if (!/^[0-9a-f-]{36}$/i.test(queueId)) return NextResponse.json({ error: 'Invalid queue ID' }, { status: 400 });
      const queue = await prisma.insw_queue_cycle.findFirst({ where: { id: queueId, company_code: companyValidation.companyCode },
        select: { id: true, operation: true, wms_reference: true, company_code: true, queued_at: true } });
      if (!queue) return NextResponse.json({ error: 'Log tidak ditemukan' }, { status: 404 });
      const states = await currentQueueStates(prisma, companyValidation.companyCode, [queue.id]);
      return NextResponse.json({ success: true, data: { id, transaction_type: queue.operation.toLowerCase(),
        wms_id: queue.wms_reference, company_code: queue.company_code, insw_status: 'NO_ATTEMPT_LOG',
        sent_at: null, created_at: queue.queued_at, retry_count: 0, can_resend: false,
        attempt_history: await attemptHistory(prisma, companyValidation.companyCode, queue.id),
        queue_id: queue.id, current_queue: states.get(queue.id) } });
    }
    let logId: bigint;
    try { logId = BigInt(id); } catch { return NextResponse.json({ success: false, error: 'Invalid log ID' }, { status: 400 }); }
    const log = await new INSWTransmissionService().getTransmissionLogDetail(companyValidation.companyCode, logId);
    if (!log) return NextResponse.json({ success: false, error: 'Log tidak ditemukan' }, { status: 404 });
    if (log.id !== logId) {
      console.error('INSW log detail identity mismatch', { requestedId: id, returnedId: log.id.toString() });
      return NextResponse.json({ success: false, error: 'Log tidak ditemukan' }, { status: 404 });
    }
    const eligible = authCheck.grants.canEdit ? await logResendEligibility(prisma, companyValidation.companyCode, [log]) : new Set<string>();
    const attempt = log.queue_attempt_id ? await prisma.insw_queue_attempt.findFirst({
      where: { id: log.queue_attempt_id, queue: { company_code: companyValidation.companyCode } }, select: { queue_id: true } }) : null;
    const states = await currentQueueStates(prisma, companyValidation.companyCode, attempt ? [attempt.queue_id] : []);
    return NextResponse.json({ success: true, data: { ...log, id: log.id.toString(),
      attempt_history: attempt ? await attemptHistory(prisma, companyValidation.companyCode, attempt.queue_id) : null,
      queue_id: attempt?.queue_id ?? null, current_queue: attempt ? states.get(attempt.queue_id) : null,
      can_resend: authCheck.grants.canEdit && eligible.has(logId.toString()) } });
  } catch (error: any) {
    console.error('Error getting INSW log detail:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
