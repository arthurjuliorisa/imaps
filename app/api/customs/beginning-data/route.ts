import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import {
  parseAndNormalizeDate,
  validateDateNotFuture,
  sanitizeRemarks,
  validatePositiveNumber,
  ValidationError,
} from '@/lib/api-utils';

/**
 * GET /api/customs/beginning-data
 * Get beginning balance records with optional filtering by item type
 *
 * Query Parameters:
 * - itemType: Filter by item type (e.g., ROH, FERT, HIBE_M)
 * - itemCode: Filter by item code (partial match, case-insensitive)
 * - itemName: Filter by item name (partial match, case-insensitive)
 * - startDate: Filter by balance date >= startDate
 * - endDate: Filter by balance date <= endDate
 */
export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const { searchParams } = new URL(request.url);
    const itemType = searchParams.get('itemType');
    const itemCode = searchParams.get('itemCode');
    const itemName = searchParams.get('itemName');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');

    const where: any = {};

    // Filter by company code
    if (session.user?.companyCode) {
      where.company_code = session.user.companyCode;
    }

    // Filter by item type
    if (itemType) {
      where.item_type = itemType;
    }

    // Filter by item code
    if (itemCode) {
      where.item_code = {
        contains: itemCode,
        mode: 'insensitive',
      };
    }

    // Filter by item name
    if (itemName) {
      where.item_name = {
        contains: itemName,
        mode: 'insensitive',
      };
    }

    // Filter by date range
    if (startDate || endDate) {
      where.balance_date = {};
      if (startDate) {
        where.balance_date.gte = new Date(startDate);
      }
      if (endDate) {
        where.balance_date.lte = new Date(endDate);
      }
    }

    const beginningBalances = await prisma.beginning_balances.findMany({
      where,
      orderBy: [
        { balance_date: 'desc' },
        { item_code: 'asc' },
      ],
    });

    // Transform data to match frontend expectations
    const transformedData = beginningBalances.map((balance) => ({
      id: balance.id.toString(),
      item: {
        code: balance.item_code,
        name: balance.item_name,
      },
      uom: {
        code: balance.uom,
      },
      beginningBalance: Number(balance.qty),
      beginningDate: balance.balance_date,
      remarks: null,
      itemId: balance.item_code,
      uomId: balance.uom,
      itemType: balance.item_type,
    }));

    return NextResponse.json(transformedData);
  } catch (error) {
    console.error('[API Error] Failed to fetch beginning data:', error);
    console.error('[API Error] Error details:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    return NextResponse.json(
      { message: 'Error fetching beginning data' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customs/beginning-data
 * Create a new beginning balance record
 *
 * Request Body:
 * - itemType: string (required) - Item type code (e.g., ROH, FERT, HIBE_M)
 * - itemCode: string (required) - Item code
 * - itemName: string (required) - Item name
 * - uom: string (required) - Unit of measure
 * - qty: number (required, must be > 0) - Beginning balance quantity
 * - balanceDate: string (required, ISO date format) - Balance date
 * - remarks: string (optional, max 1000 chars)
 */
export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const body = await request.json();
    const { itemType, itemCode, itemName, uom, qty, balanceDate, remarks } = body;

    // Validate required fields
    if (!itemType || !itemCode || !itemName || !uom || qty === undefined || qty === null || !balanceDate) {
      return NextResponse.json(
        {
          message: 'Missing required fields: itemType, itemCode, itemName, uom, qty, and balanceDate are required'
        },
        { status: 400 }
      );
    }

    // Validate item type exists in database
    const itemTypeExists = await prisma.item_types.findUnique({
      where: { item_type_code: itemType },
    });

    if (!itemTypeExists) {
      return NextResponse.json(
        { message: `Invalid item type: ${itemType}. Item type does not exist in the system.` },
        { status: 400 }
      );
    }

    // Validate and normalize date
    let normalizedDate: Date;
    try {
      normalizedDate = parseAndNormalizeDate(balanceDate);
      validateDateNotFuture(normalizedDate);
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message || 'Invalid date' },
        { status: 400 }
      );
    }

    // Validate quantity
    let qtyValue: number;
    try {
      qtyValue = validatePositiveNumber(qty, 'Quantity');
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Sanitize remarks
    let sanitizedRemarks: string | null = null;
    try {
      sanitizedRemarks = sanitizeRemarks(remarks);
    } catch (error: any) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Get company code from session
    const companyCode = session.user?.companyCode;
    if (!companyCode) {
      return NextResponse.json(
        { message: 'Company code not found in session' },
        { status: 400 }
      );
    }

    // Check for duplicate record (same company, item code, and date)
    const existingRecord = await prisma.beginning_balances.findFirst({
      where: {
        company_code: companyCode,
        item_code: itemCode,
        balance_date: normalizedDate,
      },
    });

    if (existingRecord) {
      return NextResponse.json(
        { message: 'A beginning balance record for this item and date already exists' },
        { status: 409 }
      );
    }

    // Create new beginning balance record
    const newRecord = await prisma.beginning_balances.create({
      data: {
        company_code: companyCode,
        item_type: itemType,
        item_code: String(itemCode).trim(),
        item_name: String(itemName).trim(),
        uom: String(uom).trim(),
        qty: qtyValue,
        balance_date: normalizedDate,
      },
    });

    // Transform response
    const transformedRecord = {
      id: newRecord.id.toString(),
      item: {
        code: newRecord.item_code,
        name: newRecord.item_name,
      },
      uom: {
        code: newRecord.uom,
      },
      beginningBalance: Number(newRecord.qty),
      beginningDate: newRecord.balance_date,
      remarks: sanitizedRemarks,
      itemId: newRecord.item_code,
      uomId: newRecord.uom,
      itemType: newRecord.item_type,
    };

    return NextResponse.json(transformedRecord, { status: 201 });
  } catch (error: any) {
    console.error('[API Error] Failed to create beginning balance record:', error);

    // Handle validation errors
    if (error instanceof ValidationError) {
      return NextResponse.json(
        { message: error.message },
        { status: 400 }
      );
    }

    // Handle Prisma errors
    if (error.code === 'P2002') {
      return NextResponse.json(
        { message: 'A beginning balance record with this combination already exists' },
        { status: 409 }
      );
    }

    if (error.code === 'P2003') {
      return NextResponse.json(
        { message: 'Invalid foreign key constraint' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { message: 'Error creating beginning balance record' },
      { status: 500 }
    );
  }
}
