import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { logActivity } from '@/lib/log-activity';
import { isValidStatusTransition } from '@/lib/stock-opname-helpers';

/**
 * GET /api/customs/stock-opname/[id]
 * Get stock opname header + items details
 */
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
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const { id } = await params;
    const stockOpnameId = parseInt(id);

    if (isNaN(stockOpnameId)) {
      return NextResponse.json(
        { message: 'Invalid stock opname ID' },
        { status: 400 }
      );
    }

    // Get stock opname header
    const header = await prisma.stock_opnames.findFirst({
      where: {
        id: stockOpnameId,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!header) {
      return NextResponse.json(
        { message: 'Stock opname not found' },
        { status: 404 }
      );
    }

    // Get items
    const items = await prisma.stock_opname_items.findMany({
      where: {
        stock_opname_id: stockOpnameId,
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
    });

    // Transform items to match frontend interface
    const transformedItems = items.map((item) => ({
      ...item,
      item_type: item.item_type,
    }));

    return NextResponse.json(
      serializeBigInt({
        stockOpname: header,
        items: transformedItems,
      })
    );
  } catch (error) {
    console.error('[API Error] Failed to fetch stock opname details:', error);
    return NextResponse.json(
      { message: 'Error fetching stock opname details' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/customs/stock-opname/[id]
 * Update stock opname header (sto_date, pic_name, status)
 * Validate status workflow: OPEN -> PROCESS -> RELEASED
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const { id } = await params;
    const stockOpnameId = parseInt(id);

    if (isNaN(stockOpnameId)) {
      return NextResponse.json(
        { message: 'Invalid stock opname ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { sto_date, pic_name, status } = body;

    // Get current stock opname
    const currentStockOpname = await prisma.stock_opnames.findFirst({
      where: {
        id: stockOpnameId,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!currentStockOpname) {
      return NextResponse.json(
        { message: 'Stock opname not found' },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: any = {};

    // Update sto_date if provided
    if (sto_date) {
      const stoDatetime = new Date(sto_date);

      // Validate date is not in the future
      if (stoDatetime > new Date()) {
        return NextResponse.json(
          { message: 'Stock opname date cannot be in the future' },
          { status: 400 }
        );
      }

      updateData.sto_datetime = stoDatetime;
    }

    // Update pic_name if provided
    if (pic_name !== undefined) {
      updateData.pic_name = pic_name || null;
    }

    // Update status if provided
    if (status) {
      // Validate status transition
      if (!isValidStatusTransition(currentStockOpname.status, status)) {
        return NextResponse.json(
          {
            message: `Invalid status transition from ${currentStockOpname.status} to ${status}`,
          },
          { status: 400 }
        );
      }

      updateData.status = status;
    }

    // Update stock opname
    const updatedStockOpname = await prisma.stock_opnames.update({
      where: { id: stockOpnameId },
      data: updateData,
    });

    // Log activity
    await logActivity({
      action: 'UPDATE_STOCK_OPNAME',
      description: `Updated stock opname: ${updatedStockOpname.sto_number}`,
      status: 'success',
      metadata: {
        stock_opname_id: stockOpnameId,
        sto_number: updatedStockOpname.sto_number,
        changes: updateData,
      },
    });

    return NextResponse.json(serializeBigInt(updatedStockOpname));
  } catch (error) {
    console.error('[API Error] Failed to update stock opname:', error);

    // Log failed activity
    await logActivity({
      action: 'UPDATE_STOCK_OPNAME',
      description: 'Failed to update stock opname',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Error updating stock opname' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/stock-opname/[id]
 * Soft delete stock opname (set deleted_at)
 * Only allow if status = 'OPEN'
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }
    const { companyCode } = companyValidation;

    const { id } = await params;
    const stockOpnameId = parseInt(id);

    if (isNaN(stockOpnameId)) {
      return NextResponse.json(
        { message: 'Invalid stock opname ID' },
        { status: 400 }
      );
    }

    // Get current stock opname
    const currentStockOpname = await prisma.stock_opnames.findFirst({
      where: {
        id: stockOpnameId,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!currentStockOpname) {
      return NextResponse.json(
        { message: 'Stock opname not found' },
        { status: 404 }
      );
    }

    // Only allow deletion if status is OPEN
    if (currentStockOpname.status !== 'OPEN') {
      return NextResponse.json(
        {
          message: `Cannot delete stock opname with status ${currentStockOpname.status}. Only OPEN status can be deleted.`,
        },
        { status: 400 }
      );
    }

    // Soft delete stock opname and its items
    await prisma.$transaction([
      prisma.stock_opnames.update({
        where: { id: stockOpnameId },
        data: { deleted_at: new Date() },
      }),
      prisma.stock_opname_items.updateMany({
        where: { stock_opname_id: stockOpnameId },
        data: { deleted_at: new Date() },
      }),
    ]);

    // Log activity
    await logActivity({
      action: 'DELETE_STOCK_OPNAME',
      description: `Deleted stock opname: ${currentStockOpname.sto_number}`,
      status: 'success',
      metadata: {
        stock_opname_id: stockOpnameId,
        sto_number: currentStockOpname.sto_number,
      },
    });

    return NextResponse.json({
      message: 'Stock opname deleted successfully',
    });
  } catch (error) {
    console.error('[API Error] Failed to delete stock opname:', error);

    // Log failed activity
    await logActivity({
      action: 'DELETE_STOCK_OPNAME',
      description: 'Failed to delete stock opname',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Error deleting stock opname' },
      { status: 500 }
    );
  }
}
