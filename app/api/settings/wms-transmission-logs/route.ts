import { WMS_INSW_STATUSES } from '@/lib/wms-insw-status-options';
import { Prisma, type wms_transmission_logs } from '@prisma/client';
import { bindWmsCsvFilters } from '@/lib/wms-log-sql';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkMenuAuth, resolveMenuGrants } from '@/lib/menu-auth';
import { wmsLogInswStatuses } from '@/lib/insw-queue/wms-log-status';
import { serializeBigInt } from '@/lib/bigint-serializer';

import { buildWmsLogWhere, WmsLogFilterError } from '@/lib/wms-log-filters';

const ALLOWED_PAGE_SIZES = [5, 10, 25, 50] as const;
const DEFAULT_PAGE_SIZE = 10;

export async function GET(request: NextRequest) {
  try {
    const authCheck = await checkMenuAuth('/settings/wms-logs');
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
    delete filterMetadataWhere.insw_status;
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
          inswStatuses: WMS_INSW_STATUSES,
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

    const enrich = async (logs: Awaited<ReturnType<typeof prisma.wms_transmission_logs.findMany>>) => {
      const [statuses, inswGrants] = await Promise.all([
        wmsLogInswStatuses(prisma, authCheck.session.user, logs.map(log => log.id)),
        resolveMenuGrants(authCheck.session, '/insw/logs'),
      ]);
      return logs.map(log => {
        const status = statuses.get(String(log.id));
        return status ? { ...log, insw: { ...status,
          canInspectRegeneration: authCheck.grants.canEdit,
          // INSW Logs uses the session company, even for SUPER_ADMIN.
          canViewInswLogs: inswGrants.canView && Number(authCheck.session.user.companyCode) === log.company_code,
        } } : log;
      });
    };

    // Both response variants share the same authorized predicate before count,
    // deterministic ordering and LIMIT/OFFSET. ALL retains the existing fast path.
    const { insw_status: inswStatus, ...ordinaryWhere } = where;
    const predicate = inswStatus ? bindWmsCsvFilters(where) : undefined;
    const listPage = () => predicate
      ? prisma.$queryRaw<wms_transmission_logs[]>(Prisma.sql`SELECT log.* FROM wms_transmission_logs log
          WHERE ${predicate} ORDER BY log.created_at DESC, log.id DESC LIMIT ${limit} OFFSET ${offset}`)
      : prisma.wms_transmission_logs.findMany({ where: ordinaryWhere, take: limit, skip: offset,
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }] });
    const countMatches = async () => {
      if (!predicate) return prisma.wms_transmission_logs.count({ where: ordinaryWhere });
      const [row] = await prisma.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT count(*) AS total
        FROM wms_transmission_logs log WHERE ${predicate}`);
      return Number(row.total);
    };

    // Preserve the original combined response for callers that do not opt out.
    if (includeFilterMetadata) {
      const [logs, total, actions, transmissionStatuses, errorTypes] = await Promise.all([
        listPage(),
        countMatches(),
        prisma.wms_transmission_logs.findMany({ where: filterMetadataWhere, distinct: ['action'], select: { action: true } }),
        prisma.wms_transmission_logs.findMany({ where: filterMetadataWhere, distinct: ['transmission_status'], select: { transmission_status: true } }),
        prisma.wms_transmission_logs.findMany({ where: { ...filterMetadataWhere, error_type: { not: null } }, distinct: ['error_type'], select: { error_type: true } }),
      ]);
      const totalPages = Math.ceil(total / limit);

      return NextResponse.json({
        success: true,
        data: serializeBigInt(await enrich(logs)),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
        filters: {
          inswStatuses: WMS_INSW_STATUSES,
          actions: actions.map(({ action }) => action).sort(),
          transmissionStatuses: transmissionStatuses.map(({ transmission_status }) => transmission_status).sort(),
          errorTypes: errorTypes.map(({ error_type }) => error_type).filter((errorType): errorType is string => errorType !== null).sort(),
        },
      });
    }

    // Normal pagination needs only the page and its filtered count. The UI
    // fetches stable dropdown metadata separately.
    const [logs, total] = await Promise.all([
      listPage(),
      countMatches(),
    ]);

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;

    return NextResponse.json({
      success: true,
      data: serializeBigInt(await enrich(logs)),
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
