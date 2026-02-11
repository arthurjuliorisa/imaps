import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

// MOCK DATA - Replace with actual database queries when ready
const MOCK_ADJUSTMENT_HEADERS = {
  'ADJ-001': {
    id: 'ADJ-001',
    documentNumber: 'ADJ-001',
    date: new Date('2026-02-02'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Adjustment Hasil Opname Januari',
  },
  'ADJ-002': {
    id: 'ADJ-002',
    documentNumber: 'ADJ-002',
    date: new Date('2026-02-06'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'PROCESS',
    description: 'Adjustment Barang Rusak',
  },
  'ADJ-003': {
    id: 'ADJ-003',
    documentNumber: 'ADJ-003',
    date: new Date('2026-02-09'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Adjustment Gudang A',
  },
};

const MOCK_ADJUSTMENT_DETAILS = {
  'ADJ-001': [
    {
      id: 'ADJ-D001-1',
      itemType: 'RMT',
      itemCode: 'RMT-001',
      itemName: 'Raw Material A',
      unit: 'KG',
      beforeQty: 1000,
      afterQty: 985,
      adjustmentQty: -15,
    },
    {
      id: 'ADJ-D001-2',
      itemType: 'RMT',
      itemCode: 'RMT-002',
      itemName: 'Raw Material B',
      unit: 'KG',
      beforeQty: 500,
      afterQty: 510,
      adjustmentQty: 10,
    },
    {
      id: 'ADJ-D001-3',
      itemType: 'FGD',
      itemCode: 'FGD-001',
      itemName: 'Finished Good Product X',
      unit: 'PCS',
      beforeQty: 2000,
      afterQty: 2000,
      adjustmentQty: 0,
    },
    {
      id: 'ADJ-D001-4',
      itemType: 'FGD',
      itemCode: 'FGD-002',
      itemName: 'Finished Good Product Y',
      unit: 'PCS',
      beforeQty: 1500,
      afterQty: 1480,
      adjustmentQty: -20,
    },
    {
      id: 'ADJ-D001-5',
      itemType: 'PKG',
      itemCode: 'PKG-001',
      itemName: 'Packaging Box Large',
      unit: 'PCS',
      beforeQty: 5000,
      afterQty: 5050,
      adjustmentQty: 50,
    },
    {
      id: 'ADJ-D001-6',
      itemType: 'PKG',
      itemCode: 'PKG-002',
      itemName: 'Packaging Box Small',
      unit: 'PCS',
      beforeQty: 3000,
      afterQty: 2990,
      adjustmentQty: -10,
    },
    {
      id: 'ADJ-D001-7',
      itemType: 'WIP',
      itemCode: 'WIP-001',
      itemName: 'Work in Progress Item A',
      unit: 'KG',
      beforeQty: 750,
      afterQty: 750,
      adjustmentQty: 0,
    },
    {
      id: 'ADJ-D001-8',
      itemType: 'WIP',
      itemCode: 'WIP-002',
      itemName: 'Work in Progress Item B',
      unit: 'KG',
      beforeQty: 250,
      afterQty: 245,
      adjustmentQty: -5,
    },
  ],
  'ADJ-002': [
    {
      id: 'ADJ-D002-1',
      itemType: 'RMT',
      itemCode: 'RMT-003',
      itemName: 'Raw Material C',
      unit: 'LITER',
      beforeQty: 800,
      afterQty: 795,
      adjustmentQty: -5,
    },
    {
      id: 'ADJ-D002-2',
      itemType: 'RMT',
      itemCode: 'RMT-004',
      itemName: 'Raw Material D',
      unit: 'KG',
      beforeQty: 1200,
      afterQty: 1205,
      adjustmentQty: 5,
    },
    {
      id: 'ADJ-D002-3',
      itemType: 'FGD',
      itemCode: 'FGD-003',
      itemName: 'Finished Good Product Z',
      unit: 'PCS',
      beforeQty: 3000,
      afterQty: 2985,
      adjustmentQty: -15,
    },
    {
      id: 'ADJ-D002-4',
      itemType: 'PKG',
      itemCode: 'PKG-003',
      itemName: 'Packaging Plastic Roll',
      unit: 'ROLL',
      beforeQty: 200,
      afterQty: 200,
      adjustmentQty: 0,
    },
    {
      id: 'ADJ-D002-5',
      itemType: 'PKG',
      itemCode: 'PKG-004',
      itemName: 'Packaging Label',
      unit: 'PCS',
      beforeQty: 10000,
      afterQty: 9950,
      adjustmentQty: -50,
    },
    {
      id: 'ADJ-D002-6',
      itemType: 'WIP',
      itemCode: 'WIP-003',
      itemName: 'Semi Finished Product A',
      unit: 'KG',
      beforeQty: 600,
      afterQty: 610,
      adjustmentQty: 10,
    },
    {
      id: 'ADJ-D002-7',
      itemType: 'SPA',
      itemCode: 'SPA-001',
      itemName: 'Spare Part Machine A',
      unit: 'PCS',
      beforeQty: 50,
      afterQty: 48,
      adjustmentQty: -2,
    },
    {
      id: 'ADJ-D002-8',
      itemType: 'SPA',
      itemCode: 'SPA-002',
      itemName: 'Spare Part Machine B',
      unit: 'PCS',
      beforeQty: 30,
      afterQty: 30,
      adjustmentQty: 0,
    },
    {
      id: 'ADJ-D002-9',
      itemType: 'RMT',
      itemCode: 'RMT-005',
      itemName: 'Raw Material E',
      unit: 'KG',
      beforeQty: 450,
      afterQty: 455,
      adjustmentQty: 5,
    },
    {
      id: 'ADJ-D002-10',
      itemType: 'FGD',
      itemCode: 'FGD-004',
      itemName: 'Finished Good Premium',
      unit: 'PCS',
      beforeQty: 1800,
      afterQty: 1800,
      adjustmentQty: 0,
    },
  ],
  'ADJ-003': [
    {
      id: 'ADJ-D003-1',
      itemType: 'RMT',
      itemCode: 'RMT-006',
      itemName: 'Chemical Component A',
      unit: 'LITER',
      beforeQty: 300,
      afterQty: 298,
      adjustmentQty: -2,
    },
    {
      id: 'ADJ-D003-2',
      itemType: 'RMT',
      itemCode: 'RMT-007',
      itemName: 'Chemical Component B',
      unit: 'LITER',
      beforeQty: 400,
      afterQty: 405,
      adjustmentQty: 5,
    },
    {
      id: 'ADJ-D003-3',
      itemType: 'FGD',
      itemCode: 'FGD-005',
      itemName: 'Export Product A',
      unit: 'PCS',
      beforeQty: 5000,
      afterQty: 4990,
      adjustmentQty: -10,
    },
    {
      id: 'ADJ-D003-4',
      itemType: 'FGD',
      itemCode: 'FGD-006',
      itemName: 'Export Product B',
      unit: 'PCS',
      beforeQty: 3500,
      afterQty: 3500,
      adjustmentQty: 0,
    },
    {
      id: 'ADJ-D003-5',
      itemType: 'PKG',
      itemCode: 'PKG-005',
      itemName: 'Export Carton Box',
      unit: 'PCS',
      beforeQty: 2000,
      afterQty: 2020,
      adjustmentQty: 20,
    },
    {
      id: 'ADJ-D003-6',
      itemType: 'PKG',
      itemCode: 'PKG-006',
      itemName: 'Pallet Wood',
      unit: 'PCS',
      beforeQty: 150,
      afterQty: 148,
      adjustmentQty: -2,
    },
    {
      id: 'ADJ-D003-7',
      itemType: 'WIP',
      itemCode: 'WIP-004',
      itemName: 'Assembly Product Stage 1',
      unit: 'PCS',
      beforeQty: 800,
      afterQty: 805,
      adjustmentQty: 5,
    },
    {
      id: 'ADJ-D003-8',
      itemType: 'WIP',
      itemCode: 'WIP-005',
      itemName: 'Assembly Product Stage 2',
      unit: 'PCS',
      beforeQty: 600,
      afterQty: 595,
      adjustmentQty: -5,
    },
  ],
};

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
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const itemType = searchParams.get('itemType');

    // Validate company code
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // MOCK DATA - Find header by ID
    const header = MOCK_ADJUSTMENT_HEADERS[id as keyof typeof MOCK_ADJUSTMENT_HEADERS];

    if (!header) {
      return NextResponse.json(
        { message: 'Adjustment document not found' },
        { status: 404 }
      );
    }

    // Check if document belongs to user's company
    if (header.companyCode !== companyCode) {
      return NextResponse.json(
        { message: 'Unauthorized to access this document' },
        { status: 403 }
      );
    }

    // Get detail items
    let details = MOCK_ADJUSTMENT_DETAILS[id as keyof typeof MOCK_ADJUSTMENT_DETAILS] || [];

    // Filter by itemType if provided
    if (itemType) {
      details = details.filter((detail) => detail.itemType === itemType);
    }

    const response = {
      header,
      details,
    };

    return NextResponse.json(serializeBigInt(response));
  } catch (error) {
    console.error('[API Error] Failed to fetch adjustment detail:', error);
    return NextResponse.json(
      { message: 'Error fetching adjustment detail' },
      { status: 500 }
    );
  }
}
