import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * GET /api/dashboard/metrics
 * Returns enhanced real-time dashboard metrics from database
 *
 * Metrics include:
 * - Total counts for master data (Items, Customers, Suppliers, Users)
 * - Total mutation counts (Scrap, Raw Materials, Production, Capital Goods)
 * - Document counts with month-over-month trends
 * - Transaction value summary by currency
 * - Active items count
 * - Time period comparisons (this month vs last month)
 */
export async function GET(request: Request) {
  try {
    // Calculate date ranges for trend analysis
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Use Promise.all to execute all counts in parallel for better performance
    const [
      totalItems,
      activeItems,
      totalScrap,
      totalRawMaterials,
      totalProduction,
      totalCapitalGoods,
      totalCustomers,
      totalSuppliers,
      totalUsers,
      incomingDocumentsThisMonth,
      incomingDocumentsLastMonth,
      outgoingDocumentsThisMonth,
      outgoingDocumentsLastMonth,
      mutationsThisMonth,
      mutationsLastMonth,
      transactionValues,
    ] = await Promise.all([
      // Master data counts
      prisma.item.count(),

      // Active items (items that have mutations or transactions)
      prisma.item.count({
        where: {
          OR: [
            { rawMaterialMutations: { some: {} } },
            { productionMutations: { some: {} } },
            { capitalGoodsMutations: { some: {} } },
            { incomingDocuments: { some: {} } },
            { outgoingDocuments: { some: {} } },
          ],
        },
      }),

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

      // Incoming documents this month
      prisma.incomingDocument.count({
        where: {
          createdAt: {
            gte: startOfThisMonth,
          },
        },
      }),

      // Incoming documents last month
      prisma.incomingDocument.count({
        where: {
          createdAt: {
            gte: startOfLastMonth,
            lte: endOfLastMonth,
          },
        },
      }),

      // Outgoing documents this month
      prisma.outgoingDocument.count({
        where: {
          createdAt: {
            gte: startOfThisMonth,
          },
        },
      }),

      // Outgoing documents last month
      prisma.outgoingDocument.count({
        where: {
          createdAt: {
            gte: startOfLastMonth,
            lte: endOfLastMonth,
          },
        },
      }),

      // Total mutations this month (all types)
      Promise.all([
        prisma.scrapMutation.count({
          where: { createdAt: { gte: startOfThisMonth } },
        }),
        prisma.rawMaterialMutation.count({
          where: { createdAt: { gte: startOfThisMonth } },
        }),
        prisma.productionMutation.count({
          where: { createdAt: { gte: startOfThisMonth } },
        }),
        prisma.capitalGoodsMutation.count({
          where: { createdAt: { gte: startOfThisMonth } },
        }),
      ]).then(counts => counts.reduce((sum, count) => sum + count, 0)),

      // Total mutations last month (all types)
      Promise.all([
        prisma.scrapMutation.count({
          where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
        }),
        prisma.rawMaterialMutation.count({
          where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
        }),
        prisma.productionMutation.count({
          where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
        }),
        prisma.capitalGoodsMutation.count({
          where: { createdAt: { gte: startOfLastMonth, lte: endOfLastMonth } },
        }),
      ]).then(counts => counts.reduce((sum, count) => sum + count, 0)),

      // Transaction values by currency
      prisma.$queryRaw<Array<{ currencyCode: string; totalIncoming: number; totalOutgoing: number }>>`
        SELECT
          c.code as "currencyCode",
          COALESCE(SUM(CASE WHEN i.id IS NOT NULL THEN i.amount ELSE 0 END), 0) as "totalIncoming",
          COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN o.amount ELSE 0 END), 0) as "totalOutgoing"
        FROM "Currency" c
        LEFT JOIN "IncomingDocument" i ON i."currencyId" = c.id
        LEFT JOIN "OutgoingDocument" o ON o."currencyId" = c.id
        GROUP BY c.code
        HAVING SUM(COALESCE(i.amount, 0)) > 0 OR SUM(COALESCE(o.amount, 0)) > 0
      `,
    ]);

    // Calculate total documents
    const totalDocumentsThisMonth = incomingDocumentsThisMonth + outgoingDocumentsThisMonth;
    const totalDocumentsLastMonth = incomingDocumentsLastMonth + outgoingDocumentsLastMonth;

    // Calculate trends (percentage change)
    const calculateTrend = (current: number, previous: number) => {
      if (previous === 0) return current > 0 ? 100 : 0;
      return Number((((current - previous) / previous) * 100).toFixed(1));
    };

    const documentsTrend = calculateTrend(totalDocumentsThisMonth, totalDocumentsLastMonth);
    const mutationsTrend = calculateTrend(mutationsThisMonth, mutationsLastMonth);
    const incomingTrend = calculateTrend(incomingDocumentsThisMonth, incomingDocumentsLastMonth);
    const outgoingTrend = calculateTrend(outgoingDocumentsThisMonth, outgoingDocumentsLastMonth);

    // Format transaction values summary
    const transactionValueSummary = transactionValues.map(tv => ({
      currency: tv.currencyCode,
      incoming: Number(tv.totalIncoming),
      outgoing: Number(tv.totalOutgoing),
      net: Number(tv.totalIncoming) - Number(tv.totalOutgoing),
    }));

    // Return enhanced metrics
    const metrics = {
      // Master data
      totalItems,
      activeItems,
      totalCustomers,
      totalSuppliers,
      totalUsers,

      // Documents with trends
      documents: {
        total: totalDocumentsThisMonth,
        thisMonth: totalDocumentsThisMonth,
        lastMonth: totalDocumentsLastMonth,
        trend: documentsTrend,
        incoming: {
          total: incomingDocumentsThisMonth,
          trend: incomingTrend,
        },
        outgoing: {
          total: outgoingDocumentsThisMonth,
          trend: outgoingTrend,
        },
      },

      // Mutations with trends
      mutations: {
        total: mutationsThisMonth,
        thisMonth: mutationsThisMonth,
        lastMonth: mutationsLastMonth,
        trend: mutationsTrend,
        breakdown: {
          scrap: totalScrap,
          rawMaterials: totalRawMaterials,
          production: totalProduction,
          capitalGoods: totalCapitalGoods,
        },
      },

      // Transaction values by currency
      transactionValues: transactionValueSummary,

      // Legacy fields (for backward compatibility)
      totalScrap,
      totalRawMaterials,
      totalProduction,
      totalCapitalGoods,
      incomingDocuments: incomingDocumentsThisMonth,
      outgoingDocuments: outgoingDocumentsThisMonth,
      totalReports: totalScrap + totalRawMaterials + totalProduction + totalCapitalGoods,
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
