import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { prisma } from '@/lib/prisma';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { acquireScrapInswLock, getEffectiveScrapInswStatus, trackingType, type ScrapInswDirection } from '@/lib/scrap-insw-finalization';

class ScrapResendConflictError extends Error {}

async function claimScrapResend(
  companyCode: number,
  transactionId: number,
  direction: ScrapInswDirection,
  sourceLogId: bigint,
  sourceStatus: string,
  wmsId: string | null
) {
  return prisma.$transaction(async tx => {
    await acquireScrapInswLock(tx, companyCode, transactionId);
    const effectiveStatus = await getEffectiveScrapInswStatus(tx, companyCode, transactionId, direction);
    if (effectiveStatus === 'SUCCESS') throw new ScrapResendConflictError('This Scrap transaction has already been finalized in INSW.');

    if (sourceStatus === 'PENDING') {
      const claimed = await tx.insw_tracking_log.updateMany({
        where: { id: sourceLogId, company_code: companyCode, insw_status: 'PENDING' },
        data: { insw_status: 'RETRYING' },
      });
      if (claimed.count !== 1) throw new ScrapResendConflictError('This pending Scrap transmission is already being resolved.');
    } else if (effectiveStatus === 'PENDING') {
      throw new ScrapResendConflictError('An INSW transmission is already pending for this Scrap transaction.');
    }

    const metadata = {
      source: 'scrap_log_resend',
      claim: true,
      attempt_lifecycle: true,
      source_log_id: sourceLogId.toString(),
    };
    const trackingLog = await tx.insw_tracking_log.create({
      data: {
        transaction_type: trackingType(direction), transaction_id: transactionId,
        wms_id: wmsId, company_code: companyCode, insw_status: 'PENDING',
        insw_activity_code: direction === 'IN' ? '30' : '31', sent_at: new Date(),
        metadata,
      },
    });
    return { trackingLogId: trackingLog.id, metadata };
  }, { timeout: 30000 });
}

export async function POST(
  request: Request,
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

    const { companyCode } = companyValidation;
    const { id: idParam } = await params;
    const logId = BigInt(idParam);

    const log = await prisma.insw_tracking_log.findFirst({
      where: { id: logId, company_code: companyCode },
    });

    if (!log) {
      return NextResponse.json(
        { success: false, message: 'Log tidak ditemukan' },
        { status: 404 }
      );
    }

    if (log.insw_status !== 'FAILED' && log.insw_status !== 'PENDING') {
      return NextResponse.json(
        { success: false, message: 'Hanya log dengan status FAILED atau PENDING yang dapat dikirim ulang' },
        { status: 400 }
      );
    }
    const service = new INSWTransmissionService();

    let result;
    const logCompanyCode = log.company_code;
    const transactionId = log.transaction_id ? Number(log.transaction_id) : null;
    const wmsId = log.wms_id;
    // Only skip endpoint check for PENDING status. FAILED status must respect endpoint settings.
    const skipEndpointCheck = log.insw_status === 'PENDING';

    switch (log.transaction_type) {
      case 'incoming':
        if (!transactionId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitIncomingGoods(logCompanyCode, [transactionId], skipEndpointCheck);
        break;

      case 'outgoing':
        if (wmsId) {
          result = await service.transmitOutgoingGoodsByWmsIds(logCompanyCode, [wmsId], skipEndpointCheck);
        } else if (transactionId) {
          result = await service.transmitOutgoingGoodsByIds(logCompanyCode, [transactionId], skipEndpointCheck);
        } else {
          return NextResponse.json(
            { success: false, message: 'Transaction ID atau WMS ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        break;

      case 'material_usage':
        if (!transactionId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitMaterialUsage(logCompanyCode, [transactionId], [wmsId || ''], skipEndpointCheck);
        break;

      case 'production_output':
        if (!transactionId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitProductionOutput(logCompanyCode, [transactionId], [wmsId || ''], skipEndpointCheck);
        break;

      case 'scrap_in':
        if (!transactionId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        const scrapInAttempt = await claimScrapResend(logCompanyCode, transactionId, 'IN', logId, log.insw_status, wmsId);
        result = await service.transmitScrapIn(logCompanyCode, [transactionId], skipEndpointCheck, {
          attempts: new Map([[transactionId, scrapInAttempt]]),
        });
        break;

      case 'scrap_out':
        if (!transactionId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        const scrapOutAttempt = await claimScrapResend(logCompanyCode, transactionId, 'OUT', logId, log.insw_status, wmsId);
        result = await service.transmitScrapOut(logCompanyCode, [transactionId], skipEndpointCheck, {
          attempts: new Map([[transactionId, scrapOutAttempt]]),
        });
        break;

      case 'capital_goods_out':
        if (!wmsId) {
          return NextResponse.json(
            { success: false, message: 'WMS ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitCapitalGoodsOut(logCompanyCode, [wmsId], skipEndpointCheck);
        break;

      case 'stock_opname':
        if (!transactionId || !wmsId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID dan WMS ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitStockOpname(logCompanyCode, transactionId, wmsId, skipEndpointCheck);
        break;

      case 'adjustment':
        if (!transactionId || !wmsId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID dan WMS ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitAdjustment(logCompanyCode, transactionId, wmsId, skipEndpointCheck);
        break;

      default:
        return NextResponse.json(
          { success: false, message: `Tipe transaksi "${log.transaction_type}" tidak didukung untuk pengiriman ulang` },
          { status: 400 }
        );
    }

    // Hybrid status update: If retry PENDING and SUCCESS, update original log to PENDING_RESOLVED
    if (log.insw_status === 'PENDING' && result.status === 'success') {
      await prisma.insw_tracking_log.update({
        where: { id: logId },
        data: { insw_status: 'PENDING_RESOLVED' },
      });
    }

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    if (error instanceof ScrapResendConflictError) {
      return NextResponse.json({ success: false, message: error.message }, { status: 409 });
    }
    console.error('Error resending INSW log:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Gagal mengirim ulang data ke INSW' },
      { status: 500 }
    );
  }
}
