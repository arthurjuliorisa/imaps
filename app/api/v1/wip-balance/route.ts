/**
 * POST /api/v1/wip-balance
 * WIP Balance API endpoint
 * 
 * Pattern: Aligned with Incoming Goods endpoint
 * - Middleware chain (auth, rate limit)
 * - Service-based validation and processing
 * - Consistent error handling
 * 
 * Differences from Incoming Goods:
 * - Batch endpoint (multiple independent records)
 * - Partial success allowed
 * - No header-detail structure
 */

import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/middleware/auth.middleware';
import { rateLimiterMiddleware } from '@/lib/middleware/rate-limiter.middleware';
import { errorHandler } from '@/lib/middleware/error-handler.middleware';
import { WIPBalanceService } from '@/lib/services/wip-balance.service';
import { createRequestLogger, logRequest, logResponse } from '@/lib/utils/logger';

/**
 * POST /api/v1/wip-balance
 * Process WIP Balance batch request
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const { requestId, logger: requestLogger } = createRequestLogger(request);

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

    // Process WIP Balance batch
    const service = new WIPBalanceService();
    const result = await service.processBatch(body);

    if (!result.success) {
      // Validation failed (all records failed)
      // Get total_records from payload
      const totalRecords = (body?.records?.length) || 0;
      
      logResponse(requestLogger, 400, startTime);
      return NextResponse.json(
        {
          status: 'failed',
          message: 'Batch validation failed',
          summary: {
            total_records: totalRecords,
            success_count: 0,
            failed_count: totalRecords,
          },
          validated_at: new Date().toISOString(),
          failed_records: result.errors.map((err, idx) => {
            // Try to get wms_id from payload, fallback to placeholder
            const record = (body?.records?.[idx]) as any;
            const wmsId = record?.wms_id || `BATCH_ERROR_${idx + 1}`;
            
            return {
              wms_id: wmsId,
              row_index: idx + 1,
              errors: [err],
            };
          }),
        },
        { status: 400 }
      );
    }

    // Success or partial success
    logResponse(requestLogger, 200, startTime);
    return NextResponse.json(result.data, { status: 200 });
  } catch (error) {
    requestLogger.error('Failed to process WIP Balance batch', { error });

    const errorResponse = errorHandler(error);
    logResponse(requestLogger, errorResponse.status, startTime);

    return NextResponse.json(errorResponse.body, { status: errorResponse.status });
  }
}
