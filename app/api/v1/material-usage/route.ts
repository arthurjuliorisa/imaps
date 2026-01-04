import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/middleware/auth.middleware';
import { rateLimiterMiddleware } from '@/lib/middleware/rate-limiter.middleware';
import { MaterialUsageService } from '@/lib/services/material-usage.service';
import { logger } from '@/lib/utils/logger';
import { logActivity } from '@/lib/log-activity';

/**
 * POST /api/v1/material-usage
 * 
 * Material Usage endpoint for recording material consumption from inventory.
 * 
 * Implements WMS-iMAPS API Contract v2.4+
 * 
 * Request: MaterialUsageBatch
 * Response: SuccessResponse (HTTP 200) | ErrorResponse (HTTP 400)
 * 
 * Middleware:
 * 1. Authentication (authMiddleware)
 * 2. Rate Limiting (rateLimiterMiddleware)
 * 3. Error Handling (errorHandlerMiddleware)
 */

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = logger.child({ scope: 'POST /api/v1/material-usage', requestId });

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
    } catch (err) {
      log.error('Invalid JSON in request body', { error: (err as any).message });
      return NextResponse.json(
        {
          status: 'failed',
          message: 'Invalid request body: must be valid JSON',
          wms_id: 'unknown',
          errors: [{
            location: 'header',
            field: 'body',
            code: 'INVALID_JSON',
            message: 'Request body must be valid JSON'
          }],
        },
        { status: 400 }
      );
    }

    // 4. Process via service
    const service = new MaterialUsageService();
    const response = await service.processMaterialUsage(body);

    // 5. Return response
    if (response.status === 'success') {
      log.info('Material usage processed successfully', {
        wmsId: response.wms_id,
        queuedItemsCount: response.queued_items_count,
        validatedAt: response.validated_at,
      });
      
      // Log successful processing
      await logActivity({
        action: 'WMS_PROCESS_MATERIAL_USAGE',
        description: `Successfully processed material usage for WMS ID: ${response.wms_id}`,
        status: 'success',
        metadata: {
          wms_id: response.wms_id,
          itemCount: response.queued_items_count,
        },
      });
      
      return NextResponse.json(response, { status: 200 });
    } else {
      log.warn('Material usage processing failed', {
        wmsId: response.wms_id,
        errorCount: response.errors.length,
      });
      
      // Log validation failure
      await logActivity({
        action: 'WMS_PROCESS_MATERIAL_USAGE',
        description: 'Failed to process material usage - validation error',
        status: 'failed',
        metadata: {
          wms_id: response.wms_id,
          errors: response.errors,
        },
      });
      
      return NextResponse.json(
        {
          status: 'failed',
          message: 'Validation failed',
          wms_id: response.wms_id || 'unknown',
          errors: response.errors,
        },
        { status: 400 }
      );
    }
  } catch (err: any) {
    log.error('Unexpected error in material-usage endpoint', {
      error: err.message,
      stack: err.stack,
      wmsId,
    });

    // Log error
    await logActivity({
      action: 'WMS_PROCESS_MATERIAL_USAGE',
      description: 'Failed to process material usage - system error',
      status: 'error',
      metadata: {
        wms_id: wmsId,
        error: err.message || 'Internal server error',
      },
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
          message: err.message || 'Internal server error'
        }]
      },
      { status: 500 }
    );
  }
}
