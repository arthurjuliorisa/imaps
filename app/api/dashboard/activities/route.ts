import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { serializeBigInt } from '@/lib/bigint-serializer';

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
 * Returns the 10 most recent activity log entries
 *
 * Optimized to fetch directly from ActivityLog table
 * Returns unified format with type, description, timestamp, and user
 */
export async function GET(request: Request) {
  try {
    // Fetch the 10 most recent activity logs
    const activityLogs = await prisma.activity_logs.findMany({
      take: 10,
      orderBy: { created_at: 'desc' },
      include: {
        users: {
          select: {
            username: true,
            email: true,
          },
        },
      },
    });

    // Transform to frontend-compatible activity format
    const activities: Activity[] = activityLogs.map((log) => {
      // Determine activity type based on action
      let activityType: 'item' | 'customer' | 'supplier' | 'report' = 'item';
      if (log.action.includes('INCOMING') || log.action.includes('OUTGOING') || log.action.includes('DOCUMENT')) {
        activityType = 'report';
      } else if (log.action.includes('CUSTOMER')) {
        activityType = 'customer';
      } else if (log.action.includes('SUPPLIER')) {
        activityType = 'supplier';
      }

      // Determine color based on status
      let color = '#6366f1'; // indigo default
      if (log.status === 'SUCCESS') {
        color = '#10b981'; // green
      } else if (log.status === 'FAILED') {
        color = '#ef4444'; // red
      } else if (log.status === 'WARNING') {
        color = '#f59e0b'; // amber
      }

      return {
        id: log.id,
        type: activityType,
        title: log.action,
        description: log.description,
        time: dayjs(log.created_at).fromNow(),
        timestamp: log.created_at.toISOString(),
        color,
      };
    });

    return NextResponse.json({
      activities,
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch dashboard activities:', error);
    return NextResponse.json(
      { message: 'Error fetching dashboard activities' },
      { status: 500 }
    );
  }
}
