/**
 * Stock Opname Usage Examples
 * Code examples for implementing Stock Opname feature
 */

import { prisma } from '@/lib/prisma';
import {
  generateSTONumber,
  calculateVariant,
  isSTOEditable,
  getSTOStatusColor,
} from '@/lib/stock-opname-utils';
import type {
  CreateStockOpnameRequest,
  UpdateStockOpnameRequest,
  StockOpnameWithItems,
} from '@/types/stock-opname';

// ============================================================================
// Example 1: Create New Stock Opname
// ============================================================================

async function createStockOpname(
  username: string,
  request: CreateStockOpnameRequest
) {
  // Generate STO number
  const stoNumber = await generateSTONumber(new Date(request.sto_datetime));

  // Create STO with items in a transaction
  const stockOpname = await prisma.$transaction(async (tx) => {
    // Create header
    const header = await tx.stock_opnames.create({
      data: {
        sto_number: stoNumber,
        company_code: request.company_code,
        sto_datetime: new Date(request.sto_datetime),
        pic_name: request.pic_name || null,
        status: 'OPEN',
        created_by: username,
      },
    });

    // Create items
    const items = await tx.stock_opname_items.createMany({
      data: request.items.map((item) => ({
        stock_opname_id: header.id,
        company_code: request.company_code,
        item_code: item.item_code,
        item_name: item.item_name,
        item_type: item.item_type,
        uom: item.uom,
        sto_qty: item.sto_qty,
        end_stock: item.end_stock,
        variant: calculateVariant(item.sto_qty, item.end_stock),
        report_area: item.report_area || null,
        remark: item.remark || null,
      })),
    });

    return header;
  });

  return stockOpname;
}

// ============================================================================
// Example 2: Get Stock Opname with Items
// ============================================================================

async function getStockOpnameById(id: number): Promise<StockOpnameWithItems | null> {
  const stockOpname = await prisma.stock_opnames.findUnique({
    where: {
      id,
      deleted_at: null,
    },
    include: {
      company: {
        select: {
          name: true,
        },
      },
      items: {
        where: {
          deleted_at: null,
        },
        orderBy: {
          item_code: 'asc',
        },
      },
    },
  });

  if (!stockOpname) return null;

  return {
    ...stockOpname,
    company_name: stockOpname.company.name,
  };
}

// ============================================================================
// Example 3: List Stock Opnames with Filters
// ============================================================================

