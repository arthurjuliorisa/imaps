import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/middleware/auth.middleware';
import { rateLimiterMiddleware } from '@/lib/middleware/rate-limiter.middleware';
import { OutgoingGoodsService } from '@/lib/services/outgoing-goods.service';
import { logger } from '@/lib/utils/logger';
import { logActivity } from '@/lib/log-activity';

/**
 * POST /api/v1/outgoing-goods
 * 
 * Outgoing Goods endpoint for recording goods shipped from bonded zone warehouse.
 * 
 * Implements WMS-iMAPS API Contract v2.4+
 * 
 * Request: OutgoingGoodsRequest
 * Response: SuccessResponse (HTTP 200) | ErrorResponse (HTTP 400)
 * 
 * Middleware:
 * 1. Authentication (authenticate)
 * 2. Rate Limiting (rateLimiterMiddleware)
 */

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = logger.child({ scope: 'POST /api/v1/outgoing-goods', requestId });

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
          errors: [],
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
          errors: [],
        },
        { status: 429 }
      );
    }

    // 3. Parse request body
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
          errors: [
            {
              location: 'header',
              field: 'body',
              code: 'INVALID_JSON',
              message: 'Request body must be valid JSON',
            },
          ],
        },
        { status: 400 }
      );
    }

    log.info('Request received', { wmsId });

    // 4. Process outgoing goods
    const service = new OutgoingGoodsService();
    const result = await service.processOutgoingGoods(body);

    if (!result.success) {
      // Validation failed
      log.info('Validation failed', { wmsId, errorCount: result.errors.length });
      
      // Convert company_code to number if it's a string
      const companyCode = body?.company_code 
        ? typeof body.company_code === 'string' 
          ? parseInt(body.company_code, 10) 
          : body.company_code
        : null;
      
      // Log validation failure with payload tracking
      await logActivity({
        action: 'WMS_PROCESS_OUTGOING_GOODS',
        description: 'Failed to process outgoing goods - validation error',
        status: 'failed',
        wms_payload: body,
        imaps_response: {
          status: 'failed',
          message: 'Validation failed',
          errors: result.errors,
        },
        metadata: {
          wms_id: wmsId,
          company_code: companyCode,
          error_type: 'VALIDATION_ERROR',
          error_count: result.errors?.length || 0,
        },
      });
      
      return NextResponse.json(
        {
          status: 'failed',
          message: 'Validation failed',
          wms_id: wmsId,
          errors: result.errors,
        },
        { status: 400 }
      );
    }

    // Success
    log.info('Request processed successfully', { wmsId, itemCount: result.data.queued_items_count });
    
    // Convert company_code to number if it's a string
    const successCompanyCode = body?.company_code 
      ? typeof body.company_code === 'string' 
        ? parseInt(body.company_code, 10) 
        : body.company_code
      : null;
    
    // Log successful processing
    await logActivity({
      action: 'WMS_PROCESS_OUTGOING_GOODS',
      description: `Successfully processed outgoing goods for WMS ID: ${wmsId}`,
      status: 'success',
      metadata: {
        wms_id: wmsId,
        company_code: successCompanyCode,
        item_count: result.data.queued_items_count,
      },
    });
    
    return NextResponse.json(result.data, { status: 200 });
  } catch (error) {
    log.error('Unexpected error during request processing', { error, wmsId });

    // Convert company_code to number if it's a string
    const errorCompanyCode = body?.company_code 
      ? typeof body.company_code === 'string' 
        ? parseInt(body.company_code, 10) 
        : body.company_code
      : null;

    // Log error with payload tracking
    await logActivity({
      action: 'WMS_PROCESS_OUTGOING_GOODS',
      description: 'Failed to process outgoing goods - system error',
      status: 'error',
      wms_payload: body,
      imaps_response: {
        error: error instanceof Error ? error.name : 'UNKNOWN',
        message: error instanceof Error ? error.message : String(error),
      },
      metadata: {
        wms_id: wmsId,
        company_code: errorCompanyCode,
        error_type: 'SYSTEM_ERROR',
      },
    });

    return NextResponse.json(
      {
        status: 'failed',
        message: 'Internal server error',
        wms_id: wmsId || 'unknown',
        errors: [
          {
            location: 'header',
            field: 'server',
            code: 'INTERNAL_ERROR',
            message: 'An unexpected error occurred while processing the request',
          },
        ],
      },
      { status: 500 }
    );
  }
}
