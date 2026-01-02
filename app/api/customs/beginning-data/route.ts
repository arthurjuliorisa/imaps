import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { logActivity } from '@/lib/log-activity';
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

    // Validate company code with detailed error messages
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const where: any = {
      company_code: companyCode
    };

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
      include: {
        ppkeks: {
          select: {
            ppkek_number: true
          }
        }
      },
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
      remarks: balance.remarks || null,
      ppkek_numbers: balance.ppkeks?.map(p => p.ppkek_number) || [],
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
 * - remarks: string (optional, max 1000 chars) - Additional remarks
 * - ppkekNumbers: string[] (optional) - Array of PPKEK numbers
 */

function calculatePriority(balanceDate: Date): number {
  const now = new Date();
  const today = new Date(Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    0, 0, 0, 0
  ));

  if (balanceDate < today) {
    return 0; // Backdated balance
  } else if (balanceDate.getTime() === today.getTime()) {
    return -1; // Same-day balance
  }
  return -1; // Default to same-day priority
}

export async function POST(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const body = await request.json();
    const { itemType, itemCode, itemName, uom, qty, balanceDate, remarks, ppkekNumbers } = body;

    // Validate required fields
    if (!itemType || !itemCode || !itemName || !uom || qty === undefined || qty === null || !balanceDate) {
      return NextResponse.json(
        {
          message: 'Missing required fields: itemType, itemCode, itemName, uom, qty, and balanceDate are required'
        },
        { status: 400 }
      );
    }

    // Validate item type exists and is active in database
    const itemTypeExists = await prisma.item_types.findUnique({
      where: { item_type_code: itemType },
    });

    if (!itemTypeExists || !itemTypeExists.is_active) {
      return NextResponse.json(
        { message: `Invalid item type: ${itemType}. Item type does not exist or is not active in the system.` },
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

    // Parse companyCode as integer
    const companyCode = parseInt(session.user?.companyCode);
    if (!companyCode || isNaN(companyCode)) {
      return NextResponse.json(
        { message: 'Invalid company code' },
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
        remarks: sanitizedRemarks,
      },
    });

    // Insert PPKEK numbers if provided
    if (ppkekNumbers && Array.isArray(ppkekNumbers) && ppkekNumbers.length > 0) {
      const ppkekRecords = ppkekNumbers
        .filter((num: string) => num && String(num).trim() !== '')
        .map((ppkekNumber: string) => ({
          beginning_balance_id: newRecord.id,
          ppkek_number: String(ppkekNumber).trim(),
        }));

      if (ppkekRecords.length > 0) {
        await prisma.beginning_balance_ppkeks.createMany({
          data: ppkekRecords,
          skipDuplicates: true,
        });
      }
    }

    // Queue snapshot recalculation for the item on the balance date
    const priority = calculatePriority(normalizedDate);
    
    // Check if queue entry already exists
    const existingQueueEntry = await prisma.snapshot_recalc_queue.findFirst({
      where: {
        company_code: companyCode,
        recalc_date: normalizedDate,
        item_type: null,
        item_code: null,
      },
    });

    if (existingQueueEntry) {
      // Update existing queue entry
      await prisma.snapshot_recalc_queue.update({
        where: { id: existingQueueEntry.id },
        data: {
          status: 'PENDING',
          priority,
          reason: 'Beginning balance updated',
        },
      });
    } else {
      // Create new queue entry
      await prisma.snapshot_recalc_queue.create({
        data: {
          company_code: companyCode,
          item_type: null,
          item_code: null,
          recalc_date: normalizedDate,
          status: 'PENDING',
          priority,
          reason: 'Beginning balance created',
        },
      });
    }

    // Fetch the created record with ppkeks to return complete data
    const recordWithPpkeks = await prisma.beginning_balances.findUnique({
      where: { id: newRecord.id },
      include: {
        ppkeks: {
          select: {
            ppkek_number: true,
          },
        },
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
      remarks: newRecord.remarks || null,
      ppkek_numbers: recordWithPpkeks?.ppkeks?.map(p => p.ppkek_number) || [],
      itemId: newRecord.item_code,
      uomId: newRecord.uom,
      itemType: newRecord.item_type,
    };

    // Log activity
    await logActivity({
      action: 'ADD_BEGINNING_DATA',
      description: `Created beginning balance: ${newRecord.item_name} (${newRecord.item_code}) - ${newRecord.qty} ${newRecord.uom}`,
      status: 'success',
      metadata: {
        recordId: newRecord.id.toString(),
        itemCode: newRecord.item_code,
        itemName: newRecord.item_name,
        itemType: newRecord.item_type,
        qty: newRecord.qty,
        balanceDate: newRecord.balance_date,
        companyCode,
      },
    });

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
