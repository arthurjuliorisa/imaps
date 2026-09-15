import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { checkAuth } from '@/lib/api-auth';
import { prisma } from '@/lib/prisma';
import { validateCompanyCode, validateSEZCompany } from '@/lib/company-validation';
import { validateScrapMasterIdentity } from '@/lib/scrap-validation';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { logActivity } from '@/lib/log-activity';
import {
  acquireScrapInswLock,
  getEffectiveScrapInswStatus,
  trackingType,
  type ScrapInswDirection,
} from '@/lib/scrap-insw-finalization';

type RouteContext = { params: Promise<{ id: string }> };

class ScrapTransmitConflictError extends Error {
  constructor(public readonly status: 'PENDING' | 'SUCCESS') {
    super(status === 'SUCCESS' ? 'This Scrap transaction has already been finalized in INSW.' : 'An INSW transmission is already pending for this Scrap transaction.');
  }
}
class ScrapTransmissionValidationError extends Error {}

function validateHeaderForTransmission(header: any, masters: Map<string, any>): string[] {
  const errors: string[] = [];
  if (!header.document_number?.trim()) errors.push('Document number is required');
  if (!(header.transaction_date instanceof Date) || Number.isNaN(header.transaction_date.getTime())) errors.push('Transaction date is invalid');
  if (header.items.length === 0) errors.push('At least one active item is required');
  if (header.transaction_type === 'OUT') {
    if (!header.recipient_name?.trim()) errors.push('Recipient name is required');
    if (!header.customs_document_type) errors.push('Customs document type is required');
    if (!header.ppkek_number?.trim()) errors.push('Registration number is required');
  }
  for (const item of header.items) {
    errors.push(...validateScrapMasterIdentity(masters.get(item.item_code), {
      scrapCode: item.item_code,
      scrapName: item.item_name,
      uom: item.uom,
    }));
    if (!Number.isFinite(Number(item.qty)) || Number(item.qty) <= 0) errors.push(`Quantity for '${item.item_code}' must be greater than zero`);
    if (!Number.isFinite(Number(item.amount)) || Number(item.amount) < 0) errors.push(`Amount for '${item.item_code}' must be non-negative`);
    if (!item.currency) errors.push(`Currency for '${item.item_code}' is required`);
  }
  return errors;
}

export async function POST(_request: Request, { params }: RouteContext) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) return authCheck.response;
    const companyValidation = validateCompanyCode((authCheck as any).session);
    if (!companyValidation.success) return companyValidation.response;
    const { companyCode } = companyValidation;

    const sezValidation = await validateSEZCompany(companyCode);
    if (!sezValidation.success) return sezValidation.response;

    const { id: rawId } = await params;
    const transactionId = Number(rawId);
    if (!Number.isSafeInteger(transactionId) || transactionId <= 0 || String(transactionId) !== rawId) {
      return NextResponse.json({ success: false, message: 'A valid Scrap transaction header ID is required.' }, { status: 400 });
    }

    const claim = await prisma.$transaction(async tx => {
      await acquireScrapInswLock(tx, companyCode, transactionId);
      const header = await tx.scrap_transactions.findFirst({
        where: { id: transactionId, company_code: companyCode, deleted_at: null },
        include: { items: { where: { deleted_at: null }, orderBy: { id: 'asc' } } },
      });
      if (!header || (header.transaction_type !== 'IN' && header.transaction_type !== 'OUT')) return null;

      const typedDirection = header.transaction_type as ScrapInswDirection;
      const status = await getEffectiveScrapInswStatus(tx, companyCode, transactionId, typedDirection);
      if (status === 'SUCCESS' || status === 'PENDING') throw new ScrapTransmitConflictError(status);

      const itemCodes = [...new Set(header.items.map(item => item.item_code))];
      const masters = await tx.scrap_items.findMany({
        where: { company_code: companyCode, scrap_code: { in: itemCodes } },
        select: { scrap_code: true, scrap_name: true, uom: true, is_active: true, deleted_at: true },
      });
      const errors = validateHeaderForTransmission(header, new Map(masters.map(master => [master.scrap_code, master])));
      if (errors.length > 0) throw new ScrapTransmissionValidationError(errors.join('; '));

      const metadata = { source: 'explicit_scrap_send', claim: true, attempt_lifecycle: true, item_count: header.items.length };
      const trackingLog = await tx.insw_tracking_log.create({
        data: {
          transaction_type: trackingType(typedDirection),
          transaction_id: transactionId,
          wms_id: header.document_number,
          company_code: companyCode,
          insw_status: 'PENDING',
          insw_activity_code: typedDirection === 'IN' ? '30' : '31',
          sent_at: new Date(),
          metadata,
        },
      });
      return { direction: typedDirection, trackingLogId: trackingLog.id, metadata };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });

    if (!claim) return NextResponse.json({ success: false, message: 'Active Scrap transaction header not found.' }, { status: 404 });

    const { direction, trackingLogId, metadata } = claim;
    const context = { attempts: new Map([[transactionId, { trackingLogId, metadata }]]) };

    const service = new INSWTransmissionService();
    const result = direction === 'IN'
      ? await service.transmitScrapIn(companyCode, [transactionId], false, context)
      : await service.transmitScrapOut(companyCode, [transactionId], false, context);
    const effectiveStatus = await prisma.$transaction(tx =>
      getEffectiveScrapInswStatus(tx, companyCode, transactionId, direction)
    );

    await logActivity({
      action: 'SCRAP_SEND_TO_INSW',
      description: `Explicitly sent Scrap ${direction} header ${transactionId} to INSW (${effectiveStatus})`,
      status: effectiveStatus === 'SUCCESS' ? 'success' : effectiveStatus === 'FAILED' ? 'failed' : 'pending',
      companyCode,
      metadata: { transactionId, direction, effectiveStatus, resultStatus: result.status },
    });

    return NextResponse.json({ success: effectiveStatus === 'SUCCESS', status: effectiveStatus, data: result }, {
      status: effectiveStatus === 'FAILED' ? 422 : 200,
    });
  } catch (error) {
    if (error instanceof ScrapTransmitConflictError) {
      return NextResponse.json({ success: false, status: error.status, message: error.message }, { status: 409 });
    }
    if (error instanceof ScrapTransmissionValidationError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 400 });
    }
    console.error('[Scrap INSW transmit]', error);
    return NextResponse.json({ success: false, message: 'Failed to send Scrap transaction to INSW.' }, { status: 500 });
  }
}
