import { NextRequest, NextResponse } from 'next/server';
import { AuthenticationError, ForbiddenError } from '../utils/error.util';
import { logger } from '../utils/logger';

/**
 * Validate API Key from X-API-Key header
 */
export const validateApiKey = (request: NextRequest): boolean => {
  const apiKey = request.headers.get('X-API-Key');
  const expectedApiKey = process.env.API_KEY;

  if (!expectedApiKey) {
    logger.error('API_KEY not configured in environment variables');
    throw new Error('API_KEY not configured');
  }

  return apiKey === expectedApiKey;
};

/**
 * Validate IP address against whitelist
 */
export const validateIpWhitelist = (request: NextRequest): boolean => {
  const ipWhitelistEnabled = process.env.IP_WHITELIST_ENABLED === 'true';

  // Skip IP validation if disabled (dev/staging)
  if (!ipWhitelistEnabled) {
    return true;
  }

  const clientIp = getClientIp(request);
  const whitelist = process.env.IP_WHITELIST?.split(',').map((ip) => ip.trim()) || [];

  if (whitelist.length === 0) {
    logger.error('IP_WHITELIST not configured but IP_WHITELIST_ENABLED is true');
    throw new Error('IP_WHITELIST not configured');
  }

  return whitelist.includes(clientIp);
};

/**
 * Get client IP address from request
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
  // NextRequest tidak punya property .ip, jadi langsung return localhost
  return '127.0.0.1';
};

/**
 * Authentication middleware
 */
export const authMiddleware = (request: NextRequest) => {
  const requestLogger = logger.child({
    middleware: 'auth',
    path: request.nextUrl.pathname,
    method: request.method,
  });

  try {
    // 1. Validate API Key
    if (!validateApiKey(request)) {
      requestLogger.warn('Invalid API key');
      throw new AuthenticationError('Invalid API key', 'INVALID_API_KEY');
    }

    // 2. Validate IP Whitelist
    if (!validateIpWhitelist(request)) {
      const clientIp = getClientIp(request);
      requestLogger.warn('IP not whitelisted',{ clientIp });
      throw new ForbiddenError('Access denied', 'IP_NOT_WHITELISTED');
    }

    requestLogger.info('Authentication successful');
    return { success: true };
  } catch (error) {
    if (error instanceof AuthenticationError || error instanceof ForbiddenError) {
      throw error;
    }
    requestLogger.error( 'Authentication error',{ error });
    throw new AuthenticationError('Authentication failed');
  }
};

/**
 * Authenticate request - wrapper for route handlers
 */
export const authenticate = async (
  request: NextRequest
): Promise<{ authenticated: boolean; error?: string }> => {
  try {
    authMiddleware(request);
    return { authenticated: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Authentication failed';
    return { authenticated: false, error: message };
  }
};