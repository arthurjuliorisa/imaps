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
        { message: 'ID stock opname tidak valid' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { message: 'Tidak ada item yang disediakan' },
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
        { message: 'Stock opname tidak ditemukan' },
        { status: 404 }
      );
    }

    // Check if status allows editing
    if (stockOpname.status === 'RELEASED') {
      return NextResponse.json(
        { message: 'Tidak dapat menambah item ke stock opname yang sudah dirilis' },
        { status: 400 }
      );
    }

    const createdItems = [];
    const errors = [];

    // Get all item codes for batch fetch
    const itemCodes = items.map((item: any) => item.item_code);

    // Batch fetch item master data
    const itemsFromMaster = await prisma.items.findMany({
      where: {
        company_code: companyCode,
        item_code: { in: itemCodes },
        deleted_at: null,
        is_active: true,
      },
      select: {
        item_code: true,
        item_name: true,
        item_type: true,
        uom: true,
      },
    });

    const itemsMap = new Map(
      itemsFromMaster.map(item => [item.item_code, item])
    );

    // Check for existing items (including soft-deleted ones)
    const existingItems = await prisma.stock_opname_items.findMany({
      where: {
        stock_opname_id: stockOpnameId,
        item_code: { in: itemCodes },
      },
      select: {
        id: true,
        item_code: true,
        deleted_at: true,
      },
    });

    const existingItemsMap = new Map(
      existingItems.map(item => [item.item_code, item])
    );

    for (const item of items) {
      try {
        const itemMaster = itemsMap.get(item.item_code);

        if (!itemMaster) {
          errors.push(`Baris ${item.row}: Kode item ${item.item_code} tidak ditemukan`);
          continue;
        }

        // Calculate end stock and variance
        const endStock = await calculateEndStock(
          companyCode,
          item.item_code,
          stockOpname.sto_datetime
        );
        const variance = calculateVariance(item.sto_qty, endStock);

        const existingItem = existingItemsMap.get(item.item_code);

        // If item exists and is deleted, undelete and update it
        if (existingItem && existingItem.deleted_at !== null) {
          const updatedItem = await prisma.stock_opname_items.update({
            where: { id: existingItem.id },
            data: {
              item_name: itemMaster.item_name,
              item_type: itemMaster.item_type,
              uom: itemMaster.uom,
              sto_qty: item.sto_qty,
              end_stock: endStock,
              variant: variance,
              report_area: item.report_area || null,
              remark: item.remark || null,
              deleted_at: null, // Undelete
            },
          });
          createdItems.push(updatedItem);
        }
        // If item exists and is not deleted, skip (validation should have caught this)
        else if (existingItem && existingItem.deleted_at === null) {
          errors.push(`Baris ${item.row}: Item sudah ada dalam stock opname ini`);
          continue;
        }
        // If item doesn't exist, create new
        else {
          const createdItem = await prisma.stock_opname_items.create({
            data: {
              stock_opname_id: stockOpnameId,
              company_code: companyCode,
              item_code: itemMaster.item_code,
              item_name: itemMaster.item_name,
              item_type: itemMaster.item_type,
              uom: itemMaster.uom,
              sto_qty: item.sto_qty,
              end_stock: endStock,
              variant: variance,
              report_area: item.report_area || null,
              remark: item.remark || null,
            },
          });
          createdItems.push(createdItem);
        }
      } catch (error) {
        console.error(`Error creating item ${item.item_code}:`, error);
        errors.push(`Baris ${item.row}: ${error instanceof Error ? error.message : 'Gagal membuat item'}`);
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
      description: `Berhasil menambahkan ${createdItems.length} item ke stock opname: ${stockOpname.sto_number}`,
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
      description: 'Gagal menambahkan item stock opname secara bulk',
      status: 'error',
      metadata: {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });

    return NextResponse.json(
      { message: 'Terjadi kesalahan saat membuat item' },
      { status: 500 }
    );
  }
}
