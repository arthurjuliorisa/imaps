import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

/**
 * Activity interface matching frontend expectations
 */
interface Activity {
  id: string;
  type: 'item' | 'customer' | 'supplier' | 'report';
  title: string;
  description: string;
  time: string;
  timestamp: string;
  color: string;
}

/**
 * Helper functions to map activity types and colors
 */
const getActivityType = (type: string): 'item' | 'customer' | 'supplier' | 'report' => {
  switch (type) {
    case 'incoming':
    case 'outgoing':
      return 'report';
    case 'scrap':
    case 'raw-material':
    case 'production':
    case 'capital-goods':
      return 'item';
    default:
      return 'item';
  }
};

const getActivityColor = (type: string): string => {
  switch (type) {
    case 'incoming':
      return '#10b981';  // green
    case 'outgoing':
      return '#ef4444';  // red
    case 'scrap':
      return '#f59e0b';  // amber
    case 'raw-material':
      return '#3b82f6';  // blue
    case 'production':
      return '#8b5cf6';  // violet
    case 'capital-goods':
      return '#06b6d4';  // cyan
    default:
      return '#6366f1';  // indigo
  }
};

/**
 * GET /api/dashboard/activities
 * Returns recent activity log across all operational tables
 *
 * Fetches the 20 most recent records:
 * - Recent IncomingDocuments (last 5)
 * - Recent OutgoingDocuments (last 5)
 * - Recent ScrapMutations (last 5)
 * - Recent RawMaterialMutations (last 5)
 *
 * Returns unified format with type, description, timestamp, and user
 */
export async function GET(request: Request) {
  try {
    // Fetch recent records from each table in parallel
    const [
      recentIncoming,
      recentOutgoing,
      recentScrap,
      recentRawMaterial,
    ] = await Promise.all([
      // Recent Incoming Documents
      prisma.incomingDocument.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          shipper: {
            select: { name: true },
          },
          item: {
            select: { code: true, name: true },
          },
          uom: {
            select: { code: true },
          },
        },
      }),

      // Recent Outgoing Documents
      prisma.outgoingDocument.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          recipient: {
            select: { name: true },
          },
          item: {
            select: { code: true, name: true },
          },
          uom: {
            select: { code: true },
          },
        },
      }),

      // Recent Scrap Mutations
      prisma.scrapMutation.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          scrap: {
            select: { code: true, name: true },
          },
          uom: {
            select: { code: true },
          },
        },
      }),

      // Recent Raw Material Mutations
      prisma.rawMaterialMutation.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          item: {
            select: { code: true, name: true },
          },
          uom: {
            select: { code: true },
          },
        },
      }),
    ]);

    // Transform to unified activity format
    const activities: Activity[] = [];

    // Add incoming document activities
    recentIncoming.forEach((doc) => {
      const activityType = 'incoming';
      activities.push({
        id: doc.id,
        type: getActivityType(activityType),
        title: `Document ${doc.docNumber}`,
        description: `Incoming: ${doc.docNumber} - ${doc.shipper.name} - ${doc.quantity} ${doc.uom.code} ${doc.item.name}`,
        time: dayjs(doc.createdAt).fromNow(),
        timestamp: doc.createdAt.toISOString(),
        color: getActivityColor(activityType),
      });
    });

    // Add outgoing document activities
    recentOutgoing.forEach((doc) => {
      const activityType = 'outgoing';
      activities.push({
        id: doc.id,
        type: getActivityType(activityType),
        title: `Document ${doc.docNumber}`,
        description: `Outgoing: ${doc.docNumber} - ${doc.recipient.name} - ${doc.quantity} ${doc.uom.code} ${doc.item.name}`,
        time: dayjs(doc.createdAt).fromNow(),
        timestamp: doc.createdAt.toISOString(),
        color: getActivityColor(activityType),
      });
    });

    // Add scrap mutation activities
    recentScrap.forEach((mutation) => {
      const activityType = 'scrap';
      activities.push({
        id: mutation.id,
        type: getActivityType(activityType),
        title: `Scrap ${mutation.scrap.code}`,
        description: `Scrap Incoming: ${mutation.scrap.code} - ${mutation.incoming} ${mutation.uom.code}`,
        time: dayjs(mutation.createdAt).fromNow(),
        timestamp: mutation.createdAt.toISOString(),
        color: getActivityColor(activityType),
      });
    });

    // Add raw material mutation activities
    recentRawMaterial.forEach((mutation) => {
      const action = mutation.incoming > 0 ? 'Incoming' : mutation.outgoing > 0 ? 'Outgoing' : 'Adjustment';
      const amount = mutation.incoming > 0 ? mutation.incoming : mutation.outgoing > 0 ? mutation.outgoing : mutation.adjustment;
      const activityType = 'raw-material';
      activities.push({
        id: mutation.id,
        type: getActivityType(activityType),
        title: `Raw Material ${mutation.item.code}`,
        description: `Raw Material ${action}: ${mutation.item.code} - ${amount} ${mutation.uom.code}`,
        time: dayjs(mutation.createdAt).fromNow(),
        timestamp: mutation.createdAt.toISOString(),
        color: getActivityColor(activityType),
      });
    });

    // Sort all activities by timestamp (most recent first) and take top 20
    const sortedActivities = activities
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 20);

    return NextResponse.json({
      activities: sortedActivities,
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch dashboard activities:', error);
    return NextResponse.json(
      { message: 'Error fetching dashboard activities' },
      { status: 500 }
    );
  }
}
