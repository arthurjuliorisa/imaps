import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { logActivity } from '@/lib/log-activity';
import {
  calculateEndStock,
  calculateVariance,
} from '@/lib/stock-opname-helpers';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * PUT /api/customs/stock-opname/[id]/items/[itemId]
 * Update existing item (sto_qty, report_area, remark)
 * Recalculate variance
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
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

    const { id, itemId } = await params;
    const stockOpnameId = parseInt(id);
    const stockOpnameItemId = parseInt(itemId);

    if (isNaN(stockOpnameId) || isNaN(stockOpnameItemId)) {
      return NextResponse.json(
        { message: 'Invalid stock opname ID or item ID' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { sto_qty, report_area, remark } = body;

    // Get stock opname header
    const stockOpname = await prisma.stock_opnames.findFirst({
      where: {
        id: stockOpnameId,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!stockOpname) {
      return NextResponse.json(
        { message: 'Stock opname not found' },
        { status: 404 }
      );
    }

    // Get current item
    const currentItem = await prisma.stock_opname_items.findFirst({
      where: {
        id: stockOpnameItemId,
        stock_opname_id: stockOpnameId,
        deleted_at: null,
      },
    });

    if (!currentItem) {
      return NextResponse.json(
        { message: 'Stock opname item not found' },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: any = {};

    // Update sto_qty if provided
    if (sto_qty !== undefined && sto_qty !== null) {
      const stoQtyDecimal = new Decimal(sto_qty);

      if (stoQtyDecimal.lessThan(0)) {
        return NextResponse.json(
          { message: 'Field sto_qty must be greater than or equal to 0' },
          { status: 400 }
        );
      }

      updateData.sto_qty = stoQtyDecimal;

      // Recalculate variance with new sto_qty
      const variance = calculateVariance(stoQtyDecimal, currentItem.end_stock);
      updateData.variant = variance;
    }

    // Update report_area if provided
    if (report_area !== undefined) {
      updateData.report_area = report_area || null;
    }

    // Update remark if provided
    if (remark !== undefined) {
      updateData.remark = remark || null;
    }

    // Update item
    const updatedItem = await prisma.stock_opname_items.update({
      where: { id: stockOpnameItemId },
      data: updateData,
    });

    // Log activity
    await logActivity({
      action: 'UPDATE_STOCK_OPNAME_ITEM',
      description: `Updated item ${currentItem.item_code} in stock opname ${stockOpname.sto_number}`,
      status: 'success',
      metadata: {
        stock_opname_id: stockOpnameId,
        sto_number: stockOpname.sto_number,
        item_id: stockOpnameItemId,
        item_code: currentItem.item_code,
        changes: updateData,
      },
    });

    return NextResponse.json(serializeBigInt(updatedItem));
  } catch (error) {
    console.error('[API Error] Failed to update stock opname item:', error);

    // Log failed activity
    await logActivity({
      action: 'UPDATE_STOCK_OPNAME_ITEM',
      description: 'Failed to update stock opname item',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Error updating stock opname item' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/customs/stock-opname/[id]/items/[itemId]
 * Soft delete item
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; itemId: string }> }
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

    const { id, itemId } = await params;
    const stockOpnameId = parseInt(id);
    const stockOpnameItemId = parseInt(itemId);

    if (isNaN(stockOpnameId) || isNaN(stockOpnameItemId)) {
      return NextResponse.json(
        { message: 'Invalid stock opname ID or item ID' },
        { status: 400 }
      );
    }

    // Get stock opname header
    const stockOpname = await prisma.stock_opnames.findFirst({
      where: {
        id: stockOpnameId,
        company_code: companyCode,
        deleted_at: null,
      },
    });

    if (!stockOpname) {
      return NextResponse.json(
        { message: 'Stock opname not found' },
        { status: 404 }
      );
    }

    // Get current item
    const currentItem = await prisma.stock_opname_items.findFirst({
      where: {
        id: stockOpnameItemId,
        stock_opname_id: stockOpnameId,
        deleted_at: null,
      },
    });

    if (!currentItem) {
      return NextResponse.json(
        { message: 'Stock opname item not found' },
        { status: 404 }
      );
    }

    // Soft delete item
    await prisma.stock_opname_items.update({
      where: { id: stockOpnameItemId },
      data: { deleted_at: new Date() },
    });

    // Log activity
    await logActivity({
      action: 'DELETE_STOCK_OPNAME_ITEM',
      description: `Deleted item ${currentItem.item_code} from stock opname ${stockOpname.sto_number}`,
      status: 'success',
      metadata: {
        stock_opname_id: stockOpnameId,
        sto_number: stockOpname.sto_number,
        item_id: stockOpnameItemId,
        item_code: currentItem.item_code,
      },
    });

    return NextResponse.json({
      message: 'Stock opname item deleted successfully',
    });
  } catch (error) {
    console.error('[API Error] Failed to delete stock opname item:', error);

    // Log failed activity
    await logActivity({
      action: 'DELETE_STOCK_OPNAME_ITEM',
      description: 'Failed to delete stock opname item',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Error deleting stock opname item' },
      { status: 500 }
    );
  }
}
