import { NextResponse } from 'next/server';
import { INSWTransmissionService } from '@/lib/services/insw-transmission.service';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';

/**
 * GET /api/insw/logs
 *
 * Get INSW transmission logs from insw_tracking_log table
 *
 * Query Parameters:
 * - transaction_type, insw_status, wms_id (optional)
 * - page: number (optional, default 1)
 * - limit: 5 | 10 | 25 | 50 (optional, default 10)
 * - date_from: YYYY-MM-DD (optional)
 * - date_to: YYYY-MM-DD (optional)
 *
 * Response:
 * {
 *   "success": true,
 *   "data": [...],
 *   "pagination": { page, limit, total, totalPages, hasNextPage, hasPrevPage }
 * }
 */
export async function GET(request: Request) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { session } = authCheck as { authenticated: true; session: any };
    const companyValidation = validateCompanyCode(session);
    if (!companyValidation.success) {
      return companyValidation.response;
    }

    const { companyCode } = companyValidation;
    const { searchParams } = new URL(request.url);

    const transactionType = searchParams.get('transaction_type');
    const inswStatus = searchParams.get('insw_status');
    const rawPage = Number(searchParams.get('page'));
    const rawLimit = Number(searchParams.get('limit'));
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const wmsId = searchParams.get('wms_id')?.trim();

    const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
    const allowedLimits = [5, 10, 25, 50];
    const limit = allowedLimits.includes(rawLimit) ? rawLimit : 10;
    const offset = (page - 1) * limit;
    const service = new INSWTransmissionService();

    // Resolve technical-claim visibility once, then run count and rows together.
    const { total: totalCount, logs } = await service.getTransmissionLogPage({
      company_code: companyCode,
      transaction_type: transactionType || undefined,
      insw_status: inswStatus || undefined,
      wms_id: wmsId || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      limit,
      offset,
    });

    // Transform BigInt fields to strings for JSON serialization
    const serializedLogs = logs.map((log) => ({
      ...log,
      id: log.id.toString(),
    }));

    // Calculate pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      success: true,
      data: serializedLogs,
      pagination: {
        page,
        limit,
        total: totalCount,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error: any) {
    console.error('Error getting INSW logs:', error);
    return NextResponse.json(
      {
        success: false,
        error: error.message,
        data: [],
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
      },
      { status: 500 }
    );
  }
}
