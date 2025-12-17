// lib/middleware/auth.ts

import { NextRequest, NextResponse } from 'next/server';
import { ErrorCode, GenericErrorResponse } from '@/lib/types/api-response.types';

/**
 * Authentication Middleware
 * 
 * Features:
 * 1. API Key validation (always enabled)
 * 2. IP Whitelist validation (optional, configurable via env)
 * 
 * Environment Variables:
 * - API_KEY_SECRET: The valid API key
 * - ENABLE_IP_WHITELIST: Toggle IP whitelist (true/false)
 * - ALLOWED_IPS: Comma-separated list of allowed IPs
 * 
 * Usage in API route:
 * ```
 * import { authenticate } from '@/lib/middleware/auth';
 * 
 * export async function POST(request: NextRequest) {
 *   const authResult = await authenticate(request);
 *   if (authResult) return authResult; // Return error response
 *   
 *   // Continue with your logic...
 * }
 * ```
 */

interface AuthConfig {
  apiKey: string;
  enableIpWhitelist: boolean;
  allowedIps: string[];
}

/**
 * Load authentication configuration from environment variables
 */
function getAuthConfig(): AuthConfig {
  const apiKey = process.env.API_KEY_SECRET;
  
  if (!apiKey) {
    throw new Error('API_KEY_SECRET is not configured in environment variables');
  }
  
  const enableIpWhitelist = process.env.ENABLE_IP_WHITELIST === 'true';
  const allowedIps = process.env.ALLOWED_IPS
    ? process.env.ALLOWED_IPS.split(',').map(ip => ip.trim())
    : [];
  
  return {
    apiKey,
    enableIpWhitelist,
    allowedIps,
  };
}

/**
 * Extract client IP address from request
 */
function getClientIp(request: NextRequest): string | null {
  // Try various headers (for different proxy/load balancer setups)
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  
  const realIp = request.headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  
  // Fallback to connection IP (might be localhost in dev)
  return request.headers.get('x-client-ip') || null;
}

/**
 * Main authentication function
 * Returns NextResponse with error if authentication fails, null if success
 */
export async function authenticate(
  request: NextRequest
): Promise<NextResponse<GenericErrorResponse> | null> {
  const config = getAuthConfig();
  const timestamp = new Date().toISOString();
  
  // ============================================================================
  // 1. API KEY VALIDATION (always enabled)
  // ============================================================================
  
  const apiKey = request.headers.get('X-API-Key') || request.headers.get('x-api-key');
  
  if (!apiKey) {
    const errorResponse: GenericErrorResponse = {
      success: false,
      error: {
        code: ErrorCode.MISSING_API_KEY,
        message: 'API key is required. Please provide X-API-Key header.',
      },
      timestamp,
    };
    
    return NextResponse.json(errorResponse, { status: 401 });
  }
  
  if (apiKey !== config.apiKey) {
    const errorResponse: GenericErrorResponse = {
      success: false,
      error: {
        code: ErrorCode.INVALID_API_KEY,
        message: 'Invalid API key. Please check your credentials.',
      },
      timestamp,
    };
    
    return NextResponse.json(errorResponse, { status: 401 });
  }
  
  // ============================================================================
  // 2. IP WHITELIST VALIDATION (optional, configurable)
  // ============================================================================
  
  if (config.enableIpWhitelist) {
    const clientIp = getClientIp(request);
    
    if (!clientIp) {
      const errorResponse: GenericErrorResponse = {
        success: false,
        error: {
          code: ErrorCode.IP_NOT_WHITELISTED,
          message: 'Unable to determine client IP address.',
        },
        timestamp,
      };
      
      return NextResponse.json(errorResponse, { status: 403 });
    }
    
    if (!config.allowedIps.includes(clientIp)) {
      const errorResponse: GenericErrorResponse = {
        success: false,
        error: {
          code: ErrorCode.IP_NOT_WHITELISTED,
          message: `IP address ${clientIp} is not whitelisted. Please contact iMAPS team.`,
          details: {
            client_ip: clientIp,
          },
        },
        timestamp,
      };
      
      return NextResponse.json(errorResponse, { status: 403 });
    }
  }
  
  // Authentication successful
  return null;
}

/**
 * Helper: Check if API key is valid (without IP check)
 * Useful for internal functions that don't have full request object
 */
export function isValidApiKey(apiKey: string): boolean {
  const config = getAuthConfig();
  return apiKey === config.apiKey;
}