async function listStockOpnames(params: {
  companyCode: number;
  status?: string[];
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const {
    companyCode,
    status,
    dateFrom,
    dateTo,
    search,
    page = 1,
    pageSize = 10,
  } = params;

  const where = {
    company_code: companyCode,
    deleted_at: null,
    ...(status && status.length > 0 && {
      status: {
        in: status,
      },
    }),
    ...(dateFrom &&
      dateTo && {
        sto_datetime: {
          gte: dateFrom,
          lte: dateTo,
        },
      }),
    ...(search && {
      OR: [
        { sto_number: { contains: search, mode: 'insensitive' as const } },
        { pic_name: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [data, total] = await Promise.all([
    prisma.stock_opnames.findMany({
      where,
      include: {
        company: {
          select: {
            name: true,
          },
        },
        _count: {
          select: {
            items: {
              where: {
                deleted_at: null,
              },
            },
          },
        },
      },
      orderBy: {
        sto_datetime: 'desc',
      },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.stock_opnames.count({ where }),
  ]);

  return {
    data: data.map((sto) => ({
      ...sto,
      company_name: sto.company.name,
      total_items: sto._count.items,
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  };
}

// ============================================================================
// Example 4: Update Stock Opname
// ============================================================================

async function updateStockOpname(
  id: number,
  request: UpdateStockOpnameRequest
) {
  // Check if STO exists and is editable
  const existing = await prisma.stock_opnames.findUnique({
    where: { id, deleted_at: null },
  });

  if (!existing) {
    throw new Error('Stock Opname not found');
  }

  if (!isSTOEditable(existing.status)) {
    throw new Error(
      `Cannot edit Stock Opname with status ${existing.status}. Only OPEN and PROCESS status can be edited.`
    );
  }

  // Update in transaction
  const updated = await prisma.$transaction(async (tx) => {
    // Update header
    const header = await tx.stock_opnames.update({
      where: { id },
      data: {
        ...(request.sto_datetime && {
          sto_datetime: new Date(request.sto_datetime),
        }),
        ...(request.pic_name !== undefined && {
          pic_name: request.pic_name || null,
        }),
        ...(request.status && { status: request.status }),
      },
    });

    // Update items if provided
    if (request.items) {
      // Delete removed items (soft delete)
      const itemsToDelete = request.items
        .filter((item) => item.deleted && item.id)
        .map((item) => item.id!);

      if (itemsToDelete.length > 0) {
        await tx.stock_opname_items.updateMany({
          where: {
            id: { in: itemsToDelete },
          },
          data: {
            deleted_at: new Date(),
          },
        });
      }

      // Update existing items
      const itemsToUpdate = request.items.filter(
        (item) => !item.deleted && item.id
      );

      for (const item of itemsToUpdate) {
        await tx.stock_opname_items.update({
          where: { id: item.id! },
          data: {
            sto_qty: item.sto_qty,
            end_stock: item.end_stock,
            variant: calculateVariant(item.sto_qty, item.end_stock),
            report_area: item.report_area || null,
            remark: item.remark || null,
          },
        });
      }

      // Create new items
      const itemsToCreate = request.items.filter(
        (item) => !item.deleted && !item.id
      );

      if (itemsToCreate.length > 0) {
        await tx.stock_opname_items.createMany({
          data: itemsToCreate.map((item) => ({
            stock_opname_id: id,
            company_code: existing.company_code,
            item_code: item.item_code,
            item_name: item.item_name,
            item_type: item.item_type,
            uom: item.uom,
            sto_qty: item.sto_qty,
            end_stock: item.end_stock,
            variant: calculateVariant(item.sto_qty, item.end_stock),
            report_area: item.report_area || null,
            remark: item.remark || null,
          })),
        });
      }
    }

    return header;
  });

  return updated;
}

// ============================================================================
// Example 5: Change Stock Opname Status
// ============================================================================

async function changeStockOpnameStatus(
  id: number,
  newStatus: 'OPEN' | 'PROCESS' | 'RELEASED',
  username: string
) {
  const existing = await prisma.stock_opnames.findUnique({
    where: { id, deleted_at: null },
  });

  if (!existing) {
    throw new Error('Stock Opname not found');
  }

  // Validate status transition
  const validTransitions: Record<string, string[]> = {
    OPEN: ['PROCESS'],
    PROCESS: ['RELEASED'],
    RELEASED: [], // Cannot transition from RELEASED
  };

  if (!validTransitions[existing.status].includes(newStatus)) {
    throw new Error(
      `Invalid status transition: ${existing.status} → ${newStatus}`
    );
  }

  // Update status
  const updated = await prisma.stock_opnames.update({
    where: { id },
    data: {
      status: newStatus,
    },
  });

  // TODO: Log status change in audit_logs
  // await prisma.audit_logs.create({
  //   data: {
  //     table_name: 'stock_opnames',
  //     record_id: id,
  //     action: 'STATUS_CHANGE',
  //     old_values: { status: existing.status },
  //     new_values: { status: newStatus },
  //     changed_by: username,
  //   },
  // });

  return updated;
}

// ============================================================================
// Example 6: Delete Stock Opname (Soft Delete)
// ============================================================================

async function deleteStockOpname(id: number, username: string) {
  const existing = await prisma.stock_opnames.findUnique({
    where: { id, deleted_at: null },
  });

  if (!existing) {
    throw new Error('Stock Opname not found');
  }

  // Only allow deleting OPEN status
  if (existing.status !== 'OPEN') {
    throw new Error(
      `Cannot delete Stock Opname with status ${existing.status}. Only OPEN status can be deleted.`
    );
  }

  // Soft delete in transaction
  await prisma.$transaction(async (tx) => {
    // Soft delete items
    await tx.stock_opname_items.updateMany({
      where: {
        stock_opname_id: id,
        deleted_at: null,
      },
      data: {
        deleted_at: new Date(),
      },
    });

    // Soft delete header
    await tx.stock_opnames.update({
      where: { id },
      data: {
        deleted_at: new Date(),
      },
    });
  });

  return { success: true };
}

// ============================================================================
// Example 7: Get Stock Opname Statistics
// ============================================================================

async function getStockOpnameStatistics(stoId: number) {
  const items = await prisma.stock_opname_items.findMany({
    where: {
      stock_opname_id: stoId,
      deleted_at: null,
    },
  });

  const totalItems = items.length;
  const itemsWithSurplus = items.filter((item) => Number(item.variant) > 0).length;
  const itemsWithShortage = items.filter((item) => Number(item.variant) < 0).length;
  const itemsExactMatch = items.filter((item) => Number(item.variant) === 0).length;

  const totalSurplusQty = items
    .filter((item) => Number(item.variant) > 0)
    .reduce((sum, item) => sum + Number(item.variant), 0);

  const totalShortageQty = items
    .filter((item) => Number(item.variant) < 0)
    .reduce((sum, item) => sum + Math.abs(Number(item.variant)), 0);

  const accuracyPercentage =
    totalItems > 0 ? (itemsExactMatch / totalItems) * 100 : 100;

  return {
    total_items: totalItems,
    items_with_surplus: itemsWithSurplus,
    items_with_shortage: itemsWithShortage,
    items_exact_match: itemsExactMatch,
    total_surplus_qty: totalSurplusQty,
    total_shortage_qty: totalShortageQty,
    accuracy_percentage: Math.round(accuracyPercentage * 100) / 100,
  };
}

// ============================================================================
// Example 8: Find Items with Variance
// ============================================================================

async function findItemsWithVariance(
  stoId: number,
  varianceType?: 'surplus' | 'shortage'
) {
  const where = {
    stock_opname_id: stoId,
    deleted_at: null,
    variant: varianceType
      ? varianceType === 'surplus'
        ? { gt: 0 }
        : { lt: 0 }
      : { not: 0 },
  };

  const items = await prisma.stock_opname_items.findMany({
    where,
    orderBy: {
      variant: varianceType === 'shortage' ? 'asc' : 'desc',
    },
  });

  return items;
}

// ============================================================================
// Export Examples
// ============================================================================

export {
  createStockOpname,
  getStockOpnameById,
  listStockOpnames,
  updateStockOpname,
  changeStockOpnameStatus,
  deleteStockOpname,
  getStockOpnameStatistics,
  findItemsWithVariance,
};
