// app/api/v1/incoming-goods/route.ts

/**
 * Incoming Goods API Endpoint
 * 
 * Endpoint: POST /api/v1/incoming-goods
 * Purpose: Receive incoming goods transactions from WMS
 * Type: Real-time (Header-Detail, All-or-nothing validation)
 * 
 * Request Flow:
 * 1. Authentication (API Key + optional IP whitelist)
 * 2. Rate limiting (1200 req/min per IP)
 * 3. Payload validation (Zod schema)
 * 4. Business logic processing (Service)
 * 5. Database upsert (Repository)
 * 6. Response formatting
 * 
 * Based on: WMS-iMAPS API Contract v2.4 Section 5.1
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/middleware/auth';
import { checkRateLimit } from '@/lib/middleware/rate-limit';
import { incomingGoodService } from '@/lib/services/incoming-goods.service';
import { GenericErrorResponse } from '@/lib/types/api-response.types';

/**
 * POST /api/v1/incoming-goods
 * 
 * Process incoming goods transaction from WMS
 */
export async function POST(request: NextRequest) {
  try {
    // ========================================================================
    // STEP 1: AUTHENTICATION
    // ========================================================================
    
    const authResult = await authenticate(request);
    if (authResult) {
      // Authentication failed - return error response
      return authResult;
    }

    // ========================================================================
    // STEP 2: RATE LIMITING
    // ========================================================================
    
    const rateLimitResult = await checkRateLimit(request);
    if (rateLimitResult) {
      // Rate limit exceeded - return error response
      return rateLimitResult;
    }

    // ========================================================================
    // STEP 3: PARSE REQUEST BODY
    // ========================================================================
    
    let requestData: unknown;
    
    try {
      requestData = await request.json();
    } catch (error) {
      const errorResponse: GenericErrorResponse = {
        success: false,
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
        },
        timestamp: new Date().toISOString(),
      };
      
      return NextResponse.json(errorResponse, { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }

    // ========================================================================
    // STEP 4: PROCESS INCOMING GOOD (Validation + Business Logic + DB)
    // ========================================================================
    
    const result = await incomingGoodService.processIncomingGood(requestData);

    // ========================================================================
    // STEP 5: RETURN RESPONSE
    // ========================================================================
    
    if (result.success) {
      // Success - HTTP 200
      return NextResponse.json(result.data, { 
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } else {
      // Validation or business logic error - HTTP 400
      return NextResponse.json(result.data, { 
        status: 400,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    }
    
  } catch (error) {
    // ========================================================================
    // UNEXPECTED ERROR HANDLING
    // ========================================================================
    
    console.error('Unexpected error in incoming-goods API:', error);
    
    const errorResponse: GenericErrorResponse = {
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'An unexpected error occurred while processing the request',
        details: process.env.NODE_ENV === 'development' 
          ? { error: String(error) }
          : undefined,
      },
      timestamp: new Date().toISOString(),
    };
    
    return NextResponse.json(errorResponse, { 
      status: 500,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }
}

/**
 * Handle unsupported HTTP methods
 */
export async function GET() {
  const errorResponse: GenericErrorResponse = {
    success: false,
    error: {
      code: 'METHOD_NOT_ALLOWED',
      message: 'This endpoint only accepts POST requests',
    },
    timestamp: new Date().toISOString(),
  };
  
  return NextResponse.json(errorResponse, { 
    status: 405,
    headers: {
      'Content-Type': 'application/json',
      'Allow': 'POST',
    },
  });
}

export async function PUT() {
  return GET();
}

export async function DELETE() {
  return GET();
}

export async function PATCH() {
  return GET();
}