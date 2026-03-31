import { prisma } from './prisma';
import { headers } from 'next/headers';
import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { normalizeWmsPayload, getTransactionTypeFromAction } from './utils/payload-normalizer';

/**
 * Interface for logging activity
 */
interface LogActivityParams {
  action: string;
  description: string;
  status?: string;
  metadata?: Record<string, any>;
  userId?: string | null;
  wms_payload?: any;        // Full WMS request payload
  imaps_response?: any;     // Response error from iMAPS
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
 *   metadata: { itemId: '123', itemCode: 'WGT-001' },
 * });
 *
 * @example
 * await logActivity({
 *   action: 'DELETE_RECORD',
 *   description: 'Failed to delete record due to foreign key constraint',
 *   metadata: { recordId: '456', error: 'Foreign key constraint' },
 * });
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const {
      action,
      description,
      status = 'success',
      metadata = null,
      userId: providedUserId,
      wms_payload,
      imaps_response,
    } = params;

    // Get user ID from session if not provided
    let userId = providedUserId;
    if (!userId) {
      try {
        const session = await getServerSession(authOptions);
        userId = session?.user?.id || null;
      } catch {
        // Session might not be available in all contexts
        userId = null;
      }
    }

    // Get request headers for IP and user agent
    let ipAddress: string | null = null;
    let userAgent: string | null = null;
    try {
      const headersList = await headers();
      ipAddress = getIpAddress(headersList);
      userAgent = getUserAgent(headersList);
    } catch {
      // Headers might not be available in all contexts
    }

    // 1. Write to activity_logs table (lightweight entry)
    const activityLog = await prisma.activity_logs.create({
      data: {
        user_id: userId,
        action,
        description,
        status,
        metadata: metadata ? JSON.parse(JSON.stringify(metadata)) : null,
        ip_address: ipAddress,
        user_agent: userAgent,
      },
    });

    // 2. For ANY WMS transmission action, create detailed transmission log
    // Strategy: ALWAYS log WMS transmissions (success, failed, error)
    // Difference: Only FAILED/ERROR cases include wms_payload and imaps_response (for storage efficiency)
    if (action && action.startsWith('WMS_')) {
      try {
        // Determine transmission status
        let transmissionStatus = 'UNKNOWN';
        if (status === 'success') transmissionStatus = 'SUCCESS';
        else if (status === 'failed') transmissionStatus = 'FAILED';
        else if (status === 'error') transmissionStatus = 'ERROR';

        // Normalize payload structure before storing
        const transactionType = getTransactionTypeFromAction(action);
        const normalizedPayload = status !== 'success' && wms_payload 
          ? normalizeWmsPayload(wms_payload, transactionType)
          : null;

        // Serialize payloads before storing
        let serializedPayload = null;
        let serializedResponse = null;

        try {
          if (normalizedPayload) {
            serializedPayload = JSON.parse(JSON.stringify(normalizedPayload));
          }
        } catch (serializeError) {
          // Proceed anyway, will store null if serialization fails
        }

        try {
          if (status !== 'success' && imaps_response) {
            serializedResponse = JSON.parse(JSON.stringify(imaps_response));
          }
        } catch (serializeError) {
          // Proceed anyway, will store null if serialization fails
        }

        const result = await prisma.wms_transmission_logs.create({
          data: {
            activity_log_id: activityLog.id,
            action,
            wms_id: metadata?.wms_id || null,
            // Convert company_code to number if it's a string
            company_code: metadata?.company_code 
              ? typeof metadata.company_code === 'string' 
                ? parseInt(metadata.company_code, 10) 
                : metadata.company_code
              : null,
            transmission_status: transmissionStatus,
            error_type: status !== 'success' ? (metadata?.error_type || 'UNKNOWN') : null,
            summary: description,
            // Only store payloads for FAILED/ERROR cases
            wms_request_payload: serializedPayload,
            imaps_error_response: serializedResponse,
            item_count: Array.isArray(wms_payload?.items) ? wms_payload.items.length : null,
            expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days retention
          },
        });
      } catch (transmissionLogError) {
        // Log transmission log creation error, but don't break main flow
        console.error('[logActivity] Failed to create transmission log:', {
          error: transmissionLogError instanceof Error ? transmissionLogError.message : String(transmissionLogError),
          action,
          status,
          stack: transmissionLogError instanceof Error ? transmissionLogError.stack : undefined,
        });
      }
    }
  } catch (error) {
    // Log the error but don't throw - we don't want logging failures to break the app
    console.error('[logActivity] Failed to log activity:', error);
    console.error('[logActivity] Activity details:', {
      action: params.action,
      description: params.description,
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
