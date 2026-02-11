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
    id: 'int-out-1',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-OUT-001',
    date: new Date('2024-01-16'),
    typeCode: 'FGD',
    itemCode: 'ITM-101',
    itemName: 'Finished Product A',
    unit: 'PCS',
    qty: 400,
    currency: 'USD',
    amount: 6000,
  },
  {
    id: 'int-out-2',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-OUT-002',
    date: new Date('2024-01-22'),
    typeCode: 'RMT',
    itemCode: 'ITM-102',
    itemName: 'Excess Material B',
    unit: 'KG',
    qty: 150,
    currency: 'USD',
    amount: 1500,
  },
  {
    id: 'int-out-3',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-OUT-003',
    date: new Date('2024-02-08'),
    typeCode: 'FGD',
    itemCode: 'ITM-103',
    itemName: 'Product C',
    unit: 'SET',
    qty: 200,
    currency: 'USD',
    amount: 4000,
  },
  {
    id: 'int-out-4',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-OUT-004',
    date: new Date('2024-02-14'),
    typeCode: 'PKG',
    itemCode: 'ITM-104',
    itemName: 'Packaging D',
    unit: 'KG',
    qty: 300,
    currency: 'USD',
    amount: 900,
  },
  {
    id: 'int-out-5',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-OUT-005',
    date: new Date('2024-02-19'),
    typeCode: 'FGD',
    itemCode: 'ITM-105',
    itemName: 'Finished Goods E',
    unit: 'PCS',
    qty: 600,
    currency: 'USD',
    amount: 9000,
  },
  {
    id: 'int-out-6',
    companyCode: 2,
    companyName: 'PT Sample Manufacturing',
    documentNumber: 'INT-OUT-006',
    date: new Date('2024-02-21'),
    typeCode: 'RMT',
    itemCode: 'ITM-106',
    itemName: 'Material F',
    unit: 'LTR',
    qty: 800,
    currency: 'USD',
    amount: 3200,
  },
  {
    id: 'int-out-7',
    companyCode: 2,
    companyName: 'PT Sample Manufacturing',
    documentNumber: 'INT-OUT-007',
    date: new Date('2024-02-26'),
    typeCode: 'FGD',
    itemCode: 'ITM-107',
    itemName: 'Product G',
    unit: 'PCS',
    qty: 450,
    currency: 'USD',
    amount: 6750,
  },
  {
    id: 'int-out-8',
    companyCode: 1,
    companyName: 'PT Example Indonesia',
    documentNumber: 'INT-OUT-008',
    date: new Date('2024-02-28'),
    typeCode: 'FGD',
    itemCode: 'ITM-108',
    itemName: 'Product H',
    unit: 'SET',
    qty: 350,
    currency: 'USD',
    amount: 5250,
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
      '[API Error] Failed to fetch internal transaction outgoing:',
      error
    );
    return NextResponse.json(
      { message: 'Error fetching internal transaction outgoing data' },
      { status: 500 }
    );
  }
}
