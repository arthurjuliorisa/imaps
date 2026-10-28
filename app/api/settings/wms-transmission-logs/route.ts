import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { serializeBigInt } from '@/lib/bigint-serializer';

import { buildWmsLogWhere, WmsLogFilterError } from '@/lib/wms-log-filters';

const ALLOWED_PAGE_SIZES = [5, 10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

export async function GET(request: NextRequest) {
  try {
    const authCheck = await checkAuth();
    if (!authCheck.authenticated) {
      return authCheck.response;
    }

    const { searchParams } = new URL(request.url);
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '', 10);
    // Keep the existing response behavior by default. The logs page opts out on
    // normal list requests and fetches this stable dropdown data separately.
    const metadataOnly = searchParams.get('metadata_only') === 'true';
    const includeFilterMetadata = metadataOnly || searchParams.get('include_filters') !== 'false';

    // Pagination parameters
    const page = Math.max(rawPage, 1);
    const limit = ALLOWED_PAGE_SIZES.includes(rawLimit as typeof ALLOWED_PAGE_SIZES[number])
      ? rawLimit
      : DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * limit;

    const where = buildWmsLogWhere(searchParams, authCheck.session);

    // Filter options use the authorized date/company dataset, independently of
    // the current page and selected list filters.
    const filterMetadataWhere = { ...where };
    delete filterMetadataWhere.wms_id;
    delete filterMetadataWhere.action;
    delete filterMetadataWhere.error_type;
    delete filterMetadataWhere.transmission_status;

    if (metadataOnly) {
      const [actions, transmissionStatuses, errorTypes] = await Promise.all([
        prisma.wms_transmission_logs.findMany({
          where: filterMetadataWhere,
          distinct: ['action'],
          select: { action: true },
        }),
        prisma.wms_transmission_logs.findMany({
          where: filterMetadataWhere,
          distinct: ['transmission_status'],
          select: { transmission_status: true },
        }),
        prisma.wms_transmission_logs.findMany({
          where: { ...filterMetadataWhere, error_type: { not: null } },
          distinct: ['error_type'],
          select: { error_type: true },
        }),
      ]);

      return NextResponse.json({
        success: true,
        filters: {
          actions: actions.map(({ action }) => action).sort(),
          transmissionStatuses: transmissionStatuses
            .map(({ transmission_status }) => transmission_status)
            .sort(),
          errorTypes: errorTypes
            .map(({ error_type }) => error_type)
            .filter((errorType): errorType is string => errorType !== null)
            .sort(),
        },
      });
    }

    // Preserve the original combined response for callers that do not opt out.
    if (includeFilterMetadata) {
      const [logs, total, actions, transmissionStatuses, errorTypes] = await Promise.all([
        prisma.wms_transmission_logs.findMany({
          where,
          take: limit,
          skip: offset,
          orderBy: { created_at: 'desc' },
        }),
        prisma.wms_transmission_logs.count({ where }),
        prisma.wms_transmission_logs.findMany({ where: filterMetadataWhere, distinct: ['action'], select: { action: true } }),
        prisma.wms_transmission_logs.findMany({ where: filterMetadataWhere, distinct: ['transmission_status'], select: { transmission_status: true } }),
        prisma.wms_transmission_logs.findMany({ where: { ...filterMetadataWhere, error_type: { not: null } }, distinct: ['error_type'], select: { error_type: true } }),
      ]);
      const totalPages = Math.ceil(total / limit);

      return NextResponse.json({
        success: true,
        data: serializeBigInt(logs),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          actions: actions.map(({ action }) => action).sort(),
          transmissionStatuses: transmissionStatuses.map(({ transmission_status }) => transmission_status).sort(),
          errorTypes: errorTypes.map(({ error_type }) => error_type).filter((errorType): errorType is string => errorType !== null).sort(),
        },
      });
    }

    // Normal pagination needs only the page and its filtered count. The UI
    // fetches stable dropdown metadata separately.
    const [logs, total] = await Promise.all([
      prisma.wms_transmission_logs.findMany({
        where,
        take: limit,
        skip: offset,
        orderBy: { created_at: 'desc' },
      }),
      prisma.wms_transmission_logs.count({ where }),
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      success: true,
      data: serializeBigInt(logs),
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
    if (error instanceof WmsLogFilterError) return NextResponse.json({ success: false, data: [], error: error.message }, { status: error.status });
    console.error('[API Error] Failed to fetch WMS transmission logs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch WMS transmission logs' },
      { status: 500 }
    );
  }
}
