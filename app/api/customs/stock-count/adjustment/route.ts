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

    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        id, sto_wms_id, adjustment_wms_id, internal_evidence_number, company_code, company_name,
        doc_date, status,
        type_code, item_code, item_code_bahasa, item_name, unit,
        beginning_qty, incoming_qty_on_date, outgoing_qty_on_date,
        system_qty, actual_qty_count, variance_qty,
        adjustment_qty_signed, final_adjusted_qty,
        value_amount, reason
      FROM vw_laporan_adjustment
      WHERE company_code = $1
      ORDER BY doc_date DESC, id`,
      companyCode
    );

    const transformedData = result.map((row: any, index: number) => ({
      id: `${row.id}-${row.item_code}-${index}`,
      companyCode: row.company_code,
      companyName: row.company_name,
      docDate: row.doc_date,
      status: row.status,
      stoWmsId: row.sto_wms_id || '',
      adjustmentWmsId: row.adjustment_wms_id || '',
      internalEvidenceNumber: row.internal_evidence_number || '',
      typeCode: row.type_code,
      itemCodeBahasa: row.item_code_bahasa || '',
      itemCode: row.item_code,
      itemName: row.item_name,
      unit: row.unit,
      beginningQty: Number(row.beginning_qty || 0),
      incomingQty: Number(row.incoming_qty_on_date || 0),
      outgoingQty: Number(row.outgoing_qty_on_date || 0),
      systemQty: Number(row.system_qty || 0),
      actualQty: Number(row.actual_qty_count || 0),
      varianceQty: Number(row.variance_qty || 0),
      adjustmentQty: Number(row.adjustment_qty_signed || 0),
      finalQty: Number(row.final_adjusted_qty || 0),
      valueAmount: Number(row.value_amount || 0),
      reason: row.reason || '',
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch adjustment data:', error);
    return NextResponse.json(
      { message: 'Error fetching adjustment data' },
      { status: 500 }
    );
  }
}
