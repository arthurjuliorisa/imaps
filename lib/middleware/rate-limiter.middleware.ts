import { NextRequest } from 'next/server';
import { RateLimitError } from '../utils/error.util';
import { logger } from '../utils/logger';

interface RateLimitStore {
  count: number;
  resetTime: number;
}

// In-memory store (per IP)
const rateLimitStore = new Map<string, RateLimitStore>();

/**
 * Get client IP for rate limiting
 */
const getClientIp = (request: NextRequest): string => {
  // Try different headers for IP address (in order of reliability)
  
  // 1. X-Forwarded-For (most common for proxies/load balancers)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }

  // 2. X-Real-IP (nginx)
  const real = request.headers.get('x-real-ip');
  if (real) {
    return real;
  }

  // 3. CF-Connecting-IP (Cloudflare)
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) {
    return cfIp;
  }

  // 4. True-Client-IP (Akamai, Cloudflare)
  const trueClientIp = request.headers.get('true-client-ip');
  if (trueClientIp) {
    return trueClientIp;
  }

  // Fallback untuk local development
  // NextRequest tidak punya property .ip
  return '127.0.0.1';
};

/**
 * Rate limiter middleware
 */
export const rateLimiterMiddleware = (request: NextRequest) => {
  const rateLimitEnabled = process.env.RATE_LIMIT_ENABLED !== 'false';

  // Skip if disabled
  if (!rateLimitEnabled) {
    return { success: true };
  }

  const clientIp = getClientIp(request);
  const maxRequests = parseInt(process.env.RATE_LIMIT_MAX || '1200', 10);
  const windowMs = parseInt(process.env.RATE_LIMIT_WINDOW || '60000', 10);
  const burst = parseInt(process.env.RATE_LIMIT_BURST || '200', 10);

  const now = Date.now();
  const stored = rateLimitStore.get(clientIp);

  // Initialize or reset if window expired
  if (!stored || now >= stored.resetTime) {
    rateLimitStore.set(clientIp, {
      count: 1,
      resetTime: now + windowMs,
    });
    return { success: true };
  }

  // Increment count
  stored.count += 1;

  // Check if exceeded (with burst allowance)
  if (stored.count > maxRequests + burst) {
    logger.warn(
      'Rate limit exceeded',
      {
        clientIp,
        count: stored.count,
        maxRequests,
        burst,
      }
    );

    throw new RateLimitError('Rate limit exceeded. Please try again later.');
  }

  // Log warning if approaching limit
  if (stored.count > maxRequests) {
    logger.warn(
      'Rate limit burst capacity used',
      {
        clientIp,
        count: stored.count,
        maxRequests,
        burst,
        remaining: maxRequests + burst - stored.count,
      }
    );
  }

  return { success: true };
};

/**
 * Cleanup old entries (call periodically via cron)
 */
export const cleanupRateLimitStore = () => {
  const now = Date.now();
  let cleaned = 0;

  for (const [ip, store] of rateLimitStore.entries()) {
    if (now >= store.resetTime) {
      rateLimitStore.delete(ip);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    logger.info('Rate limit store cleaned', { cleaned });
  }
};