// lib/middleware/rate-limit.ts

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCode, GenericErrorResponse } from '@/lib/types/api-response.types';

/**
 * Rate Limiting Middleware (In-Memory Implementation)
 * 
 * Features:
 * - Rate limit per IP address
 * - Configurable requests per minute
 * - Burst capacity for temporary spikes
 * - Auto-cleanup of old entries
 * 
 * Environment Variables:
 * - ENABLE_RATE_LIMIT: Enable/disable rate limiting
 * - RATE_LIMIT_PER_MINUTE: Max requests per minute
 * - RATE_LIMIT_BURST: Burst capacity
 * 
 * Limitations (In-Memory):
 * - Not suitable for multi-server deployments
 * - Resets when server restarts
 * - For production with multiple servers, use Redis
 * 
 * Usage:
 * ```
 * import { checkRateLimit } from '@/lib/middleware/rate-limit';
 * 
 * export async function POST(request: NextRequest) {
 *   const rateLimitResult = await checkRateLimit(request);
 *   if (rateLimitResult) return rateLimitResult;
 *   
 *   // Continue...
 * }
 * ```
 */

interface RateLimitConfig {
  enabled: boolean;
  requestsPerMinute: number;
  burstCapacity: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number; // Unix timestamp
  burstUsed: number;
}

// In-memory store for rate limit tracking
// Key: IP address, Value: RateLimitEntry
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Load rate limit configuration from environment
 */
function getRateLimitConfig(): RateLimitConfig {
  return {
    enabled: process.env.ENABLE_RATE_LIMIT !== 'false', // Default: enabled
    requestsPerMinute: parseInt(process.env.RATE_LIMIT_PER_MINUTE || '1200', 10),
    burstCapacity: parseInt(process.env.RATE_LIMIT_BURST || '200', 10),
  };
}

/**
 * Extract client IP from request
 */
function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  return request.headers.get('x-real-ip') || 
         request.headers.get('x-client-ip') || 
         'unknown';
}

/**
 * Get current minute window (Unix timestamp rounded to minute)
 */
function getCurrentMinuteWindow(): number {
  return Math.floor(Date.now() / 60000) * 60000;
}

/**
 * Cleanup old entries from rate limit store
 * Called periodically to prevent memory leaks
 */
function cleanupOldEntries(): void {
  const now = Date.now();
  const keysToDelete: string[] = [];
  
  rateLimitStore.forEach((entry, key) => {
    // Delete entries older than 2 minutes
    if (entry.resetAt < now - 120000) {
      keysToDelete.push(key);
    }
  });
  
  keysToDelete.forEach(key => rateLimitStore.delete(key));
}

// Run cleanup every 5 minutes
if (typeof window === 'undefined') { // Server-side only
  setInterval(cleanupOldEntries, 5 * 60 * 1000);
}

/**
 * Main rate limit check function
 * Returns NextResponse with error if rate limit exceeded, null if OK
 */
export async function checkRateLimit(
  request: NextRequest
): Promise<NextResponse<GenericErrorResponse> | null> {
  const config = getRateLimitConfig();
  
  // If rate limiting is disabled, allow all requests
  if (!config.enabled) {
    return null;
  }
  
  const clientIp = getClientIp(request);
  const now = Date.now();
  const currentWindow = getCurrentMinuteWindow();
  const timestamp = new Date().toISOString();
  
  // Get or create rate limit entry for this IP
  let entry = rateLimitStore.get(clientIp);
  
  // If no entry or expired window, create new entry
  if (!entry || entry.resetAt !== currentWindow + 60000) {
    entry = {
      count: 0,
      resetAt: currentWindow + 60000, // Next minute
      burstUsed: 0,
    };
    rateLimitStore.set(clientIp, entry);
  }
  
  // Increment request count
  entry.count++;
  
  // Check if rate limit exceeded
  if (entry.count > config.requestsPerMinute) {
    // Check if burst capacity available
    if (entry.burstUsed < config.burstCapacity) {
      entry.burstUsed++;
      // Allow request using burst capacity
    } else {
      // Rate limit exceeded, reject request
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      
      const errorResponse: GenericErrorResponse = {
        success: false,
        error: {
          code: ErrorCode.RATE_LIMIT_EXCEEDED,
          message: 'Rate limit exceeded. Please slow down your requests.',
          details: {
            limit: `${config.requestsPerMinute} requests per minute`,
            burst: `${config.burstCapacity} requests`,
            retry_after: retryAfter,
          },
        },
        timestamp,
      };
      
      return NextResponse.json(errorResponse, {
        status: 429,
        headers: {
          'Retry-After': retryAfter.toString(),
          'X-RateLimit-Limit': config.requestsPerMinute.toString(),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': entry.resetAt.toString(),
        },
      });
    }
  }
  
  // Rate limit OK
  return null;
}

/**
 * Get current rate limit status for an IP (for monitoring)
 */
export function getRateLimitStatus(ip: string): {
  count: number;
  limit: number;
  remaining: number;
  resetAt: number;
} | null {
  const config = getRateLimitConfig();
  const entry = rateLimitStore.get(ip);
  
  if (!entry) {
    return {
      count: 0,
      limit: config.requestsPerMinute,
      remaining: config.requestsPerMinute,
      resetAt: getCurrentMinuteWindow() + 60000,
    };
  }
  
  return {
    count: entry.count,
    limit: config.requestsPerMinute,
    remaining: Math.max(0, config.requestsPerMinute - entry.count),
    resetAt: entry.resetAt,
  };
}
