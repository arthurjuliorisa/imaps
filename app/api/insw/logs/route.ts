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
 * - transaction_type: incoming | outgoing (optional)
 * - insw_status: PENDING | SENT | SUCCESS | FAILED | SKIPPED (optional)
 * - page: number (optional, default 1)
 * - limit: number (optional, default 50, min 10, max 500)
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
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');

    // Pagination parameters
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 10), 500);
    const offset = (page - 1) * limit;

    const useTestMode = process.env.INSW_USE_TEST_MODE === 'true';
    const service = new INSWTransmissionService(useTestMode);

    // Get total count
    const totalCount = await service.countTransmissionLogs({
      company_code: companyCode,
      transaction_type: transactionType || undefined,
      insw_status: inswStatus || undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    });

    // Get paginated logs
    const logs = await service.getTransmissionLogs({
      company_code: companyCode,
      transaction_type: transactionType || undefined,
      insw_status: inswStatus || undefined,
      limit,
      offset,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
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
        pagination: { page: 1, limit: 50, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
      },
      { status: 500 }
    );
  }
}
