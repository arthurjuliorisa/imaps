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
 *
 * This endpoint is temporarily disabled because it depends on the activity_logs table
 * which has been removed from the schema.
 *
 * To re-enable this endpoint:
 * 1. Add the activity_logs table back to the schema
 * 2. Implement activity logging in transaction handlers
 */
export async function GET(request: Request) {
  return NextResponse.json({
    success: false,
    message: 'This endpoint is temporarily disabled. The activity_logs table has been removed from the schema.',
    activities: []
  }, { status: 503 });
}
