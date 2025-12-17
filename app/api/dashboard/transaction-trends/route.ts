import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/**
 * Transaction trend data for chart visualization
 */
interface TransactionTrend {
  month: string;
  monthLabel: string;
  incomingCount: number;
  outgoingCount: number;
  incomingQuantity: number;
  outgoingQuantity: number;
}

/**
 * GET /api/dashboard/transaction-trends
 * Returns transaction trends for the last 12 months
 *
 * Note: Amount data is not available in current schema
 * Returns:
 * - Monthly incoming/outgoing document volume
 * - Document count and total quantity per month
 * - Data formatted for chart visualization
 */
export async function GET(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Calculate date range for last 12 months
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // Build where clause with company_code filter
    const whereClause: any = {
      incoming_date: {
        gte: twelveMonthsAgo,
      },
    };
    if (session.user.companyCode) {
      whereClause.company_code = session.user.companyCode;
    }

    // Fetch incoming headers for last 12 months
    const incomingHeaders = await prisma.incoming_goods.findMany({
      where: whereClause,
      select: {
        id: true,
        incoming_date: true,
      },
    });

    // Fetch outgoing headers for last 12 months
    const outgoingWhereClause: any = {
      outgoing_date: {
        gte: twelveMonthsAgo,
      },
    };
    if (session.user.companyCode) {
      outgoingWhereClause.company_code = session.user.companyCode;
    }

    const outgoingHeaders = await prisma.outgoing_goods.findMany({
      where: outgoingWhereClause,
      select: {
        id: true,
        outgoing_date: true,
      },
    });

    // Manually fetch items since relations are not available
    const incomingHeaderIds = incomingHeaders.map(h => h.id);
    const incomingItems = await prisma.incoming_good_items.findMany({
      where: {
        incoming_good_id: { in: incomingHeaderIds }
      },
      select: {
        incoming_good_id: true,
        qty: true,
      },
    });

    const outgoingHeaderIds = outgoingHeaders.map(h => h.id);
    const outgoingItems = await prisma.outgoing_good_items.findMany({
      where: {
        outgoing_good_id: { in: outgoingHeaderIds }
      },
      select: {
        outgoing_good_id: true,
        qty: true,
      },
    });

    // Map items to headers
    const incomingItemsByHeaderId = new Map<number, typeof incomingItems>();
    incomingItems.forEach(item => {
      const existing = incomingItemsByHeaderId.get(item.incoming_good_id) || [];
      existing.push(item);
      incomingItemsByHeaderId.set(item.incoming_good_id, existing);
    });

    const outgoingItemsByHeaderId = new Map<number, typeof outgoingItems>();
    outgoingItems.forEach(item => {
      const existing = outgoingItemsByHeaderId.get(item.outgoing_good_id) || [];
      existing.push(item);
      outgoingItemsByHeaderId.set(item.outgoing_good_id, existing);
    });

    // Initialize trends array for last 12 months
    const trends: TransactionTrend[] = [];
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Generate data for each of the last 12 months
    for (let i = 11; i >= 0; i--) {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const year = monthDate.getFullYear();
      const month = monthDate.getMonth();
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      const monthLabel = `${monthNames[month]} ${year}`;

      // Filter documents for this month
      const incomingForMonth = incomingHeaders.filter(doc => {
        const docDate = new Date(doc.incoming_date);
        return docDate.getFullYear() === year && docDate.getMonth() === month;
      });

      const outgoingForMonth = outgoingHeaders.filter(doc => {
        const docDate = new Date(doc.outgoing_date);
        return docDate.getFullYear() === year && docDate.getMonth() === month;
      });

      // Calculate aggregates
      const incomingCount = incomingForMonth.length;
      const outgoingCount = outgoingForMonth.length;

      // Sum quantities from details
      const incomingQuantity = incomingForMonth.reduce((sum, doc) => {
        const items = incomingItemsByHeaderId.get(doc.id) || [];
        const docQty = items.reduce((detailSum, detail) => detailSum + Number(detail.qty), 0);
        return sum + docQty;
      }, 0);

      const outgoingQuantity = outgoingForMonth.reduce((sum, doc) => {
        const items = outgoingItemsByHeaderId.get(doc.id) || [];
        const docQty = items.reduce((detailSum, detail) => detailSum + Number(detail.qty), 0);
        return sum + docQty;
      }, 0);

      trends.push({
        month: monthKey,
        monthLabel,
        incomingCount,
        outgoingCount,
        incomingQuantity: Number(incomingQuantity.toFixed(2)),
        outgoingQuantity: Number(outgoingQuantity.toFixed(2)),
      });
    }

    // Calculate summary statistics
    const totalIncomingCount = trends.reduce((sum, t) => sum + t.incomingCount, 0);
    const totalOutgoingCount = trends.reduce((sum, t) => sum + t.outgoingCount, 0);
    const totalIncomingQuantity = trends.reduce((sum, t) => sum + t.incomingQuantity, 0);
    const totalOutgoingQuantity = trends.reduce((sum, t) => sum + t.outgoingQuantity, 0);

    return NextResponse.json({
      trends,
      summary: {
        totalIncomingCount,
        totalOutgoingCount,
        totalIncomingQuantity: Number(totalIncomingQuantity.toFixed(2)),
        totalOutgoingQuantity: Number(totalOutgoingQuantity.toFixed(2)),
        netQuantity: Number((totalIncomingQuantity - totalOutgoingQuantity).toFixed(2)),
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch transaction trends:', error);
    return NextResponse.json(
      { message: 'Error fetching transaction trends', error: String(error) },
      { status: 500 }
    );
  }
}
