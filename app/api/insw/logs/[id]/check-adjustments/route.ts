import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { prisma } from '@/lib/prisma';

export async function GET(
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

    // Only check adjustments for stock_opname transaction type
    if (log.transaction_type !== 'stock_opname') {
      return NextResponse.json(
        { success: true, hasAdjustments: false },
        { status: 200 }
      );
    }

    const wmsId = log.wms_id;
    if (!wmsId) {
      return NextResponse.json(
        { success: true, hasAdjustments: false },
        { status: 200 }
      );
    }

    // Check if there are any adjustment items with this stockcount_order_number
    const adjustmentCount = await prisma.adjustment_items.count({
      where: {
        stockcount_order_number: wmsId,
        deleted_at: null,
      },
    });

    return NextResponse.json(
      {
        success: true,
        hasAdjustments: adjustmentCount > 0,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error checking adjustments:', error);
    return NextResponse.json(
      { success: false, message: 'Gagal mengecek adjustment' },
      { status: 500 }
    );
  }
}
