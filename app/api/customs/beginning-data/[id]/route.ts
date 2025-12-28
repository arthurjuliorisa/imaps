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
 * GET /api/customs/beginning-data/[id]
 * Get a single beginning balance record by ID
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { id } = await context.params;

    // Parse ID as integer
    const recordId = parseInt(id, 10);
    if (isNaN(recordId)) {
      return NextResponse.json(
        { message: 'Invalid ID format' },
        { status: 400 }
      );
    }

    const beginningBalance = await prisma.beginning_balances.findUnique({
      where: { id: recordId },
      include: {
        ppkeks: {
          select: {
            ppkek_number: true
          }
        }
      }
    });

    if (!beginningBalance) {
      return NextResponse.json(
        { message: 'Beginning balance record not found' },
        { status: 404 }
      );
    }

    // Transform response
    const transformedRecord = {
      id: beginningBalance.id.toString(),
      item: {
        code: beginningBalance.item_code,
        name: beginningBalance.item_name,
      },
      uom: {
        code: beginningBalance.uom,
      },
      beginningBalance: Number(beginningBalance.qty),
      beginningDate: beginningBalance.balance_date,
      remarks: beginningBalance.remarks || null,
      ppkek_numbers: beginningBalance.ppkeks?.map(p => p.ppkek_number) || [],
      itemId: beginningBalance.item_code,
      uomId: beginningBalance.uom,
      itemType: beginningBalance.item_type,
    };

    return NextResponse.json(transformedRecord);
  } catch (error) {
    console.error('[API Error] Failed to fetch beginning balance record:', error);
    return NextResponse.json(
      { message: 'Error fetching beginning balance record' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/customs/beginning-data/[id]
 * Update a beginning balance record
 *
 * Request Body:
 * - itemType: string (required) - Item type code
 * - itemCode: string (required) - Item code
 * - itemName: string (required) - Item name
 * - uom: string (required) - Unit of measure
 * - qty: number (required, must be > 0) - Beginning balance quantity
 * - balanceDate: string (required, ISO date format) - Balance date
 * - remarks: string (optional, max 1000 chars)
 */
export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const { id } = await context.params;
    const body = await request.json();
    const { itemType, itemCode, itemName, uom, qty, balanceDate, remarks } = body;

    // Parse ID as integer
    const recordId = parseInt(id, 10);
    if (isNaN(recordId)) {
      return NextResponse.json(
        { message: 'Invalid ID format' },
        { status: 400 }
      );
    }

    // Check if record exists
    const existing = await prisma.beginning_balances.findUnique({
      where: { id: recordId },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Beginning balance record not found' },
        { status: 404 }
      );
    }

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

    // Check for duplicate if item code or date changed
    if (itemCode !== existing.item_code || normalizedDate.getTime() !== existing.balance_date.getTime()) {
      const duplicate = await prisma.beginning_balances.findFirst({
        where: {
          company_code: companyCode,
          item_code: itemCode,
          balance_date: normalizedDate,
          id: { not: recordId },
        },
      });

      if (duplicate) {
        return NextResponse.json(
          { message: 'A beginning balance record for this item and date already exists' },
          { status: 409 }
        );
      }
    }

    // Update the beginning balance record
    const updated = await prisma.beginning_balances.update({
      where: { id: recordId },
      data: {
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
      id: updated.id.toString(),
      item: {
        code: updated.item_code,
        name: updated.item_name,
      },
      uom: {
        code: updated.uom,
      },
      beginningBalance: Number(updated.qty),
      beginningDate: updated.balance_date,
      remarks: sanitizedRemarks,
      itemId: updated.item_code,
      uomId: updated.uom,
      itemType: updated.item_type,
    };

    return NextResponse.json(transformedRecord);
  } catch (error: any) {
    console.error('[API Error] Failed to update beginning balance record:', error);

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

    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Beginning balance record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error updating beginning balance record' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/beginning-data/[id]
 * Delete a beginning balance record
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { id } = await context.params;

    // Parse ID as integer
    const recordId = parseInt(id, 10);
    if (isNaN(recordId)) {
      return NextResponse.json(
        { message: 'Invalid ID format' },
        { status: 400 }
      );
    }

    // Check if record exists
    const existing = await prisma.beginning_balances.findUnique({
      where: { id: recordId },
    });

    if (!existing) {
      return NextResponse.json(
        { message: 'Beginning balance record not found' },
        { status: 404 }
      );
    }

    // Delete the record
    await prisma.beginning_balances.delete({
      where: { id: recordId },
    });

    return NextResponse.json({
      message: 'Beginning balance record deleted successfully',
    });
  } catch (error: any) {
    console.error('[API Error] Failed to delete beginning balance record:', error);

    if (error.code === 'P2025') {
      return NextResponse.json(
        { message: 'Beginning balance record not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { message: 'Error deleting beginning balance record' },
      { status: 500 }
    );
  }
}
