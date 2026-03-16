import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';
import { isCustomsUser } from '@/lib/utils/user-role.util';

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

    // Check user role for INSW transmission filter
    const userRole = (session as any)?.user?.role;
    console.log('[Adjustment API] User Role:', userRole); // Debug log
    
    const isCustUser = isCustomsUser(userRole);
    console.log('[Adjustment API] Is Customs User:', isCustUser); // Debug log

    // Fetch all adjustment data for the company
    let result: any[] = [];

    if (isCustUser) {
      // Customs users: only show data that's been successfully transmitted to INSW
      console.log('[Adjustment API] Fetching INSW-transmitted data for customs user');
      
      result = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT
          ad.id, ad.sto_wms_id, ad.adjustment_wms_id, ad.internal_evidence_number, 
          ad.company_code, ad.company_name,
          ad.doc_date,
          ad.type_code, ad.item_code, ad.item_code_bahasa, ad.item_name, ad.unit,
          ad.beginning_qty, ad.incoming_qty_on_date, ad.outgoing_qty_on_date,
          ad.system_qty, ad.actual_qty_count, ad.variance_qty,
          ad.adjustment_qty_signed, ad.final_adjusted_qty,
          ad.value_amount, ad.reason
        FROM vw_laporan_adjustment ad
        INNER JOIN insw_tracking_log log ON ad.adjustment_wms_id = log.wms_id
        WHERE ad.company_code = $1
          AND log.transaction_type = 'adjustment'
          AND log.insw_status = 'SUCCESS'
          AND log.company_code = $1
        ORDER BY ad.doc_date DESC, ad.id`,
        companyCode
      );
    } else {
      // Internal users: show all data
      console.log('[Adjustment API] Fetching all data for internal user');
      
      result = await prisma.$queryRawUnsafe<any[]>(
        `SELECT
          id, sto_wms_id, adjustment_wms_id, internal_evidence_number, company_code, company_name,
          doc_date,
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
    }

    console.log('[Adjustment API] Result count:', result.length); // Debug log

    const transformedData = result.map((row: any, index: number) => ({
      id: `${row.id}-${row.item_code}-${index}`,
      companyCode: row.company_code,
      companyName: row.company_name,
      docDate: row.doc_date,
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
