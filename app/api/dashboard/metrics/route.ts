import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/bigint-serializer';

/**
 * GET /api/dashboard/metrics
 * Returns enhanced real-time dashboard metrics from database
 *
 * Metrics include:
 * - Total counts for master data (Companies, Customers, Suppliers, Users)
 * - Total transaction counts (Incoming, Outgoing, Material Usage, Production)
 * - Document counts with month-over-month trends
 * - Transaction value summary by currency
 * - Time period comparisons (this month vs last month)
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Build where clause with company_code filter
    const whereClause: any = {};
    if (session.user.companyCode) {
      whereClause.company_code = session.user.companyCode;
    }

    // Calculate date ranges for trend analysis
    const now = new Date();
    const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

    // Use Promise.all to execute all counts in parallel for better performance
    const [
      totalCompanies,
      totalUsers,
      totalIncoming,
      totalOutgoing,
      totalMaterialUsage,
      totalProduction,
      totalWipBalance,
      totalAdjustments,
      incomingDocumentsThisMonth,
      incomingDocumentsLastMonth,
      outgoingDocumentsThisMonth,
      outgoingDocumentsLastMonth,
      transactionsThisMonth,
      transactionsLastMonth,
      latestSnapshot,
    ] = await Promise.all([
      // Master data counts
      prisma.companies.count(),
      prisma.users.count(),

      // Transaction counts (total all time)
      prisma.incoming_goods.count({ where: whereClause }),
      prisma.outgoing_goods.count({ where: whereClause }),
      prisma.material_usages.count({ where: whereClause }),
      prisma.production_outputs.count({ where: whereClause }),
      prisma.wip_balances.count({ where: whereClause }),
      prisma.adjustments.count({ where: whereClause }),

      // Incoming documents this month
      prisma.incoming_goods.count({
        where: {
          ...whereClause,
          created_at: {
            gte: startOfThisMonth,
          },
        },
      }),

      // Incoming documents last month
      prisma.incoming_goods.count({
        where: {
          ...whereClause,
          created_at: {
            gte: startOfLastMonth,
            lte: endOfLastMonth,
          },
        },
      }),

      // Outgoing documents this month
      prisma.outgoing_goods.count({
        where: {
          ...whereClause,
          created_at: {
            gte: startOfThisMonth,
          },
        },
      }),

      // Outgoing documents last month
      prisma.outgoing_goods.count({
        where: {
          ...whereClause,
          created_at: {
            gte: startOfLastMonth,
            lte: endOfLastMonth,
          },
        },
      }),

      // Total transactions this month (all types)
      Promise.all([
        prisma.incoming_goods.count({
          where: { ...whereClause, created_at: { gte: startOfThisMonth } },
        }),
        prisma.outgoing_goods.count({
          where: { ...whereClause, created_at: { gte: startOfThisMonth } },
        }),
        prisma.material_usages.count({
          where: { ...whereClause, created_at: { gte: startOfThisMonth } },
        }),
        prisma.production_outputs.count({
          where: { ...whereClause, created_at: { gte: startOfThisMonth } },
        }),
      ]).then(counts => counts.reduce((sum, count) => sum + count, 0)),

      // Total transactions last month (all types)
      Promise.all([
        prisma.incoming_goods.count({
          where: { ...whereClause, created_at: { gte: startOfLastMonth, lte: endOfLastMonth } },
        }),
        prisma.outgoing_goods.count({
          where: { ...whereClause, created_at: { gte: startOfLastMonth, lte: endOfLastMonth } },
        }),
        prisma.material_usages.count({
          where: { ...whereClause, created_at: { gte: startOfLastMonth, lte: endOfLastMonth } },
        }),
        prisma.production_outputs.count({
          where: { ...whereClause, created_at: { gte: startOfLastMonth, lte: endOfLastMonth } },
        }),
      ]).then(counts => counts.reduce((sum, count) => sum + count, 0)),

      // Get latest stock snapshot data - DISABLED: stock_daily_snapshot table removed
      Promise.resolve(null),
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
    const transactionsTrend = calculateTrend(transactionsThisMonth, transactionsLastMonth);
    const incomingTrend = calculateTrend(incomingDocumentsThisMonth, incomingDocumentsLastMonth);
    const outgoingTrend = calculateTrend(outgoingDocumentsThisMonth, outgoingDocumentsLastMonth);

    // Get transaction value summary by currency from incoming_headers and outgoing_headers
    const transactionValues = await prisma.$queryRaw<Array<{ currencyCode: string; totalIncoming: bigint; totalOutgoing: bigint }>>`
      SELECT
        currency as "currencyCode",
        COALESCE(SUM(total_amount), 0) as "totalIncoming",
        0 as "totalOutgoing"
      FROM incoming_headers
      GROUP BY currency
      UNION ALL
      SELECT
        currency as "currencyCode",
        0 as "totalIncoming",
        COALESCE(SUM(total_amount), 0) as "totalOutgoing"
      FROM outgoing_headers
      GROUP BY currency
    `;

    // Aggregate transaction values by currency
    const currencyMap = new Map<string, { incoming: number; outgoing: number }>();
    transactionValues.forEach(tv => {
      const existing = currencyMap.get(tv.currencyCode) || { incoming: 0, outgoing: 0 };
      existing.incoming += Number(tv.totalIncoming);
      existing.outgoing += Number(tv.totalOutgoing);
      currencyMap.set(tv.currencyCode, existing);
    });

    const transactionValueSummary = Array.from(currencyMap.entries()).map(([currency, values]) => ({
      currency,
      incoming: values.incoming,
      outgoing: values.outgoing,
      net: values.incoming - values.outgoing,
    }));

    // Return enhanced metrics
    const metrics = {
      // Master data
      totalCompanies,
      totalCustomers: 0, // No customer table in schema
      totalSuppliers: 0, // No supplier table in schema
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

      // Transactions with trends
      transactions: {
        total: transactionsThisMonth,
        thisMonth: transactionsThisMonth,
        lastMonth: transactionsLastMonth,
        trend: transactionsTrend,
        breakdown: {
          incoming: totalIncoming,
          outgoing: totalOutgoing,
          materialUsage: totalMaterialUsage,
          production: totalProduction,
          wipBalance: totalWipBalance,
          adjustments: totalAdjustments,
        },
      },

      // Transaction values by currency
      transactionValues: transactionValueSummary,

      // Latest snapshot info
      latestSnapshotDate: latestSnapshot?.snapshot_date?.toISOString() || null,

      // Legacy fields (for backward compatibility)
      totalItems: totalCompanies, // Using companies as item proxy
      activeItems: 0, // Deprecated - use StockDailySnapshot instead
      totalScrap: 0, // Deprecated - scrap is now part of adjustments
      totalRawMaterials: totalMaterialUsage,
      totalProduction: totalProduction,
      totalCapitalGoods: 0, // Deprecated - capital goods in incoming/outgoing
      incomingDocuments: incomingDocumentsThisMonth,
      outgoingDocuments: outgoingDocumentsThisMonth,
      totalReports: transactionsThisMonth,
    };

    return NextResponse.json(serializeBigInt(metrics));
  } catch (error) {
    console.error('[API Error] Failed to fetch dashboard metrics:', error);
    return NextResponse.json(
      { message: 'Error fetching dashboard metrics', error: String(error) },
      { status: 500 }
    );
  }
}
