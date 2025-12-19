import { NextResponse } from 'next/server';

/**
 * Success response formatter
 */
export const successResponse = (data: Record<string, any>, statusCode: number = 200) => {
  return NextResponse.json(data, { status: statusCode });
};

/**
 * Error response formatter
 */
export const errorResponse = (
  message: string,
  statusCode: number = 500,
  details?: Record<string, any>
) => {
  return NextResponse.json(
    {
      success: false,
      error: {
        message,
        ...details,
      },
    },
    { status: statusCode }
  );
};

/**
 * Validation error response (for API contract format)
 */
export const validationErrorResponse = (
  wmsId: string,
  errors: Array<{
    location: 'header' | 'item';
    field: string;
    code: string;
    message: string;
    item_index?: number;
    item_code?: string;
  }>
) => {
  return NextResponse.json(
    {
      status: 'failed',
      message: 'Validation failed',
      wms_id: wmsId,
      errors,
    },
    { status: 400 }
  );
};

/**
 * Success response for real-time endpoints
 */
export const transactionSuccessResponse = (
  wmsId: string,
  itemsCount: number,
  validatedAt: string = new Date().toISOString()
) => {
  return NextResponse.json(
    {
      status: 'success',
      message: 'Transaction validated and queued for processing',
      wms_id: wmsId,
      queued_items_count: itemsCount,
      validated_at: validatedAt,
    },
    { status: 200 }
  );
};

/**
 * Batch success response (partial success)
 */
export const batchSuccessResponse = (
  totalRecords: number,
  successCount: number,
  failedCount: number,
  failedRecords: Array<any> = [],
  validatedAt: string = new Date().toISOString()
) => {
  const status = failedCount === 0 ? 'success' : failedCount === totalRecords ? 'failed' : 'partial_success';
  const message =
    failedCount === 0
      ? 'All records validated and queued for processing'
      : failedCount === totalRecords
      ? 'All records failed validation'
      : `${failedCount} out of ${totalRecords} records failed validation`;

  return NextResponse.json(
    {
      status,
      message,
      summary: {
        total_records: totalRecords,
        success_count: successCount,
        failed_count: failedCount,
      },
      validated_at: validatedAt,
      ...(failedRecords.length > 0 && { failed_records: failedRecords }),
    },
    { status: failedCount === totalRecords ? 400 : 200 }
  );
};