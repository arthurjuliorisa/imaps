import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/middleware/auth.middleware';
import { rateLimiterMiddleware } from '@/lib/middleware/rate-limiter.middleware';
import { ProductionOutputService } from '@/lib/services/production-output.service';
import { logger } from '@/lib/utils/logger';
import { logActivity } from '@/lib/log-activity';

/**
 * POST /api/v1/production-output
 * 
 * Production Output endpoint for recording finished goods and semifinished goods
 * from work orders with traceability.
 * 
 * Implements WMS-iMAPS API Contract v2.4+
 * 
 * Request: ProductionOutputBatch
 * Response: SuccessResponse (HTTP 200) | ErrorResponse (HTTP 400)
 * 
 * Middleware:
 * 1. Authentication (authMiddleware)
 * 2. Rate Limiting (rateLimiterMiddleware)
 * 3. Error Handling (errorHandlerMiddleware)
 */

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = logger.child({ scope: 'POST /api/v1/production-output', requestId });

  let wmsId: string | undefined;
  let body: any;

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
    const service = new ProductionOutputService();
    const result = await service.processProductionOutput(body);

    if (!result.success) {
      log.warn('Service processing failed', {
        wmsId,
        errorCount: result.errors.length,
      });
      
      // Log validation failure with payload tracking
      await logActivity({
        action: 'WMS_PROCESS_PRODUCTION_OUTPUT',
        description: 'Failed to process production output - validation error',
        status: 'failed',
        wms_payload: body,
        imaps_response: {
          status: 'failed',
          message: 'Validation failed',
          errors: result.errors,
        },
        metadata: {
          wms_id: wmsId,
          company_code: body?.company_code,
          error_type: 'VALIDATION_ERROR',
          error_count: result.errors?.length || 0,
        },
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
    log.info('Production output created successfully', {
      wmsId: result.data.wms_id,
      queuedItemsCount: result.data.queued_items_count,
    });

    // Log successful processing
    await logActivity({
      action: 'WMS_PROCESS_PRODUCTION_OUTPUT',
      description: `Successfully processed production output for WMS ID: ${result.data.wms_id}`,
      status: 'success',
      metadata: {
        wms_id: result.data.wms_id,
        company_code: body?.company_code,
        item_count: result.data.queued_items_count,
      },
    });

    return NextResponse.json(result.data, { status: 200 });
  } catch (error) {
    log.error('Unhandled error in POST /api/v1/production-output', {
      error: error instanceof Error ? error.message : String(error),
      wmsId,
    });
    
    // Log error with payload tracking
    await logActivity({
      action: 'WMS_PROCESS_PRODUCTION_OUTPUT',
      description: 'Failed to process production output - system error',
      status: 'error',
      wms_payload: body,
      imaps_response: {
        error: error instanceof Error ? error.name : 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
      },
      metadata: {
        wms_id: wmsId,
        company_code: body?.company_code,
        error_type: 'SYSTEM_ERROR',
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
          message: error instanceof Error ? error.message : 'Internal server error'
        }]
      },
      { status: 500 }
    );
  }
}
