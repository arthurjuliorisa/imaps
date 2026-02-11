import { NextResponse } from 'next/server';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { validateCompanyCode } from '@/lib/company-validation';

// TEMPORARY: Using mock data until database tables are created by other team members
interface InternalTransactionData {
  id: string;
  companyCode: number;
  companyName: string;
  documentNumber: string;
  date: Date;
  typeCode: string;
  itemCode: string;
  itemName: string;
  unit: string;
  qty: number;
  currency: string;
  amount: number;
}

// Mock data for testing - will be replaced with actual database queries
const MOCK_DATA: InternalTransactionData[] = [
  {
    id: 'int-in-1',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-IN-001',
    date: new Date('2024-01-15'),
    typeCode: 'RMT',
    itemCode: 'ITM-001',
    itemName: 'Raw Material A',
    unit: 'KG',
    qty: 1000,
    currency: 'USD',
    amount: 5000,
  },
  {
    id: 'int-in-2',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-IN-002',
    date: new Date('2024-01-20'),
    typeCode: 'FGD',
    itemCode: 'ITM-002',
    itemName: 'Finished Goods B',
    unit: 'PCS',
    qty: 500,
    currency: 'USD',
    amount: 7500,
  },
  {
    id: 'int-in-3',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-IN-003',
    date: new Date('2024-02-05'),
    typeCode: 'RMT',
    itemCode: 'ITM-003',
    itemName: 'Component C',
    unit: 'SET',
    qty: 250,
    currency: 'USD',
    amount: 3750,
  },
  {
    id: 'int-in-4',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-IN-004',
    date: new Date('2024-02-12'),
    typeCode: 'PKG',
    itemCode: 'ITM-004',
    itemName: 'Packaging Material D',
    unit: 'KG',
    qty: 800,
    currency: 'USD',
    amount: 2400,
  },
  {
    id: 'int-in-5',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-IN-005',
    date: new Date('2024-02-18'),
    typeCode: 'RMT',
    itemCode: 'ITM-005',
    itemName: 'Raw Material E',
    unit: 'LTR',
    qty: 1500,
    currency: 'USD',
    amount: 6000,
  },
  {
    id: 'int-in-6',
    companyCode: 2,
    companyName: 'PT Sample Manufacturing',
    documentNumber: 'INT-IN-006',
    date: new Date('2024-02-20'),
    typeCode: 'FGD',
    itemCode: 'ITM-006',
    itemName: 'Product F',
    unit: 'PCS',
    qty: 300,
    currency: 'USD',
    amount: 4500,
  },
  {
    id: 'int-in-7',
    companyCode: 2,
    companyName: 'PT Sample Manufacturing',
    documentNumber: 'INT-IN-007',
    date: new Date('2024-02-25'),
    typeCode: 'RMT',
    itemCode: 'ITM-007',
    itemName: 'Material G',
    unit: 'KG',
    qty: 2000,
    currency: 'USD',
    amount: 8000,
  },
];

export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    // TEMPORARY: Filter mock data by company code
    let filteredData = MOCK_DATA.filter(
      (item) => item.companyCode === companyCode
    );

    // Apply date range filtering if provided
    if (startDate || endDate) {
      filteredData = filteredData.filter((item) => {
        const itemDate = new Date(item.date);
        const start = startDate ? new Date(startDate) : null;
        const end = endDate ? new Date(endDate) : null;

        if (start && end) {
          return itemDate >= start && itemDate <= end;
        } else if (start) {
          return itemDate >= start;
        } else if (end) {
          return itemDate <= end;
        }
        return true;
      });
    }

    // Transform to match expected format (similar to actual API response structure)
    const transformedData = filteredData.map((item) => ({
      id: item.id,
      companyCode: item.companyCode,
      companyName: item.companyName,
      documentNumber: item.documentNumber,
      date: item.date,
      typeCode: item.typeCode,
      itemCode: item.itemCode,
      itemName: item.itemName,
      unit: item.unit,
      qty: item.qty,
      currency: item.currency,
      amount: item.amount,
    }));

    return NextResponse.json(serializeBigInt(transformedData));
  } catch (error) {
    console.error(
      '[API Error] Failed to fetch internal transaction incoming:',
      error
    );
    return NextResponse.json(
      { message: 'Error fetching internal transaction incoming data' },
      { status: 500 }
    );
  }
}
