import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { OutgoingGoodsRepository } from '@/lib/repositories/outgoing-goods.repository';
import { logActivity } from '@/lib/log-activity';

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN', 'SUPERADMIN'];

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }
  if (!ADMIN_ROLES.includes(session.user?.role || '')) {
    return NextResponse.json({ success: false, message: 'Forbidden - Admin access required' }, { status: 403 });
  }

  let outgoingGoodId: number | null = null;
  let companyCode: number | null = null;
  try {
    const body = await request.json();
    outgoingGoodId = Number(body.outgoing_good_id);
    companyCode = Number(body.company_code);
    if (!Number.isInteger(outgoingGoodId) || outgoingGoodId <= 0 || !Number.isInteger(companyCode) || companyCode <= 0) {
      return NextResponse.json(
        { success: false, message: 'outgoing_good_id and company_code are required' },
        { status: 400 }
      );
    }

    const result = await new OutgoingGoodsRepository().recalculateTraceabilityForOutgoing(
      outgoingGoodId,
      companyCode
    );
    await logActivity({
      action: 'OUTGOING_TRACEABILITY_RECALCULATE',
      description: `Recalculated outgoing traceability for ${result.outgoingWmsId}`,
      companyCode,
      userId: session.user?.id || null,
      metadata: {
        outgoing_good_id: outgoingGoodId,
        outgoing_wms_id: result.outgoingWmsId,
        company_code: companyCode,
        old_row_count: result.oldRowCount,
        new_row_count: result.newRowCount,
      },
    });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to recalculate traceability';
    // A failed audit write must never mask the rebuild error or trigger any
    // transmission behavior. The target identifiers remain useful for ops.
    await logActivity({
      action: 'OUTGOING_TRACEABILITY_RECALCULATE',
      description: `Failed to recalculate outgoing traceability: ${message}`,
      status: 'failed',
      companyCode,
      userId: session.user?.id || null,
      metadata: { outgoing_good_id: outgoingGoodId, company_code: companyCode, error: message },
    }).catch(() => undefined);
    return NextResponse.json(
      { success: false, message },
      { status: message === 'Outgoing transaction not found' ? 404 : 500 }
    );
  }
}
