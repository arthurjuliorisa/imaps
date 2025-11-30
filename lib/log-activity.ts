import { prisma } from './prisma';
import { ActivityStatus } from '@prisma/client';
import { headers } from 'next/headers';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';

/**
 * Interface for logging activity
 */
interface LogActivityParams {
  action: string;
  description: string;
  status?: ActivityStatus;
  metadata?: Record<string, any>;
  userId?: string | null;
}

/**
 * Extract IP address from request headers
 */
function getIpAddress(headersList: Headers): string | null {
  // Check common proxy headers
  const forwardedFor = headersList.get('x-forwarded-for');
  if (forwardedFor) {
    // x-forwarded-for can contain multiple IPs, take the first one
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = headersList.get('x-real-ip');
  if (realIp) {
    return realIp;
  }

  // Fallback to other headers
  return (
    headersList.get('cf-connecting-ip') ||
    headersList.get('x-client-ip') ||
    null
  );
}

/**
 * Extract user agent from request headers
 */
function getUserAgent(headersList: Headers): string | null {
  return headersList.get('user-agent');
}

/**
 * Log user activity to the database
 *
 * This function automatically captures:
 * - User information from the session (if authenticated)
 * - IP address from request headers
 * - User agent from request headers
 *
 * @param params - Activity log parameters
 * @returns Promise<void>
 *
 * @example
 * await logActivity({
 *   action: 'LOGIN',
 *   description: 'User logged in successfully',
 * });
 *
 * @example
 * await logActivity({
 *   action: 'CREATE_ITEM',
 *   description: 'Created new item: Widget A',
 *   status: 'SUCCESS',
 *   metadata: { itemId: '123', itemCode: 'WGT-001' },
 * });
 *
 * @example
 * await logActivity({
 *   action: 'DELETE_RECORD',
 *   description: 'Failed to delete record due to foreign key constraint',
 *   status: 'FAILED',
 *   metadata: { recordId: '456', error: 'Foreign key constraint' },
 * });
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const {
      action,
      description,
      status = ActivityStatus.SUCCESS,
      metadata = null,
      userId: providedUserId,
    } = params;

    // Get request headers
    const headersList = await headers();
    const ipAddress = getIpAddress(headersList);
    const userAgent = getUserAgent(headersList);

    // Try to get user ID from session if not provided
    let userId = providedUserId;
    if (userId === undefined) {
      try {
        const session = await getServerSession(authOptions);
        userId = session?.user?.id || null;
      } catch (error) {
        // If session retrieval fails, continue without user ID
        userId = null;
      }
    }

    // Create activity log entry
    await prisma.activityLog.create({
      data: {
        userId,
        action,
        description,
        ipAddress,
        userAgent,
        status,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
      },
    });
  } catch (error) {
    // Log the error but don't throw - we don't want logging failures to break the app
    console.error('[logActivity] Failed to log activity:', error);
    console.error('[logActivity] Activity details:', {
      action: params.action,
      description: params.description,
      status: params.status,
    });
  }
}

/**
 * Log activity with explicit user ID (useful for admin actions)
 *
 * @param params - Activity log parameters with required userId
 */
export async function logActivityForUser(
  params: LogActivityParams & { userId: string }
): Promise<void> {
  return logActivity(params);
}

/**
 * Log activity without user context (for system actions)
 *
 * @param params - Activity log parameters
 */
export async function logSystemActivity(
  params: Omit<LogActivityParams, 'userId'>
): Promise<void> {
  return logActivity({ ...params, userId: null });
}
