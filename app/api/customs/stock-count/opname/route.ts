import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';
import { canViewSystemQty } from '@/lib/utils/user-role.util';

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

    // Check user role for system qty visibility
    const userRole = (session as any)?.user?.role;
    const showSystemQty = canViewSystemQty(userRole);

    const result = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        id, wms_id, company_code, company_name,
        doc_date, status,
        type_code, item_code, item_code_bahasa, item_name,
        unit, qty, system_qty, value_amount
      FROM vw_laporan_stock_opname
      WHERE company_code = $1
      ORDER BY doc_date DESC, id`,
      companyCode
    );

    const transformedData = result.map((row: any, index: number) => {
      const data: any = {
        id: `${row.id}-${row.item_code}-${index}`,
        companyCode: row.company_code,
        companyName: row.company_name,
        docDate: row.doc_date,
        status: row.status,
        typeCode: row.type_code,
        itemCodeBahasa: row.item_code_bahasa || '',
        itemCode: row.item_code,
        itemName: row.item_name,
        unit: row.unit,
        qty: Number(row.qty || 0),
        valueAmount: Number(row.value_amount || 0),
        reason: '',
      };

      // Include system_qty only for users who can view it
      if (showSystemQty) {
        data.systemQty = Number(row.system_qty || 0);
      }

      return data;
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
