import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';
import { logActivity } from '@/lib/log-activity';
import {
  calculateEndStock,
  calculateVariance,
  getItemDetails,
} from '@/lib/stock-opname-helpers';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * GET /api/customs/stock-opname/[id]/items
 * Get all items for a stock opname
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

    // Verify stock opname exists and belongs to company
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

    // Get items
    const items = await prisma.stock_opname_items.findMany({
      where: {
        stock_opname_id: stockOpnameId,
        deleted_at: null,
      },
      orderBy: { created_at: 'desc' },
    });

    return NextResponse.json(serializeBigInt(items));
  } catch (error) {
    console.error('[API Error] Failed to fetch stock opname items:', error);
    return NextResponse.json(
      { message: 'Error fetching stock opname items' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/customs/stock-opname/[id]/items
 * Add item to stock opname
 * Body: { item_code, sto_qty, report_area, remark }
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
    const { item_code, sto_qty, report_area, remark } = body;

    // Validation
    if (!item_code) {
      return NextResponse.json(
        { message: 'Field item_code is required' },
        { status: 400 }
      );
    }

    if (sto_qty === undefined || sto_qty === null) {
      return NextResponse.json(
        { message: 'Field sto_qty is required' },
        { status: 400 }
      );
    }

    const stoQtyDecimal = new Decimal(sto_qty);

    if (stoQtyDecimal.lessThan(0)) {
      return NextResponse.json(
        { message: 'Field sto_qty must be greater than or equal to 0' },
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

    // Get item details from items table
    const itemDetails = await getItemDetails(companyCode, item_code);

    if (!itemDetails) {
      return NextResponse.json(
        { message: `Item with code ${item_code} not found or inactive` },
        { status: 404 }
      );
    }

    // Check for duplicate item in same stock opname
    const existingItem = await prisma.stock_opname_items.findFirst({
      where: {
        stock_opname_id: stockOpnameId,
        item_code: item_code,
        deleted_at: null,
      },
    });

    if (existingItem) {
      return NextResponse.json(
        { message: `Item ${item_code} already exists in this stock opname` },
        { status: 400 }
      );
    }

    // Calculate end stock based on sto_datetime
    const endStock = await calculateEndStock(
      companyCode,
      item_code,
      stockOpname.sto_datetime
    );

    // Calculate variance
    const variance = calculateVariance(stoQtyDecimal, endStock);

    // Create stock opname item
    const item = await prisma.$transaction(async (tx) => {
      // Create item
      const newItem = await tx.stock_opname_items.create({
        data: {
          stock_opname_id: stockOpnameId,
          company_code: companyCode,
          item_code: item_code,
          item_name: itemDetails.item_name,
          item_type: itemDetails.item_type,
          uom: itemDetails.uom,
          sto_qty: stoQtyDecimal,
          end_stock: endStock,
          variant: variance,
          report_area: report_area || null,
          remark: remark || null,
        },
      });

      // Update stock opname status to PROCESS if it's OPEN
      if (stockOpname.status === 'OPEN') {
        await tx.stock_opnames.update({
          where: { id: stockOpnameId },
          data: { status: 'PROCESS' },
        });
      }

      return newItem;
    });

    // Log activity
    await logActivity({
      action: 'ADD_STOCK_OPNAME_ITEM',
      description: `Added item ${item_code} to stock opname ${stockOpname.sto_number}`,
      status: 'success',
      metadata: {
        stock_opname_id: stockOpnameId,
        sto_number: stockOpname.sto_number,
        item_id: item.id,
        item_code: item_code,
        sto_qty: sto_qty,
      },
    });

    return NextResponse.json(serializeBigInt(item), { status: 201 });
  } catch (error) {
    console.error('[API Error] Failed to add stock opname item:', error);

    // Log failed activity
    await logActivity({
      action: 'ADD_STOCK_OPNAME_ITEM',
      description: 'Failed to add stock opname item',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Error adding stock opname item' },
      { status: 500 }
    );
  }
}
