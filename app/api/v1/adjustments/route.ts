import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/middleware/auth.middleware';
import { rateLimiterMiddleware } from '@/lib/middleware/rate-limiter.middleware';
import { AdjustmentsService } from '@/lib/services/adjustments.service';
import { logger } from '@/lib/utils/logger';

/**
 * POST /api/v1/adjustments
 * 
 * Adjustments endpoint for recording stock adjustments (GAIN/LOSS)
 * to correct inventory discrepancies or process adjustments.
 * 
 * Implements WMS-iMAPS API Contract v2.4+
 * 
 * Request: AdjustmentBatch
 * Response: SuccessResponse (HTTP 200) | ErrorResponse (HTTP 400)
 * 
 * Middleware:
 * 1. Authentication (authMiddleware)
 * 2. Rate Limiting (rateLimiterMiddleware)
 * 3. Error Handling (errorHandlerMiddleware)
 */

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = logger.child({ scope: 'POST /api/v1/adjustments', requestId });

  let wmsId: string | undefined;

  try {
    // 1. Middleware: Authentication
    const authResult = await authenticate(request);
    if (!authResult.authenticated) {
      log.warn('Authentication failed', { error: authResult.error });
      return NextResponse.json(
        { 
          status: 'failed', 
          message: 'Authentication failed',
          wms_id: 'unknown',
          errors: [] 
        },
        { status: 401 }
      );
    }

    // 2. Middleware: Rate Limiting
    const rateLimitResult = rateLimiterMiddleware(request);
    if (!rateLimitResult.success) {
      log.warn('Rate limit exceeded');
      return NextResponse.json(
        { 
          status: 'failed', 
          message: 'Rate limit exceeded',
          wms_id: 'unknown',
          errors: [] 
        },
        { status: 429 }
      );
    }

    // 3. Parse request body
    let body;
    try {
      body = await request.json();
      wmsId = body.wms_id;
    } catch (e) {
      log.warn('Failed to parse JSON body', { error: String(e) });
      return NextResponse.json(
        { 
          status: 'failed', 
          message: 'Invalid JSON body',
          wms_id: 'unknown',
          errors: [{
            location: 'header',
            field: 'body',
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON'
          }]
        },
        { status: 400 }
      );
    }

    // 4. Process via service
    const service = new AdjustmentsService();
    const result = await service.processAdjustment(body);

    if (!result.success) {
      log.warn('Service processing failed', {
        wmsId,
        errorCount: result.errors.length,
      });
      return NextResponse.json(
        {
          status: 'failed',
          message: 'Validation failed',
          wms_id: wmsId || 'unknown',
          errors: result.errors,
        },
        { status: 400 }
      );
    }

    // 5. Success response
    log.info('Adjustment created successfully', {
      wmsId: result.data.wms_id,
      queuedItemsCount: result.data.queued_items_count,
    });

    return NextResponse.json(result.data, { status: 200 });
  } catch (error) {
    log.error('Unhandled error in POST /api/v1/adjustments', {
      error: error instanceof Error ? error.message : String(error),
      wmsId,
    });
    
    return NextResponse.json(
      {
        status: 'failed',
        message: 'Internal server error',
        wms_id: wmsId || 'unknown',
        errors: [{
          location: 'header',
          field: 'unknown',
          code: 'INTERNAL_ERROR',
          message: error instanceof Error ? error.message : 'Internal server error'
        }]
      },
      { status: 500 }
    );
  }
}
