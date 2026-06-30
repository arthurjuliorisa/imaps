import { NextResponse } from 'next/server';
import { AdjustmentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;
    const adjustmentId = Number(id);
    if (!Number.isInteger(adjustmentId)) {
      return NextResponse.json({ message: 'Invalid reversal record id' }, { status: 400 });
    }

    const record = await prisma.adjustments.findFirst({
      where: {
        id: adjustmentId,
        company_code: companyValidation.companyCode,
        wms_doc_type: 'revise_adjustment',
        deleted_at: null,
      },
      include: {
        company: { select: { name: true } },
        items: {
          where: { deleted_at: null },
          orderBy: { id: 'asc' },
          select: {
            id: true,
            item_type: true,
            item_code: true,
            item_name: true,
            uom: true,
            adjustment_type: true,
            qty: true,
            amount: true,
            reason: true,
          },
        },
      },
    });

    if (!record) {
      return NextResponse.json({ message: 'Reversal record not found' }, { status: 404 });
    }

    const latestLog = await prisma.insw_tracking_log.findFirst({
      where: {
        company_code: companyValidation.companyCode,
        transaction_type: 'adjustment',
        wms_id: record.wms_id,
      },
      orderBy: { created_at: 'desc' },
      select: {
        insw_status: true,
        insw_activity_code: true,
        sent_at: true,
        insw_error: true,
        retry_count: true,
        created_at: true,
      },
    });

    const data = {
      id: record.id,
      wmsId: record.wms_id,
      companyCode: record.company_code,
      companyName: record.company?.name || '',
      owner: record.owner,
      internalEvidenceNumber: record.internal_evidence_number,
      transactionDate: record.transaction_date,
      timestamp: record.timestamp,
      wmsDocType: record.wms_doc_type,
      createdAt: record.created_at,
      updatedAt: record.updated_at,
      items: record.items.map((item) => {
        const signedStockImpact = item.adjustment_type === AdjustmentType.LOSS
          ? -Number(item.qty)
          : Number(item.qty);

        return {
          id: item.id,
          itemType: item.item_type,
          itemCode: item.item_code,
          itemName: item.item_name,
          uom: item.uom,
          adjustmentType: item.adjustment_type,
          qty: Number(item.qty),
          signedStockImpact,
          amount: item.amount ? Number(item.amount) : null,
          reason: item.reason,
        };
      }),
      insw: latestLog
        ? {
            latestStatus: latestLog.insw_status,
            activityCode: latestLog.insw_activity_code,
            sentTime: latestLog.sent_at,
            errorMessage: latestLog.insw_error,
            retryCount: latestLog.retry_count,
            latestLogCreatedAt: latestLog.created_at,
          }
        : null,
    };

    return NextResponse.json(serializeBigInt(data));
  } catch (error: any) {
    console.error('[API Error] Failed to fetch reversal record detail:', error);
    return NextResponse.json(
      { message: 'Error fetching reversal record detail', error: error.message },
      { status: 500 }
    );
  }
}
