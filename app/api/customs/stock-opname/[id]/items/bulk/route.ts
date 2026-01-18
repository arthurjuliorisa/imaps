import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { logActivity } from '@/lib/log-activity';
import { calculateEndStock, calculateVariance } from '@/lib/stock-opname-helpers';

/**
 * POST /api/customs/stock-opname/[id]/items/bulk
 * Bulk insert items from validated Excel upload
 */
export async function POST(
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
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { message: 'No items provided' },
        { status: 400 }
      );
    }

    // Get stock opname
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

    // Check if status allows editing
    if (stockOpname.status === 'RELEASED') {
      return NextResponse.json(
        { message: 'Cannot add items to released stock opname' },
        { status: 400 }
      );
    }

    const createdItems = [];
    const errors = [];

    for (const item of items) {
      try {
        // Get item master data
        const itemMaster = await prisma.lpj_mutasi_items.findFirst({
          where: {
            company_code: companyCode,
            item_code: item.item_code,
          },
          select: {
            item_code: true,
            item_name: true,
            item_type_code: true,
            uom: true,
          },
        });

        if (!itemMaster) {
          errors.push(`Row ${item.row}: Item code ${item.item_code} not found`);
          continue;
        }

        // Calculate end stock and variance
        const endStock = await calculateEndStock(item.item_code, stockOpname.sto_datetime);
        const variance = calculateVariance(item.sto_qty, endStock);

        // Create item
        const createdItem = await prisma.stock_opname_items.create({
          data: {
            stock_opname_id: stockOpnameId,
            item_code: itemMaster.item_code,
            item_name: itemMaster.item_name,
            item_type_code: itemMaster.item_type_code,
            uom: itemMaster.uom,
            sto_qty: item.sto_qty,
            end_stock: endStock,
            variance: variance,
            report_area: item.report_area || null,
            sto_pic_name: item.sto_pic_name || null,
            remark: item.remark || null,
          },
        });

        createdItems.push(createdItem);
      } catch (error) {
        console.error(`Error creating item ${item.item_code}:`, error);
        errors.push(`Row ${item.row}: ${error instanceof Error ? error.message : 'Failed to create item'}`);
      }
    }

    // Auto-change status to PROCESS if this is the first item
    if (stockOpname.status === 'OPEN' && createdItems.length > 0) {
      await prisma.stock_opnames.update({
        where: { id: stockOpnameId },
        data: { status: 'PROCESS' },
      });
    }

    // Log activity
    await logActivity({
      action: 'BULK_ADD_STOCK_OPNAME_ITEMS',
      description: `Bulk added ${createdItems.length} items to stock opname: ${stockOpname.sto_number}`,
      status: 'success',
      metadata: {
        stock_opname_id: stockOpnameId,
        sto_number: stockOpname.sto_number,
        items_added: createdItems.length,
        errors: errors.length,
      },
    });

    return NextResponse.json(
      serializeBigInt({
        success: createdItems.length,
        errors: errors,
        items: createdItems,
      })
    );
  } catch (error) {
    console.error('[API Error] Failed to bulk create items:', error);

    await logActivity({
      action: 'BULK_ADD_STOCK_OPNAME_ITEMS',
      description: 'Failed to bulk add stock opname items',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Error creating items' },
      { status: 500 }
    );
  }
}
