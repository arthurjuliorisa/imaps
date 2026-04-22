/**
 * EXAMPLE IMPLEMENTATION: Activity Logs Export
 * File: app/api/settings/activity-logs/export/route.ts
 * 
 * Shows how to use streaming export for large datasets
 */

import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import {
  streamExcelExport,
  streamCSVExport,
  ColumnConfig,
  ExportError,
  validateExportRequest,
  ExcelFormatters,
  captureExportStats,
} from '@/lib/streaming-export';

// Configuration
const MAX_EXPORT_ROWS = 1000000;
const CHUNK_SIZE = 5000;
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds

/**
 * GET /api/settings/activity-logs/export
 * 
 * Query parameters:
 * - format: 'xlsx' | 'csv' (default: xlsx)
 * - search: Filter by action, description, user
 * - status: Filter by status
 * - companyCode: Filter by company (SUPER_ADMIN only)
 * - dateFrom: ISO date string
 * - dateTo: ISO date string
 */
export async function GET(request: NextRequest) {
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), REQUEST_TIMEOUT_MS);

  try {
    // ==================== AUTHENTICATION ====================
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const session = authCheck.session as any;
    const userCompanyCode = session?.user?.companyCode;
    const userRole = session?.user?.role;
    const userId = session?.user?.id;

    // ==================== PARSE QUERY PARAMS ====================
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'xlsx') as 'xlsx' | 'csv';
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status') || '';
    const companyCodeParam = searchParams.get('companyCode');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    // Validate company code filter
    const isSuperAdmin = userRole === 'SUPER_ADMIN';
    const filterCompanyCode = isSuperAdmin ? companyCodeParam : userCompanyCode;

    if (!isSuperAdmin && companyCodeParam && companyCodeParam !== userCompanyCode) {
      return NextResponse.json(
        { error: 'Unauthorized to export other company data' },
        { status: 403 }
      );
    }

    // ==================== BUILD WHERE CLAUSE ====================
    const where: any = {};

    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { users: { email: { contains: search, mode: 'insensitive' } } },
        { users: { username: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (status && status !== 'ALL') {
      where.status = status.toLowerCase();
    }

    if (filterCompanyCode) {
      where.company_code = parseInt(filterCompanyCode);
    }

    if (dateFrom || dateTo) {
      where.created_at = {};
      if (dateFrom) {
        where.created_at.gte = new Date(dateFrom);
      }
      if (dateTo) {
        // Include entire end date
        const endDate = new Date(dateTo);
        endDate.setHours(23, 59, 59, 999);
        where.created_at.lte = endDate;
      }
    }

    // ==================== COUNT TOTAL ROWS ====================
    console.log('[Export] Counting total records...');
    const totalCount = await prisma.activity_logs.count({ where });

    // Validate export size
    try {
      validateExportRequest(totalCount, MAX_EXPORT_ROWS);
    } catch (error) {
      if (error instanceof ExportError) {
        return NextResponse.json(
          {
            error: error.message,
            code: error.code,
            totalCount,
            maxLimit: MAX_EXPORT_ROWS,
          },
          { status: error.statusCode }
        );
      }
      throw error;
    }

    // ==================== COLUMN CONFIGURATION ====================
    const columns: ColumnConfig[] = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tanggal & Waktu', key: 'created_at', width: 22, format: ExcelFormatters.datetime },
      { header: 'Kode Perusahaan', key: 'company_code', width: 15 },
      { header: 'User', key: 'username', width: 15 },
      { header: 'Email', key: 'email', width: 25 },
      { header: 'Aksi', key: 'action', width: 20 },
      { header: 'Deskripsi', key: 'description', width: 40 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'IP Address', key: 'ip_address', width: 18 },
    ];

    // ==================== QUERY FUNCTION ====================
    const queryFn = async (skip: number, take: number) => {
      const logs = await prisma.activity_logs.findMany({
        where,
        select: {
          id: true,
          created_at: true,
          company_code: true,
          action: true,
          description: true,
          status: true,
          ip_address: true,
          users: {
            select: {
              username: true,
              email: true,
            },
          },
        },
        orderBy: {
          created_at: 'desc',
        },
        skip,
        take,
      });

      // Transform to export format
      return logs.map((log, index) => ({
        no: skip + index + 1,
        created_at: log.created_at,
        company_code: log.company_code?.toString() || '-',
        username: log.users?.username || 'System',
        email: log.users?.email || '-',
        action: log.action,
        description: log.description,
        status: log.status,
        ip_address: log.ip_address || '-',
      }));
    };

    // ==================== GENERATE EXPORT ====================
    console.log(`[Export] Starting ${format.toUpperCase()} export...`);

    const fileName = `activity-logs-${new Date().toISOString().split('T')[0]}`;
    let responseBody: Uint8Array | string;
    let fileSize: number;
    let contentType: string;

    if (format === 'xlsx') {
      const { buffer: result } = await captureExportStats(fileName, async () =>
        streamExcelExport(queryFn, columns, 'Activity Logs', {
          chunkSize: CHUNK_SIZE,
          maxRows: MAX_EXPORT_ROWS,
        })
      );
      // Convert Buffer to Uint8Array for Response compatibility
      responseBody = new Uint8Array(result as Buffer);
      fileSize = responseBody.length;
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      const csv = await streamCSVExport(queryFn, columns, CHUNK_SIZE);
      responseBody = csv;
      fileSize = csv.length;
      contentType = 'text/csv;charset=utf-8';
    }

    // ==================== LOG EXPORT ACTIVITY ====================
    try {
      const companyCodeForLog = filterCompanyCode ? parseInt(filterCompanyCode) : userCompanyCode;
      await prisma.activity_logs.create({
        data: {
          user_id: userId,
          company_code: companyCodeForLog,
          action: 'EXPORT',
          description: `Exported ${totalCount} activity logs to ${format.toUpperCase()}`,
          status: 'success',
          ip_address: request.headers.get('x-forwarded-for') || 'unknown',
          user_agent: request.headers.get('user-agent') || 'unknown',
          metadata: {
            format,
            total_rows: totalCount,
            file_size: fileSize,
          },
        },
      });
    } catch (error) {
      console.error('[Export] Failed to log export activity:', error);
      // Don't fail the export if logging fails
    }

    // ==================== RETURN RESPONSE ====================
    const extension = format === 'xlsx' ? 'xlsx' : 'csv';

    return new Response(responseBody as any, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${fileName}.${extension}"`,
        'Content-Length': fileSize.toString(),
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'X-Total-Rows': totalCount.toString(),
      },
    } as any);
  } catch (error) {
    console.error('[Export Error]', error);

    if (error instanceof ExportError) {
      return NextResponse.json(
        { error: error.message, code: error.code },
        { status: error.statusCode }
      );
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Export timeout. Please try with a smaller date range.' },
        { status: 408 }
      );
    }

    if (error instanceof Error) {
      if (error.message.includes('Out of memory')) {
        return NextResponse.json(
          { error: 'Export too large. Please filter your data.' },
          { status: 413 }
        );
      }
    }

    return NextResponse.json(
      { error: 'Export failed. Please try again.' },
      { status: 500 }
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * POST /api/settings/activity-logs/export
 * For bulk exports with custom configuration
 */
export async function POST(request: NextRequest) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const body = await request.json();
    const {
      format = 'xlsx',
      columns: requestedColumns,
      filters,
    } = body;

    // Validate requested columns
    if (requestedColumns && !Array.isArray(requestedColumns)) {
      return NextResponse.json(
        { error: 'columns must be an array' },
        { status: 400 }
      );
    }

    // Use requested columns or default
    const defaultColumns: ColumnConfig[] = [
      { header: 'Tanggal & Waktu', key: 'created_at', width: 22 },
      { header: 'User', key: 'username', width: 15 },
      { header: 'Aksi', key: 'action', width: 20 },
      { header: 'Status', key: 'status', width: 12 },
    ];

    // Build query params from body filters
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.dateFrom) params.append('dateFrom', filters.dateFrom);
    if (filters?.dateTo) params.append('dateTo', filters.dateTo);
    params.append('format', format);

    // Redirect to GET with query params
    const url = new URL(request.url);
    url.search = params.toString();

    return GET(new NextRequest(url));
  } catch (error) {
    console.error('[Export POST Error]', error);
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 }
    );
  }
}
