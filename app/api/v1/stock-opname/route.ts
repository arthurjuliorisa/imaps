import { NextRequest, NextResponse } from 'next/server';
import { authenticate } from '@/lib/middleware/auth.middleware';
import { rateLimiterMiddleware } from '@/lib/middleware/rate-limiter.middleware';
import { createWmsStockOpnameService } from '@/lib/services/wms-stock-opname.service';
import { createStockOpnameSchema, updateStockOpnameSchema } from '@/lib/validators/schemas/wms-stock-opname.schema';
import { logger } from '@/lib/utils/logger';
import { logActivity } from '@/lib/log-activity';
import { prisma } from '@/lib/prisma';

/**
 * POST /api/v1/stock-opname
 * Creates a new stock opname record with status "ACTIVE"
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = logger.child({ scope: 'POST /api/v1/stock-opname', requestId });

  let wmsId: string | undefined;
  let companyCode: number | undefined;

  try {
    // 1. Middleware: Authentication
    const authResult = await authenticate(request);
    if (!authResult.authenticated) {
      log.warn('Authentication failed', { error: authResult.error });
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Authentication failed',
            code: 'AUTH_FAILED',
          },
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
          success: false,
          error: {
            message: 'Rate limit exceeded',
            code: 'RATE_LIMIT_EXCEEDED',
          },
        },
        { status: 429 }
      );
    }

    // 3. Parse request body
    let body;
    try {
      body = await request.json();
      wmsId = body.wms_id;
      companyCode = body.company_code;
    } catch (e) {
      log.warn('Failed to parse JSON body');
      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Invalid JSON body',
            code: 'INVALID_JSON',
          },
        },
        { status: 400 }
      );
    }

    // 4. Validate request payload
    const validationResult = createStockOpnameSchema.safeParse(body);
    if (!validationResult.success) {
      log.warn('Validation failed', { wmsId, companyCode, errorCount: validationResult.error.issues.length });

      const details = validationResult.error.issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
        code: 'VALIDATION_ERROR',
      }));

      await logActivity({
        action: 'WMS_CREATE_STOCK_OPNAME',
        description: 'Failed to create stock opname - validation error',
        status: 'failed',
        metadata: { wms_id: wmsId, company_code: companyCode, error_count: details.length },
      });

      return NextResponse.json(
        {
          success: false,
          error: {
            message: 'Validation failed',
            code: 'VALIDATION_ERROR',
            details,
          },
        },
        { status: 400 }
      );
    }

    // 5. Process via service
    const service = createWmsStockOpnameService(prisma);
    const result = await service.processCreate(validationResult.data, 'system-wms');

    // 6. Success response
    log.info('Stock opname created successfully', { wmsId: result.wms_id, itemCount: result.items.length });

    await logActivity({
      action: 'WMS_CREATE_STOCK_OPNAME',
      description: `Successfully created stock opname for WMS ID: ${result.wms_id}`,
      status: 'success',
      metadata: { wms_id: result.wms_id, company_code: result.company_code, item_count: result.items.length },
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: 'Stock opname created successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Unhandled error in POST /api/v1/stock-opname', { error: errorMessage, wmsId, companyCode });

    await logActivity({
      action: 'WMS_CREATE_STOCK_OPNAME',
      description: 'Failed to create stock opname - system error',
      status: 'error',
      metadata: { wms_id: wmsId, company_code: companyCode, error: errorMessage },
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          message: errorMessage || 'Internal server error',
          code: 'INTERNAL_ERROR',
        },
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/v1/stock-opname
 * Updates stock opname status to "CONFIRMED" or "CANCELLED"
 */
export async function PATCH(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = logger.child({ scope: 'PATCH /api/v1/stock-opname', requestId });

  let wmsId: string | undefined;

  try {
    // 1. Middleware: Authentication
    const authResult = await authenticate(request);
    if (!authResult.authenticated) {
      log.warn('Authentication failed');
      return NextResponse.json(
        {
          success: false,
          error: { message: 'Authentication failed', code: 'AUTH_FAILED' },
        },
        { status: 401 }
      );
    }

    // 2. Middleware: Rate Limiting
    const rateLimitResult = rateLimiterMiddleware(request);
    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          success: false,
          error: { message: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
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
      return NextResponse.json(
        { success: false, error: { message: 'Invalid JSON body', code: 'INVALID_JSON' } },
        { status: 400 }
      );
    }

    // 4. Validate request payload
    const validationResult = updateStockOpnameSchema.safeParse(body);
    if (!validationResult.success) {
      log.warn('Validation failed', { wmsId });

      const details = validationResult.error.issues.map((err) => ({
        field: err.path.join('.'),
        message: err.message,
        code: 'VALIDATION_ERROR',
      }));

      await logActivity({
        action: 'WMS_UPDATE_STOCK_OPNAME',
        description: 'Failed to update stock opname - validation error',
        status: 'failed',
        metadata: { wms_id: wmsId, error_count: details.length },
      });

      return NextResponse.json(
        {
          success: false,
          error: { message: 'Validation failed', code: 'VALIDATION_ERROR', details },
        },
        { status: 400 }
      );
    }

    // 5. Process via service
    const service = createWmsStockOpnameService(prisma);
    const result = await service.processUpdate(validationResult.data, 'system-wms');

    // 6. Success response
    log.info('Stock opname updated successfully', { wmsId: result.wms_id, newStatus: result.status });

    await logActivity({
      action: 'WMS_UPDATE_STOCK_OPNAME',
      description: `Successfully updated stock opname to status: ${result.status}`,
      status: 'success',
      metadata: { wms_id: result.wms_id, new_status: result.status },
    });

    return NextResponse.json(
      {
        success: true,
        data: result,
        message: `Stock opname updated successfully to ${result.status}`,
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log.error('Unhandled error in PATCH /api/v1/stock-opname', { error: errorMessage, wmsId });

    await logActivity({
      action: 'WMS_UPDATE_STOCK_OPNAME',
      description: 'Failed to update stock opname - system error',
      status: 'error',
      metadata: { wms_id: wmsId, error: errorMessage },
    });

    return NextResponse.json(
      {
        success: false,
        error: {
          message: errorMessage || 'Internal server error',
          code: 'INTERNAL_ERROR',
        },
      },
      { status: 500 }
    );
  }
}
