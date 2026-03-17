import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { prisma } from '@/lib/prisma';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';

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

    const useTestMode = process.env.INSW_USE_TEST_MODE === 'true';
    const service = new INSWTransmissionService(useTestMode);

    let result;
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
        result = await service.transmitIncomingGoods(companyCode, [transactionId]);
        break;

      case 'outgoing':
        if (wmsId) {
          result = await service.transmitOutgoingGoodsByWmsIds(companyCode, [wmsId]);
        } else if (transactionId) {
          result = await service.transmitOutgoingGoodsByIds(companyCode, [transactionId]);
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
        result = await service.transmitMaterialUsage(companyCode, [transactionId], []);
        break;

      case 'production_output':
        if (!transactionId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitProductionOutput(companyCode, [transactionId], []);
        break;

      case 'scrap_in':
        if (!transactionId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitScrapIn(companyCode, [transactionId]);
        break;

      case 'scrap_out':
        if (!transactionId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitScrapOut(companyCode, [transactionId]);
        break;

      case 'capital_goods_out':
        if (!wmsId) {
          return NextResponse.json(
            { success: false, message: 'WMS ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitCapitalGoodsOut(companyCode, [wmsId]);
        break;

      case 'stock_opname':
        if (!transactionId || !wmsId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID dan WMS ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitStockOpname(companyCode, transactionId, wmsId, skipEndpointCheck);
        break;

      case 'adjustment':
        if (!transactionId || !wmsId) {
          return NextResponse.json(
            { success: false, message: 'Transaction ID dan WMS ID tidak ditemukan pada log ini' },
            { status: 400 }
          );
        }
        result = await service.transmitAdjustment(companyCode, transactionId, wmsId, skipEndpointCheck);
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
    console.error('Error resending INSW log:', error);
    return NextResponse.json(
      { success: false, message: error.message || 'Gagal mengirim ulang data ke INSW' },
      { status: 500 }
    );
  }
}
