/**
 * INSW UOM Export Endpoint
 * File: app/api/insw/uom/export/route.ts
 */

import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import {
  streamExcelExport,
  ColumnConfig,
  ExportError,
  validateExportRequest,
  ExcelFormatters,
  captureExportStats,
} from '@/lib/streaming-export';

// Configuration
const MAX_EXPORT_ROWS = 100000;
const CHUNK_SIZE = 5000;
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds

/**
 * GET /api/insw/uom/export
 * 
 * Query parameters:
 * - format: 'xlsx' | 'csv' (default: xlsx)
 * - search: Filter by kode or uraian
 * - is_active: Filter by active status (true|false)
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

    // ==================== PARSE QUERY PARAMS ====================
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get('format') || 'xlsx') as 'xlsx' | 'csv';
    const search = searchParams.get('search') || '';
    const isActive = searchParams.get('is_active');

    // ==================== BUILD WHERE CLAUSE ====================
    const where: any = {};

    if (search) {
      where.OR = [
        { kode: { contains: search, mode: 'insensitive' } },
        { uraian: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (isActive !== null && isActive !== undefined) {
      where.is_active = isActive === 'true';
    }

    // ==================== COUNT TOTAL ROWS ====================
    console.log('[Export] Counting total records...');
    const totalCount = await prisma.insw_uom_reference.count({ where });

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
      { header: 'Kode', key: 'kode', width: 15 },
      { header: 'Uraian', key: 'uraian', width: 40 },
      { header: 'Status', key: 'is_active', width: 12 },
      { header: 'Created At', key: 'created_at', width: 20, format: ExcelFormatters.datetime },
      { header: 'Updated At', key: 'updated_at', width: 20, format: ExcelFormatters.datetime },
    ];

    // ==================== QUERY FUNCTION ====================
    const queryFn = async (skip: number, take: number) => {
      const data = await prisma.insw_uom_reference.findMany({
        where,
        orderBy: { kode: 'asc' },
        skip,
        take,
      });

      // Transform to export format
      return data.map((item, index) => ({
        no: skip + index + 1,
        kode: item.kode,
        uraian: item.uraian,
        is_active: item.is_active ? 'ACTIVE' : 'INACTIVE',
        created_at: item.created_at,
        updated_at: item.updated_at,
      }));
    };

    // ==================== GENERATE EXPORT ====================
    console.log(`[Export] Starting ${format.toUpperCase()} export...`);

    const fileName = `insw-uom-${new Date().toISOString().split('T')[0]}`;
    let responseBody: Uint8Array | string;
    let fileSize: number;
    let contentType: string;

    if (format === 'xlsx') {
      const { buffer: result } = await captureExportStats(fileName, async () =>
        streamExcelExport(queryFn, columns, 'INSW UOM', {
          chunkSize: CHUNK_SIZE,
          maxRows: MAX_EXPORT_ROWS,
        })
      );
      // Convert Buffer to Uint8Array for Response compatibility
      responseBody = new Uint8Array(result as Buffer);
      fileSize = responseBody.length;
      contentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    } else {
      const { buffer: result } = await captureExportStats(fileName, async () =>
        streamExcelExport(queryFn, columns, 'INSW UOM', {
          chunkSize: CHUNK_SIZE,
          maxRows: MAX_EXPORT_ROWS,
        })
      );
      responseBody = new Uint8Array(result as Buffer) as any;
      fileSize = responseBody.length;
      contentType = 'text/csv;charset=utf-8';
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
