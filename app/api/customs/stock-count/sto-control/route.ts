import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

export async function GET(request: Request) {
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

    const url = new URL(request.url);
    const dataType = url.searchParams.get('type');

    // If requesting distinct dates
    if (dataType === 'dates') {
      const distinctDates = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT activation_date
         FROM vw_sto_control
         WHERE company_code = $1
         ORDER BY activation_date DESC`,
        companyCode
      );

      const formattedDates = distinctDates.map((row: any) => {
        const dateStr = new Date(row.activation_date).toISOString().split('T')[0];
        return {
          date: dateStr,
          label: new Date(row.activation_date).toLocaleDateString('id-ID', {
            year: 'numeric',
            month: 'long',
            day: '2-digit',
          }),
        };
      });

      return NextResponse.json(serializeBigInt(formattedDates));
    }

    // Default: return all data
    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        sto_id,
        wms_id,
        company_code,
        company_name,
        owner,
        activation_date,
        adjustment_wms_id,
        status,
        item_id,
        item_type,
        item_code,
        item_name,
        uom,
        original_beginning_qty,
        adjusted_beginning_qty,
        in_qty,
        out_qty,
        original_ending_qty,
        adjusted_ending_qty,
        wms_ending_qty,
        variance_adjusted_ending,
        variance_original_ending,
        sto_count_qty,
        adjustment_qty,
        final_qty,
        reason,
        confirmed_at
      FROM vw_sto_control
      WHERE company_code = $1
      ORDER BY activation_date DESC, sto_id, item_id`,
      companyCode
    );

    const transformedData = result.map((row: any) => {
      const dateStr = new Date(row.activation_date).toISOString().split('T')[0];
      return {
      id: `${row.sto_id}-${row.item_id}`,
      companyName: row.company_name,
      wmsId: row.wms_id || '',
      owner: row.owner != null ? parseInt(row.owner) : null,
      activationDate: dateStr,
      adjustmentWmsId: row.adjustment_wms_id || null,
      status: row.status || '',
      itemType: row.item_type || '',
      itemCode: row.item_code || '',
      itemName: row.item_name || '',
      uom: row.uom || '',
      originalBeginningQty: Number(row.original_beginning_qty || 0),
      adjustedBeginningQty: Number(row.adjusted_beginning_qty || 0),
      inQty: Number(row.in_qty || 0),
      outQty: Number(row.out_qty || 0),
      originalEndingQty: Number(row.original_ending_qty || 0),
      adjustedEndingQty: Number(row.adjusted_ending_qty || 0),
      wmsEndingQty: Number(row.wms_ending_qty || 0),
      varianceAdjustedEnding: Number(row.variance_adjusted_ending || 0),
      varianceOriginalEnding: Number(row.variance_original_ending || 0),
      stoCountQty: Number(row.sto_count_qty || 0),
      adjustmentQty: Number(row.adjustment_qty || 0),
      finalQty: Number(row.final_qty || 0),
      reason: row.reason || '',
    };
    });

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch STO control data:', error);
    return NextResponse.json(
      { message: 'Error fetching STO control data' },
      { status: 500 }
    );
  }
}
