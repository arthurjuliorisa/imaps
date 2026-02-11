import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

// MOCK DATA - Replace with actual database queries when ready
const MOCK_ADJUSTMENT_HEADERS = [
  {
    id: 'ADJ-001',
    documentNumber: 'ADJ-001',
    date: new Date('2026-02-02'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Adjustment Hasil Opname Januari',
  },
  {
    id: 'ADJ-002',
    documentNumber: 'ADJ-002',
    date: new Date('2026-02-06'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'PROCESS',
    description: 'Adjustment Barang Rusak',
  },
  {
    id: 'ADJ-003',
    documentNumber: 'ADJ-003',
    date: new Date('2026-02-09'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Adjustment Gudang A',
  },
  {
    id: 'ADJ-004',
    documentNumber: 'ADJ-004',
    date: new Date('2026-02-10'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'PROCESS',
    description: 'Adjustment Stock Expired',
  },
  {
    id: 'ADJ-005',
    documentNumber: 'ADJ-005',
    date: new Date('2026-02-11'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Adjustment Penyesuaian Sistem',
  },
  {
    id: 'ADJ-006',
    documentNumber: 'ADJ-006',
    date: new Date('2026-01-29'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Adjustment Akhir Bulan',
  },
  {
    id: 'ADJ-007',
    documentNumber: 'ADJ-007',
    date: new Date('2026-01-26'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'PROCESS',
    description: 'Adjustment Kehilangan Barang',
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
    const filteredData = MOCK_ADJUSTMENT_HEADERS.filter(
      (item) => item.companyCode === companyCode
    );

    // Sort by date descending
    filteredData.sort((a, b) => b.date.getTime() - a.date.getTime());

    return NextResponse.json(serializeBigInt(filteredData));
  } catch (error) {
    console.error('[API Error] Failed to fetch adjustment documents:', error);
    return NextResponse.json(
      { message: 'Error fetching adjustment documents' },
      { status: 500 }
    );
  }
}
