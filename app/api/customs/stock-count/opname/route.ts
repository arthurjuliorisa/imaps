import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

// MOCK DATA - Replace with actual database queries when ready
const MOCK_OPNAME_HEADERS = [
  {
    id: 'OPN-001',
    documentNumber: 'OPN-001',
    date: new Date('2026-02-01'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Stock Opname Periode Januari 2026',
  },
  {
    id: 'OPN-002',
    documentNumber: 'OPN-002',
    date: new Date('2026-02-05'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'PROCESS',
    description: 'Stock Opname Gudang A',
  },
  {
    id: 'OPN-003',
    documentNumber: 'OPN-003',
    date: new Date('2026-02-08'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Stock Opname Gudang B',
  },
  {
    id: 'OPN-004',
    documentNumber: 'OPN-004',
    date: new Date('2026-02-10'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'PROCESS',
    description: 'Stock Opname Mingguan',
  },
  {
    id: 'OPN-005',
    documentNumber: 'OPN-005',
    date: new Date('2026-02-11'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Stock Opname Komprehensif',
  },
  {
    id: 'OPN-006',
    documentNumber: 'OPN-006',
    date: new Date('2026-01-28'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Stock Opname Akhir Januari',
  },
  {
    id: 'OPN-007',
    documentNumber: 'OPN-007',
    date: new Date('2026-01-25'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'PROCESS',
    description: 'Stock Opname Bahan Baku',
  },
];

export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // MOCK DATA FILTERING - Filter by company code
    const filteredData = MOCK_OPNAME_HEADERS.filter(
      (item) => item.companyCode === companyCode
    );

    // Sort by date descending
    filteredData.sort((a, b) => b.date.getTime() - a.date.getTime());

    return NextResponse.json(serializeBigInt(filteredData));
  } catch (error) {
    console.error('[API Error] Failed to fetch stock opname documents:', error);
    return NextResponse.json(
      { message: 'Error fetching stock opname documents' },
      { status: 500 }
    );
  }
}
