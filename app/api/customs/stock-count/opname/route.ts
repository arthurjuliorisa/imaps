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
    console.log('[Stock Opname API] User Role:', userRole); // Debug log
    
    const isCustUser = isCustomsUser(userRole);
    console.log('[Stock Opname API] Is Customs User:', isCustUser); // Debug log

    // Fetch all stock opname data for the company
    let result: any[] = [];

    if (isCustUser) {
      // Customs users: only show data that's been successfully transmitted to INSW
      console.log('[Stock Opname API] Fetching INSW-transmitted data for customs user');
      
      result = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT
          so.id, so.sto_wms_id, so.company_code, so.company_name,
          so.doc_date, so.status,
          so.type_code, so.item_code, so.item_code_bahasa, so.item_name,
          so.unit, so.qty, so.value_amount,
          so.created_at, so.updated_at, so.confirmed_at
        FROM vw_laporan_stock_opname so
        INNER JOIN insw_tracking_log log ON so.sto_wms_id = log.wms_id
        WHERE so.company_code = $1
          AND log.transaction_type = 'stock_opname'
          AND log.insw_status = 'SUCCESS'
          AND log.company_code = $1
        ORDER BY so.doc_date DESC, so.id`,
        companyCode
      );
    } else {
      // Internal users: show all data
      console.log('[Stock Opname API] Fetching all data for internal user');
      
      result = await prisma.$queryRawUnsafe<any[]>(
        `SELECT
          id, sto_wms_id, company_code, company_name,
          doc_date, status,
          type_code, item_code, item_code_bahasa, item_name,
          unit, qty, value_amount,
          created_at, updated_at, confirmed_at
        FROM vw_laporan_stock_opname
        WHERE company_code = $1
        ORDER BY doc_date DESC, id`,
        companyCode
      );
    }

    console.log('[Stock Opname API] Result count:', result.length); // Debug log

    const transformedData = result.map((row: any, index: number) => {
      return {
        id: `${row.id}-${row.item_code}-${index}`,
        companyCode: row.company_code,
        companyName: row.company_name,
        docDate: row.doc_date,
        status: row.status,
        stoWmsId: row.sto_wms_id || '',
        typeCode: row.type_code,
        itemCodeBahasa: row.item_code_bahasa || '',
        itemCode: row.item_code,
        itemName: row.item_name,
        unit: row.unit,
        qty: Number(row.qty || 0),
        valueAmount: Number(row.value_amount || 0),
        reason: '',
      };
    });

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error('[API Error] Failed to fetch stock opname data:', error);
    return NextResponse.json(
      { message: 'Error fetching stock opname data' },
      { status: 500 }
    );
  }
}
