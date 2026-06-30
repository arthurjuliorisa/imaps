import { NextResponse } from 'next/server';
import { AdjustmentType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAuth } from '@/lib/api-auth';
import { validateCompanyCode } from '@/lib/company-validation';
import { serializeBigInt } from '@/lib/bigint-serializer';

function getDateParam(searchParams: URLSearchParams, key: string): Date | undefined {
  const value = searchParams.get(key);
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function getDirectionWhere(direction: string | null) {
  if (direction === 'GAIN') {
    return {
      items: { some: { adjustment_type: AdjustmentType.GAIN, deleted_at: null } },
      NOT: { items: { some: { adjustment_type: AdjustmentType.LOSS, deleted_at: null } } },
    };
  }

  if (direction === 'LOSS') {
    return {
      items: { some: { adjustment_type: AdjustmentType.LOSS, deleted_at: null } },
      NOT: { items: { some: { adjustment_type: AdjustmentType.GAIN, deleted_at: null } } },
    };
  }

  if (direction === 'Mixed') {
    return {
      AND: [
        { items: { some: { adjustment_type: AdjustmentType.GAIN, deleted_at: null } } },
        { items: { some: { adjustment_type: AdjustmentType.LOSS, deleted_at: null } } },
      ],
    };
  }

  return {};
}

function summarizeDirection(items: Array<{ adjustment_type: AdjustmentType }>): 'GAIN' | 'LOSS' | 'Mixed' {
  const hasGain = items.some((item) => item.adjustment_type === AdjustmentType.GAIN);
  const hasLoss = items.some((item) => item.adjustment_type === AdjustmentType.LOSS);
  if (hasGain && hasLoss) return 'Mixed';
  return hasGain ? 'GAIN' : 'LOSS';
}

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
    const page = Math.max(Number(searchParams.get('page') || 1), 1);
    const pageSize = Math.min(Math.max(Number(searchParams.get('pageSize') || 10), 1), 100);
    const startDate = getDateParam(searchParams, 'startDate');
    const endDate = getDateParam(searchParams, 'endDate');
    const wmsId = searchParams.get('wmsId')?.trim();
    const internalEvidenceNumber = searchParams.get('internalEvidenceNumber')?.trim();
    const itemCode = searchParams.get('itemCode')?.trim();
    const itemName = searchParams.get('itemName')?.trim();
    const direction = searchParams.get('direction');
    const inswStatus = searchParams.get('inswStatus')?.trim();

    const andFilters: any[] = [getDirectionWhere(direction)];
    const where: any = {
      company_code: companyCode,
      wms_doc_type: 'revise_adjustment',
      deleted_at: null,
    };

    if (startDate || endDate) {
      where.transaction_date = {};
      if (startDate) where.transaction_date.gte = startDate;
      if (endDate) where.transaction_date.lte = endDate;
    }
    if (wmsId) andFilters.push({ wms_id: { contains: wmsId, mode: 'insensitive' } });
    if (internalEvidenceNumber) {
      where.internal_evidence_number = { contains: internalEvidenceNumber, mode: 'insensitive' };
    }
    if (itemCode || itemName) {
      andFilters.push({
        items: {
          some: {
            deleted_at: null,
            ...(itemCode ? { item_code: { contains: itemCode, mode: 'insensitive' } } : {}),
            ...(itemName ? { item_name: { contains: itemName, mode: 'insensitive' } } : {}),
          },
        },
      });
    }

    if (inswStatus) {
      const matchingLogs = await prisma.insw_tracking_log.findMany({
        where: {
          company_code: companyCode,
          transaction_type: 'adjustment',
          insw_status: inswStatus,
        },
        select: { wms_id: true },
      });
      andFilters.push({
        wms_id: {
          in: matchingLogs.map((log) => log.wms_id).filter(Boolean) as string[],
        },
      });
    }

    if (andFilters.length > 0) {
      where.AND = andFilters;
    }

    const [total, rows] = await Promise.all([
      prisma.adjustments.count({ where }),
      prisma.adjustments.findMany({
        where,
        orderBy: [{ transaction_date: 'desc' }, { created_at: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          company: { select: { name: true } },
          items: {
            where: { deleted_at: null },
            select: {
              adjustment_type: true,
              qty: true,
            },
          },
        },
      }),
    ]);

    const wmsIds = rows.map((row) => row.wms_id);
    const logs = await prisma.insw_tracking_log.findMany({
      where: {
        company_code: companyCode,
        transaction_type: 'adjustment',
        wms_id: { in: wmsIds },
      },
      orderBy: { created_at: 'desc' },
      select: {
        wms_id: true,
        insw_status: true,
        insw_activity_code: true,
        sent_at: true,
        insw_error: true,
      },
    });

    const latestLogByWmsId = new Map<string, (typeof logs)[number]>();
    logs.forEach((log) => {
      if (log.wms_id && !latestLogByWmsId.has(log.wms_id)) {
        latestLogByWmsId.set(log.wms_id, log);
      }
    });

    const data = rows.map((row) => {
      const gainQty = row.items
        .filter((item) => item.adjustment_type === AdjustmentType.GAIN)
        .reduce((sum, item) => sum + Number(item.qty), 0);
      const lossQty = row.items
        .filter((item) => item.adjustment_type === AdjustmentType.LOSS)
        .reduce((sum, item) => sum + Number(item.qty), 0);
      const latestLog = latestLogByWmsId.get(row.wms_id);

      return {
        id: row.id,
        transactionDate: row.transaction_date,
        wmsId: row.wms_id,
        internalEvidenceNumber: row.internal_evidence_number,
        companyCode: row.company_code,
        companyName: row.company?.name || '',
        owner: row.owner,
        directionSummary: summarizeDirection(row.items),
        itemCount: row.items.length,
        totalGainQty: gainQty,
        totalLossQty: lossQty,
        createdAt: row.created_at,
        inswStatus: latestLog?.insw_status || null,
        inswActivityCode: latestLog?.insw_activity_code || null,
        inswSentAt: latestLog?.sent_at || null,
        inswError: latestLog?.insw_error || null,
      };
    });

    return NextResponse.json(serializeBigInt({
      data,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    }));
  } catch (error: any) {
    console.error('[API Error] Failed to fetch reversal records:', error);
    return NextResponse.json(
      { message: 'Error fetching reversal records', error: error.message },
      { status: 500 }
    );
  }
}
