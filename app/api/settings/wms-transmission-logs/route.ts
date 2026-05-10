import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';

const WMS_ACTION_ENDPOINT_MAP: Record<string, string> = {
  WMS_PROCESS_INCOMING_GOODS: '/api/v1/incoming-goods',
  WMS_PROCESS_MATERIAL_USAGE: '/api/v1/material-usage',
  WMS_PROCESS_WIP_BALANCE: '/api/v1/wip-balance',
  WMS_PROCESS_PRODUCTION_OUTPUT: '/api/v1/production-output',
  WMS_PROCESS_OUTGOING_GOODS: '/api/v1/outgoing-goods',
  WMS_PROCESS_ADJUSTMENTS: '/api/v1/adjustments',
  WMS_CREATE_STOCK_OPNAME: '/api/v1/stock-opname',
  WMS_UPDATE_STOCK_OPNAME: '/api/v1/stock-opname',
};

function processingKey(endpoint: string | null | undefined, companyCode: number | null | undefined, wmsId: string | null | undefined) {
  return `${endpoint || ''}|${companyCode || ''}|${wmsId || ''}`;
}

export async function GET(request: NextRequest) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const session = authCheck.session as any;
    const userCompanyCode = session?.user?.companyCode;
    const userRole = session?.user?.role;
    const isSuperAdmin = userRole === 'SUPER_ADMIN';

    const { searchParams } = new URL(request.url);
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '50', 10);
    const dateFrom = searchParams.get('date_from');
    const dateTo = searchParams.get('date_to');
    const actionFilter = searchParams.get('action');
    const errorTypeFilter = searchParams.get('error_type');
    const transmissionStatusFilter = searchParams.get('transmission_status');
    const companyCodeFilter = searchParams.get('company_code');

    // Pagination parameters
    const page = Math.max(rawPage, 1);
    const limit = Math.min(Math.max(rawLimit, 10), 500);
    const offset = (page - 1) * limit;

    // Build where clause
    const where: any = {};

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) where.created_at.gte = new Date(dateFrom);
      if (dateTo) where.created_at.lte = new Date(dateTo);
    }

    if (actionFilter && actionFilter !== 'ALL') {
      where.action = { contains: actionFilter };
    }

    if (errorTypeFilter && errorTypeFilter !== 'ALL') {
      where.error_type = errorTypeFilter;
    }

    if (transmissionStatusFilter && transmissionStatusFilter !== 'ALL') {
      where.transmission_status = transmissionStatusFilter;
    }

    // ===================== COMPANY FILTERING LOGIC =====================
    // SUPER_ADMIN can view all WMS logs or filter by specific company
    // Non-SUPER_ADMIN can only view logs from their assigned company
    if (companyCodeFilter && companyCodeFilter !== 'ALL') {
      const requestedCompanyCode = parseInt(companyCodeFilter, 10);

      // Authorization check: prevent non-SUPER_ADMIN from accessing other companies
      if (!isSuperAdmin && requestedCompanyCode !== parseInt(userCompanyCode || '0', 10)) {
        return NextResponse.json(
          { success: false, data: [], error: 'Unauthorized - cannot access other company logs' },
          { status: 403 }
        );
      }

      where.company_code = requestedCompanyCode;
    } else if (!isSuperAdmin && userCompanyCode) {
      // Non-SUPER_ADMIN users always see only their company's logs by default
      where.company_code = parseInt(userCompanyCode, 10);
    }
    // SUPER_ADMIN with no company filter: see all company logs (no where clause)

    // Fetch logs
    const [logs, total] = await Promise.all([
      prisma.wms_transmission_logs.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { created_at: 'desc' },
      }),
      prisma.wms_transmission_logs.count({ where }),
    ]);

    const wmsIds = [...new Set(logs.map((log) => log.wms_id).filter((wmsId): wmsId is string => !!wmsId))];
    const endpoints = [...new Set(logs.map((log) => WMS_ACTION_ENDPOINT_MAP[log.action]).filter((endpoint): endpoint is string => !!endpoint))];

    const processingLogs = wmsIds.length > 0 && endpoints.length > 0
      ? await prisma.wms_processing_logs.findMany({
          where: {
            wms_id: { in: wmsIds },
            endpoint: { in: endpoints },
          },
          orderBy: { created_at: 'desc' },
        })
      : [];

    const processingByKey = new Map<string, any>();
    for (const processingLog of processingLogs) {
      const key = processingKey(processingLog.endpoint, processingLog.company_code, processingLog.wms_id);
      if (!processingByKey.has(key)) {
        processingByKey.set(key, processingLog);
      }
    }

    const logsWithProcessing = logs.map((log) => {
      const endpoint = WMS_ACTION_ENDPOINT_MAP[log.action] || null;
      const processingLog = processingByKey.get(processingKey(endpoint, log.company_code, log.wms_id));

      return {
        ...log,
        backend_processing_status: processingLog?.backend_processing_status || null,
        backend_processing_started_at: processingLog?.backend_processing_started_at || null,
        backend_processing_finished_at: processingLog?.backend_processing_finished_at || null,
        transmitted_item_count: processingLog?.transmitted_item_count ?? null,
        validated_item_count: processingLog?.validated_item_count ?? null,
        queued_item_count: processingLog?.queued_item_count ?? null,
        inserted_item_count: processingLog?.inserted_item_count ?? null,
        updated_item_count: processingLog?.updated_item_count ?? null,
        failed_item_count: processingLog?.failed_item_count ?? null,
        backend_error_message: processingLog?.error_message || null,
      };
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      success: true,
      data: serializeBigInt(logsWithProcessing),
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPrevPage,
      },
    });
  } catch (error) {
    console.error('[API Error] Failed to fetch WMS transmission logs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch WMS transmission logs' },
      { status: 500 }
    );
  }
}
