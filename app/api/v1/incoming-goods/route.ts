import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/middleware/auth.middleware';
import { rateLimiterMiddleware } from '@/lib/middleware/rate-limiter.middleware';
import { errorHandler } from '@/lib/middleware/error-handler.middleware';
import { IncomingGoodsService } from '@/lib/services/incoming-goods.service';
import { createRequestLogger, logRequest, logResponse } from '@/lib/utils/logger';

/**
 * POST /api/v1/incoming-goods
 * Incoming Goods API endpoint
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const { logger: requestLogger } = createRequestLogger(request);

  let wmsId: string | undefined;

  try {
    // Log incoming request
    await logRequest(request, requestLogger);

    // Middleware chain
    // 1. Authentication
    const authResult = await authenticate(request);
    if (!authResult.authenticated) {
      logResponse(requestLogger, 401, startTime);
      return NextResponse.json(
        {
          status: 'failed',
          message: 'Authentication failed',
          error: authResult.error,
        },
        { status: 401 }
      );
    }

    // 2. Rate limiting
    const rateLimitResult = rateLimiterMiddleware(request);
    if (!rateLimitResult.success) {
      logResponse(requestLogger, 429, startTime);
      return NextResponse.json(
        {
          status: 'failed',
          message: 'Rate limit exceeded',
        },
        { status: 429 }
      );
    }

    // Parse request body
    const body = await request.json();
    wmsId = body.wms_id;

    // Process incoming goods
    const service = new IncomingGoodsService();
    const result = await service.processIncomingGoods(body);

    if (!result.success) {
      // Validation failed
      logResponse(requestLogger, 400, startTime);
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
    logResponse(requestLogger, 200, startTime);
    return NextResponse.json(result.data, { status: 200 });
  } catch (error) {
    requestLogger.error('Failed to process incoming goods', { error, wmsId });

    const errorResponse = errorHandler(error, wmsId);
    logResponse(requestLogger, errorResponse.status, startTime);

    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
}