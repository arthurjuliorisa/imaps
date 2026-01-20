import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { logActivity } from '@/lib/log-activity';
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
 * - ppkekNumbers: string[] (optional) - Array of PPKEK numbers
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
    const { itemType, itemCode, itemName, uom, qty, balanceDate, remarks, ppkekNumbers } = body;

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
    const companyCodeRaw = session.user?.companyCode;
    if (!companyCodeRaw) {
      return NextResponse.json(
        { message: 'Company code not found in session' },
        { status: 400 }
      );
    }

    // Parse company code as integer
    const companyCode = parseInt(companyCodeRaw);
    if (isNaN(companyCode)) {
      return NextResponse.json(
        { message: 'Invalid company code format' },
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
        remarks: sanitizedRemarks,
      },
    });

    // Handle PPKEK numbers
    if (ppkekNumbers && Array.isArray(ppkekNumbers)) {
      // Delete existing PPKEK associations
      await prisma.beginning_balance_ppkeks.deleteMany({
        where: { beginning_balance_id: recordId },
      });

      // Add new PPKEK associations
      if (ppkekNumbers.length > 0) {
        await prisma.beginning_balance_ppkeks.createMany({
          data: ppkekNumbers.map((ppkekNumber: string) => ({
            beginning_balance_id: recordId,
            ppkek_number: String(ppkekNumber).trim(),
          })),
        });
      }
    }

    // Fetch updated record with ppkeks
    const updatedWithPpkeks = await prisma.beginning_balances.findUnique({
      where: { id: recordId },
      include: {
        ppkeks: {
          select: {
            ppkek_number: true
          }
        }
      }
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
      ppkek_numbers: updatedWithPpkeks?.ppkeks?.map(p => p.ppkek_number) || [],
      itemId: updated.item_code,
      uomId: updated.uom,
      itemType: updated.item_type,
    };

    // Log activity
    await logActivity({
      action: 'EDIT_BEGINNING_DATA',
      description: `Updated beginning balance: ${updated.item_name} (${updated.item_code}) - ${updated.qty} ${updated.uom}`,
      status: 'success',
      metadata: {
        recordId: updated.id.toString(),
        itemCode: updated.item_code,
        itemName: updated.item_name,
        itemType: updated.item_type,
        qty: updated.qty,
        balanceDate: updated.balance_date,
        companyCode,
      },
    });

    // Recalculate item-level snapshot for the new date
    try {
      await prisma.$executeRawUnsafe(
        `SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)`,
        companyCode,
        updated.item_type,
        updated.item_code,
        updated.item_name,
        updated.uom,
        normalizedDate
      );
    } catch (snapshotError) {
      console.error('[API Warning] Snapshot calculation failed on update:', {
        companyCode,
        itemType: updated.item_type,
        itemCode: updated.item_code,
        date: normalizedDate.toISOString().split('T')[0],
        error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
      });
    }

    // If date changed, recalculate old date and cascade subsequent dates
    if (normalizedDate.getTime() !== existing.balance_date.getTime()) {
      try {
        // Recalculate old date to update its snapshot
        await prisma.$executeRawUnsafe(
          `SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)`,
          companyCode,
          existing.item_type,
          existing.item_code,
          existing.item_name,
          existing.uom,
          existing.balance_date
        );

        // Cascade recalculate all dates after the new date
        await prisma.$executeRawUnsafe(
          `SELECT recalculate_item_snapshots_from_date($1::int, $2::varchar, $3::varchar, $4::date)`,
          companyCode,
          updated.item_type,
          updated.item_code,
          normalizedDate
        );
      } catch (cascadeError) {
        console.error('[API Warning] Cascade recalculation failed on date change:', {
          companyCode,
          itemType: updated.item_type,
          itemCode: updated.item_code,
          oldDate: existing.balance_date.toISOString().split('T')[0],
          newDate: normalizedDate.toISOString().split('T')[0],
          error: cascadeError instanceof Error ? cascadeError.message : String(cascadeError),
        });
      }
    }

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

    // Log activity
    await logActivity({
      action: 'DELETE_BEGINNING_DATA',
      description: `Deleted beginning balance: ${existing.item_name} (${existing.item_code})`,
      status: 'success',
      metadata: {
        recordId: existing.id.toString(),
        itemCode: existing.item_code,
        itemName: existing.item_name,
        itemType: existing.item_type,
        companyCode: existing.company_code,
      },
    });

    // Recalculate item-level snapshot for the deleted item on that date
    try {
      await prisma.$executeRawUnsafe(
        `SELECT upsert_item_stock_snapshot($1::int, $2::varchar, $3::varchar, $4::varchar, $5::varchar, $6::date)`,
        existing.company_code,
        existing.item_type,
        existing.item_code,
        existing.item_name,
        existing.uom,
        existing.balance_date
      );
    } catch (snapshotError) {
      console.error('[API Warning] Snapshot recalculation failed after delete:', {
        companyCode: existing.company_code,
        itemType: existing.item_type,
        itemCode: existing.item_code,
        date: existing.balance_date.toISOString().split('T')[0],
        error: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
      });
    }

    return NextResponse.json({
      message: 'Beginning balance record deleted successfully. Snapshot recalculation queued for processing.',
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
