import { NextResponse } from 'next/server';
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
  incomingAmount: number;
  outgoingAmount: number;
}

/**
 * GET /api/dashboard/transaction-trends
 * Returns transaction trends for the last 12 months
 *
 * Returns:
 * - Monthly incoming/outgoing document volume
 * - Document count and total quantity per month
 * - Total transaction amounts per month
 * - Data formatted for chart visualization
 */
export async function GET(request: Request) {
  try {
    // Calculate date range for last 12 months
    const now = new Date();
    const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 11, 1);

    // Fetch incoming documents for last 12 months
    const incomingDocuments = await prisma.incomingDocument.findMany({
      where: {
        createdAt: {
          gte: twelveMonthsAgo,
        },
      },
      select: {
        createdAt: true,
        quantity: true,
        amount: true,
      },
    });

    // Fetch outgoing documents for last 12 months
    const outgoingDocuments = await prisma.outgoingDocument.findMany({
      where: {
        createdAt: {
          gte: twelveMonthsAgo,
        },
      },
      select: {
        createdAt: true,
        quantity: true,
        amount: true,
      },
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
      const incomingForMonth = incomingDocuments.filter(doc => {
        const docDate = new Date(doc.createdAt);
        return docDate.getFullYear() === year && docDate.getMonth() === month;
      });

      const outgoingForMonth = outgoingDocuments.filter(doc => {
        const docDate = new Date(doc.createdAt);
        return docDate.getFullYear() === year && docDate.getMonth() === month;
      });

      // Calculate aggregates
      const incomingCount = incomingForMonth.length;
      const outgoingCount = outgoingForMonth.length;
      const incomingQuantity = incomingForMonth.reduce((sum, doc) => sum + doc.quantity, 0);
      const outgoingQuantity = outgoingForMonth.reduce((sum, doc) => sum + doc.quantity, 0);
      const incomingAmount = incomingForMonth.reduce((sum, doc) => sum + doc.amount, 0);
      const outgoingAmount = outgoingForMonth.reduce((sum, doc) => sum + doc.amount, 0);

      trends.push({
        month: monthKey,
        monthLabel,
        incomingCount,
        outgoingCount,
        incomingQuantity: Number(incomingQuantity.toFixed(2)),
        outgoingQuantity: Number(outgoingQuantity.toFixed(2)),
        incomingAmount: Number(incomingAmount.toFixed(2)),
        outgoingAmount: Number(outgoingAmount.toFixed(2)),
      });
    }

    // Calculate summary statistics
    const totalIncomingCount = trends.reduce((sum, t) => sum + t.incomingCount, 0);
    const totalOutgoingCount = trends.reduce((sum, t) => sum + t.outgoingCount, 0);
    const totalIncomingQuantity = trends.reduce((sum, t) => sum + t.incomingQuantity, 0);
    const totalOutgoingQuantity = trends.reduce((sum, t) => sum + t.outgoingQuantity, 0);
    const totalIncomingAmount = trends.reduce((sum, t) => sum + t.incomingAmount, 0);
    const totalOutgoingAmount = trends.reduce((sum, t) => sum + t.outgoingAmount, 0);

    return NextResponse.json({
      trends,
      summary: {
        totalIncomingCount,
        totalOutgoingCount,
        totalIncomingQuantity: Number(totalIncomingQuantity.toFixed(2)),
        totalOutgoingQuantity: Number(totalOutgoingQuantity.toFixed(2)),
        totalIncomingAmount: Number(totalIncomingAmount.toFixed(2)),
        totalOutgoingAmount: Number(totalOutgoingAmount.toFixed(2)),
        netQuantity: Number((totalIncomingQuantity - totalOutgoingQuantity).toFixed(2)),
        netAmount: Number((totalIncomingAmount - totalOutgoingAmount).toFixed(2)),
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch transaction trends:', error);
    return NextResponse.json(
      { message: 'Error fetching transaction trends' },
      { status: 500 }
    );
  }
}
