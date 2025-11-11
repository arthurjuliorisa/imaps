import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/dashboard/metrics
 * Returns real-time dashboard metrics from database
 *
 * Metrics include:
 * - Total counts for master data (Items, Customers, Suppliers, Users)
 * - Total mutation counts (Scrap, Raw Materials, Production, Capital Goods)
 * - Recent document counts (Incoming and Outgoing in last 30 days)
 */
export async function GET(request: Request) {
  try {
    // Calculate date 30 days ago for recent document filtering
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Use Promise.all to execute all counts in parallel for better performance
    const [
      totalItems,
      totalScrap,
      totalRawMaterials,
      totalProduction,
      totalCapitalGoods,
      totalCustomers,
      totalSuppliers,
      totalUsers,
      incomingDocuments,
      outgoingDocuments,
    ] = await Promise.all([
      // Master data counts
      prisma.item.count(),

      // Mutation counts
      prisma.scrapMutation.count(),
      prisma.rawMaterialMutation.count(),
      prisma.productionMutation.count(),
      prisma.capitalGoodsMutation.count(),

      // Business partner counts
      prisma.customer.count(),
      prisma.supplier.count(),

      // User count
      prisma.user.count(),

      // Recent document counts (last 30 days)
      prisma.incomingDocument.count({
        where: {
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
      }),
      prisma.outgoingDocument.count({
        where: {
          createdAt: {
            gte: thirtyDaysAgo,
          },
        },
      }),
    ]);

    // Return metrics in the specified format
    const metrics = {
      totalItems,
      totalScrap,
      totalRawMaterials,
      totalProduction,
      totalCapitalGoods,
      totalCustomers,
      totalSuppliers,
      totalUsers,
      incomingDocuments,
      outgoingDocuments,
    };

    return NextResponse.json(metrics);
  } catch (error) {
    console.error('[API Error] Failed to fetch dashboard metrics:', error);
    return NextResponse.json(
      { message: 'Error fetching dashboard metrics' },
      { status: 500 }
    );
  }
}
