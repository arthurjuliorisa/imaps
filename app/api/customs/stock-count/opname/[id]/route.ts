import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

// MOCK DATA - Replace with actual database queries when ready
const MOCK_OPNAME_HEADERS = {
  'OPN-001': {
    id: 'OPN-001',
    documentNumber: 'OPN-001',
    date: new Date('2026-02-01'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Stock Opname Periode Januari 2026',
  },
  'OPN-002': {
    id: 'OPN-002',
    documentNumber: 'OPN-002',
    date: new Date('2026-02-05'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'PROCESS',
    description: 'Stock Opname Gudang A',
  },
  'OPN-003': {
    id: 'OPN-003',
    documentNumber: 'OPN-003',
    date: new Date('2026-02-08'),
    companyCode: 1,
    companyName: 'PT. Example Company',
    status: 'RELEASED',
    description: 'Stock Opname Gudang B',
  },
};

const MOCK_OPNAME_DETAILS = {
  'OPN-001': [
    {
      id: 'D001-1',
      itemType: 'RMT',
      itemCode: 'RMT-001',
      itemName: 'Raw Material A',
      unit: 'KG',
      systemQty: 1000,
      physicalQty: 985,
      difference: -15,
    },
    {
      id: 'D001-2',
      itemType: 'RMT',
      itemCode: 'RMT-002',
      itemName: 'Raw Material B',
      unit: 'KG',
      systemQty: 500,
      physicalQty: 510,
      difference: 10,
    },
    {
      id: 'D001-3',
      itemType: 'FGD',
      itemCode: 'FGD-001',
      itemName: 'Finished Good Product X',
      unit: 'PCS',
      systemQty: 2000,
      physicalQty: 2000,
      difference: 0,
    },
    {
      id: 'D001-4',
      itemType: 'FGD',
      itemCode: 'FGD-002',
      itemName: 'Finished Good Product Y',
      unit: 'PCS',
      systemQty: 1500,
      physicalQty: 1480,
      difference: -20,
    },
    {
      id: 'D001-5',
      itemType: 'PKG',
      itemCode: 'PKG-001',
      itemName: 'Packaging Box Large',
      unit: 'PCS',
      systemQty: 5000,
      physicalQty: 5050,
      difference: 50,
    },
    {
      id: 'D001-6',
      itemType: 'PKG',
      itemCode: 'PKG-002',
      itemName: 'Packaging Box Small',
      unit: 'PCS',
      systemQty: 3000,
      physicalQty: 2990,
      difference: -10,
    },
    {
      id: 'D001-7',
      itemType: 'WIP',
      itemCode: 'WIP-001',
      itemName: 'Work in Progress Item A',
      unit: 'KG',
      systemQty: 750,
      physicalQty: 750,
      difference: 0,
    },
    {
      id: 'D001-8',
      itemType: 'WIP',
      itemCode: 'WIP-002',
      itemName: 'Work in Progress Item B',
      unit: 'KG',
      systemQty: 250,
      physicalQty: 245,
      difference: -5,
    },
  ],
  'OPN-002': [
    {
      id: 'D002-1',
      itemType: 'RMT',
      itemCode: 'RMT-003',
      itemName: 'Raw Material C',
      unit: 'LITER',
      systemQty: 800,
      physicalQty: 795,
      difference: -5,
    },
    {
      id: 'D002-2',
      itemType: 'RMT',
      itemCode: 'RMT-004',
      itemName: 'Raw Material D',
      unit: 'KG',
      systemQty: 1200,
      physicalQty: 1205,
      difference: 5,
    },
    {
      id: 'D002-3',
      itemType: 'FGD',
      itemCode: 'FGD-003',
      itemName: 'Finished Good Product Z',
      unit: 'PCS',
      systemQty: 3000,
      physicalQty: 2985,
      difference: -15,
    },
    {
      id: 'D002-4',
      itemType: 'PKG',
      itemCode: 'PKG-003',
      itemName: 'Packaging Plastic Roll',
      unit: 'ROLL',
      systemQty: 200,
      physicalQty: 200,
      difference: 0,
    },
    {
      id: 'D002-5',
      itemType: 'PKG',
      itemCode: 'PKG-004',
      itemName: 'Packaging Label',
      unit: 'PCS',
      systemQty: 10000,
      physicalQty: 9950,
      difference: -50,
    },
    {
      id: 'D002-6',
      itemType: 'WIP',
      itemCode: 'WIP-003',
      itemName: 'Semi Finished Product A',
      unit: 'KG',
      systemQty: 600,
      physicalQty: 610,
      difference: 10,
    },
    {
      id: 'D002-7',
      itemType: 'SPA',
      itemCode: 'SPA-001',
      itemName: 'Spare Part Machine A',
      unit: 'PCS',
      systemQty: 50,
      physicalQty: 48,
      difference: -2,
    },
    {
      id: 'D002-8',
      itemType: 'SPA',
      itemCode: 'SPA-002',
      itemName: 'Spare Part Machine B',
      unit: 'PCS',
      systemQty: 30,
      physicalQty: 30,
      difference: 0,
    },
    {
      id: 'D002-9',
      itemType: 'RMT',
      itemCode: 'RMT-005',
      itemName: 'Raw Material E',
      unit: 'KG',
      systemQty: 450,
      physicalQty: 455,
      difference: 5,
    },
    {
      id: 'D002-10',
      itemType: 'FGD',
      itemCode: 'FGD-004',
      itemName: 'Finished Good Premium',
      unit: 'PCS',
      systemQty: 1800,
      physicalQty: 1800,
      difference: 0,
    },
  ],
  'OPN-003': [
    {
      id: 'D003-1',
      itemType: 'RMT',
      itemCode: 'RMT-006',
      itemName: 'Chemical Component A',
      unit: 'LITER',
      systemQty: 300,
      physicalQty: 298,
      difference: -2,
    },
    {
      id: 'D003-2',
      itemType: 'RMT',
      itemCode: 'RMT-007',
      itemName: 'Chemical Component B',
      unit: 'LITER',
      systemQty: 400,
      physicalQty: 405,
      difference: 5,
    },
    {
      id: 'D003-3',
      itemType: 'FGD',
      itemCode: 'FGD-005',
      itemName: 'Export Product A',
      unit: 'PCS',
      systemQty: 5000,
      physicalQty: 4990,
      difference: -10,
    },
    {
      id: 'D003-4',
      itemType: 'FGD',
      itemCode: 'FGD-006',
      itemName: 'Export Product B',
      unit: 'PCS',
      systemQty: 3500,
      physicalQty: 3500,
      difference: 0,
    },
    {
      id: 'D003-5',
      itemType: 'PKG',
      itemCode: 'PKG-005',
      itemName: 'Export Carton Box',
      unit: 'PCS',
      systemQty: 2000,
      physicalQty: 2020,
      difference: 20,
    },
    {
      id: 'D003-6',
      itemType: 'PKG',
      itemCode: 'PKG-006',
      itemName: 'Pallet Wood',
      unit: 'PCS',
      systemQty: 150,
      physicalQty: 148,
      difference: -2,
    },
    {
      id: 'D003-7',
      itemType: 'WIP',
      itemCode: 'WIP-004',
      itemName: 'Assembly Product Stage 1',
      unit: 'PCS',
      systemQty: 800,
      physicalQty: 805,
      difference: 5,
    },
    {
      id: 'D003-8',
      itemType: 'WIP',
      itemCode: 'WIP-005',
      itemName: 'Assembly Product Stage 2',
      unit: 'PCS',
      systemQty: 600,
      physicalQty: 595,
      difference: -5,
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
    const header = MOCK_OPNAME_HEADERS[id as keyof typeof MOCK_OPNAME_HEADERS];

    if (!header) {
      return NextResponse.json(
        { message: 'Stock opname document not found' },
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
    let details = MOCK_OPNAME_DETAILS[id as keyof typeof MOCK_OPNAME_DETAILS] || [];

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
    console.error('[API Error] Failed to fetch stock opname detail:', error);
    return NextResponse.json(
      { message: 'Error fetching stock opname detail' },
      { status: 500 }
    );
  }
}
