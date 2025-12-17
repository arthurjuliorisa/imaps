// app/api/v1/wip-balance/route.ts

/**
 * WIP Balance API Endpoint
 * 
 * POST /api/v1/wip-balance
 * 
 * Purpose:
 * - Accept daily WIP balance snapshot from WMS
 * - Support batch processing with partial success
 * - Return comprehensive validation results
 * 
 * Authentication:
 * - API Key + IP Whitelist (handled by middleware)
 * 
 * Request Structure:
 * - Batch array: { records: [...] }
 * - Each record is independent (different wms_id)
 * 
 * Response Structure:
 * - HTTP 200: Success or Partial Success
 * - HTTP 400: Complete Failure (all records invalid)
 * - HTTP 500: Server Error
 * 
 * Key Features:
 * - Synchronous validation (immediate response)
 * - Asynchronous database insert (queued, non-blocking)
 * - Partial success allowed (valid records processed, invalid returned)
 * - Idempotent (safe to retry using wms_id)
 */

import { NextRequest, NextResponse } from 'next/server';
import { wipBalanceService } from '@/lib/services/wip-balance.service';

/**
 * POST /api/v1/wip-balance
 * 
 * Process batch of WIP balance records
 */
export async function POST(request: NextRequest) {
  try {
    // Step 1: Parse request body
    let payload: unknown;
    try {
      payload = await request.json();
    } catch (error) {
      return NextResponse.json(
        {
          status: 'failed',
          message: 'Invalid JSON payload',
          summary: {
            total_records: 0,
            success_count: 0,
            failed_count: 0,
          },
          validated_at: new Date().toISOString(),
          failed_records: [
            {
              wms_id: 'PARSE_ERROR',
              row_index: 0,
              errors: [
                {
                  field: 'body',
                  code: 'INVALID_JSON',
                  message: 'Request body must be valid JSON',
                },
              ],
            },
          ],
        },
        { status: 400 }
      );
    }

    // Step 2: Process batch through service
    const result = await wipBalanceService.processBatch(payload);

    // Step 3: Determine HTTP status code
    // - All success or partial success: HTTP 200
    // - Complete failure: HTTP 400
    const statusCode = result.status === 'failed' ? 400 : 200;

    // Step 4: Return response
    return NextResponse.json(result, { status: statusCode });
  } catch (error) {
    // Unexpected server error
    console.error('Unexpected error in WIP Balance API:', error);

    return NextResponse.json(
      {
        status: 'failed',
        message: 'Internal server error',
        summary: {
          total_records: 0,
          success_count: 0,
          failed_count: 0,
        },
        validated_at: new Date().toISOString(),
        failed_records: [
          {
            wms_id: 'SERVER_ERROR',
            row_index: 0,
            errors: [
              {
                field: 'server',
                code: 'INTERNAL_ERROR',
                message:
                  error instanceof Error ? error.message : 'Unknown server error',
              },
            ],
          },
        ],
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/v1/wip-balance
 * 
 * Query WIP balance records (for debugging/verification)
 * 
 * Query params:
 * - company_code (required): Company code
 * - stock_date (required): Stock date (YYYY-MM-DD)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const companyCodeParam = searchParams.get('company_code');
    const stockDateParam = searchParams.get('stock_date');

    // Validate required parameters
    if (!companyCodeParam || !stockDateParam) {
      return NextResponse.json(
        {
          success: false,
          message: 'Missing required parameters: company_code and stock_date',
        },
        { status: 400 }
      );
    }

    // Parse and validate company code
    const companyCode = parseInt(companyCodeParam, 10);
    if (isNaN(companyCode) || ![1370, 1310, 1380].includes(companyCode)) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid company_code. Must be 1370, 1310, or 1380',
        },
        { status: 400 }
      );
    }

    // Parse and validate stock date
    const stockDate = new Date(stockDateParam);
    if (isNaN(stockDate.getTime())) {
      return NextResponse.json(
        {
          success: false,
          message: 'Invalid stock_date. Must be in YYYY-MM-DD format',
        },
        { status: 400 }
      );
    }

    // Fetch records
    const records = await wipBalanceService.getByDate(companyCode, stockDate);

    return NextResponse.json(
      {
        success: true,
        data: records,
        count: records.length,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in WIP Balance GET endpoint:', error);

    return NextResponse.json(
      {
        success: false,
        message: 'Internal server error',
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
