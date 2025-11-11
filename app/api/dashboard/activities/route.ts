import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/**
 * Activity interface for unified response format
 */
interface Activity {
  id: string;
  type: 'incoming' | 'outgoing' | 'scrap' | 'raw-material' | 'production' | 'capital-goods';
  description: string;
  timestamp: Date;
  user: string;
}

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
          item: {
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
      activities.push({
        id: doc.id,
        type: 'incoming',
        description: `Incoming: ${doc.docNumber} - ${doc.shipper.name} - ${doc.quantity} ${doc.uom.code} ${doc.item.name}`,
        timestamp: doc.createdAt,
        user: 'System',
      });
    });

    // Add outgoing document activities
    recentOutgoing.forEach((doc) => {
      activities.push({
        id: doc.id,
        type: 'outgoing',
        description: `Outgoing: ${doc.docNumber} - ${doc.recipient.name} - ${doc.quantity} ${doc.uom.code} ${doc.item.name}`,
        timestamp: doc.createdAt,
        user: 'System',
      });
    });

    // Add scrap mutation activities
    recentScrap.forEach((mutation) => {
      const action = mutation.incoming > 0 ? 'Incoming' : mutation.outgoing > 0 ? 'Outgoing' : 'Adjustment';
      const amount = mutation.incoming > 0 ? mutation.incoming : mutation.outgoing > 0 ? mutation.outgoing : mutation.adjustment;
      activities.push({
        id: mutation.id,
        type: 'scrap',
        description: `Scrap ${action}: ${mutation.item.code} - ${amount} ${mutation.uom.code}`,
        timestamp: mutation.createdAt,
        user: 'System',
      });
    });

    // Add raw material mutation activities
    recentRawMaterial.forEach((mutation) => {
      const action = mutation.incoming > 0 ? 'Incoming' : mutation.outgoing > 0 ? 'Outgoing' : 'Adjustment';
      const amount = mutation.incoming > 0 ? mutation.incoming : mutation.outgoing > 0 ? mutation.outgoing : mutation.adjustment;
      activities.push({
        id: mutation.id,
        type: 'raw-material',
        description: `Raw Material ${action}: ${mutation.item.code} - ${amount} ${mutation.uom.code}`,
        timestamp: mutation.createdAt,
        user: 'System',
      });
    });

    // Sort all activities by timestamp (most recent first) and take top 20
    const sortedActivities = activities
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
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
