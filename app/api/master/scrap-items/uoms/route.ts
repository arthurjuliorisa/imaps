import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';

// Mapping is global (no company column). Expose only active WMS codes to master users.
export async function GET() {
  try {
    const auth = await checkAuth();
    if (!auth.authenticated) return auth.response;
    const company = validateCompanyCode(auth.session);
    if (!company.success) return company.response;

    const mappings = await prisma.insw_uom_mapping.findMany({
      where: { is_active: true },
      select: { wms_uom: true },
      orderBy: { wms_uom: 'asc' },
    });
    return NextResponse.json({ data: [...new Set(mappings.map(row => row.wms_uom))].sort() });
  } catch {
    return NextResponse.json({ message: 'Failed to load WMS UOM options' }, { status: 500 });
  }
}
