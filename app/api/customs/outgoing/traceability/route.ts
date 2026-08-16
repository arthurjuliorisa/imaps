/**
 * Traceability API - Get item traceability data
 *
 * Endpoint: GET /api/customs/outgoing/traceability?item_ids=1,2,3&company_code=1001
 *
 * Returns traceability chain:
 * Outgoing Item -> Production Output -> Work Order -> ROH/HALB Materials -> Registration Numbers
 */

import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  traceabilityRepository,
  type TraceabilityDetailRow,
  type TraceabilityItem,
  type TraceabilityRecalculationStatus,
  type TraceabilitySummaryRow,
} from '@/lib/repositories/traceability.repository';
import type { ApiSuccessResponse, ApiErrorResponse } from '@/types/core';

/**
 * Build error response
 */
function errorResponse(message: string, code = 'ERROR', status = 400): NextResponse<ApiErrorResponse> {
  return NextResponse.json<ApiErrorResponse>(
    {
      success: false,
      error: code,
      message,
      timestamp: new Date().toISOString()
    },
    { status }
  );
}

/**
 * Build success response
 */
function successResponse<T>(data: T, status = 200): NextResponse<ApiSuccessResponse<T>> {
  return NextResponse.json<ApiSuccessResponse<T>>(
    {
      success: true,
      data,
      timestamp: new Date().toISOString()
    },
    { status }
  );
}

function isAdminRole(role?: string | null): boolean {
  return role === 'ADMIN' || role === 'SUPER_ADMIN' || role === 'SUPERADMIN';
}

function formatDisplayPPKEK(displayValue: string | null, bucketKey: string | null): string {
  const normalizedDisplayValue = displayValue?.trim();
  const normalizedDisplayKey = normalizedDisplayValue?.toLowerCase();

  if (
    !normalizedDisplayValue ||
    normalizedDisplayKey === 'n' ||
    normalizedDisplayKey === 'blank ppkek' ||
    bucketKey === 'LITERAL_N' ||
    bucketKey === 'BLANK' ||
    !bucketKey
  ) {
    return '-';
  }

  return normalizedDisplayValue;
}

function applyNetSummaryToLegacyItems(
  items: TraceabilityItem[],
  summaryRows: TraceabilitySummaryRow[]
): TraceabilityItem[] {
  const summaryByOutgoingItemId = new Map<number, TraceabilitySummaryRow[]>();

  for (const row of summaryRows) {
    const rows = summaryByOutgoingItemId.get(row.outgoing_good_item_id) || [];
    rows.push(row);
    summaryByOutgoingItemId.set(row.outgoing_good_item_id, rows);
  }

  return items.map((item) => {
    if (item.source_type !== 'production' || !item.outgoing_good_item_id) {
      return item;
    }

    const itemSummaryRows = summaryByOutgoingItemId.get(item.outgoing_good_item_id);
    if (!itemSummaryRows || itemSummaryRows.length === 0) {
      return item;
    }

    const existingWorkOrders = new Map(
      (item.work_orders || []).map((wo) => [wo.work_order_number, wo])
    );
    const existingMaterials = new Map(
      (item.work_orders || []).flatMap((wo) =>
        (wo.materials || []).map((material) => [
          `${wo.work_order_number}|${material.material_item_code}|${material.material_item_name}`,
          material,
        ] as const)
      )
    );

    const materialRowsByWorkOrder = new Map<string, TraceabilitySummaryRow[]>();

    for (const row of itemSummaryRows) {
      const workOrderNumber = row.work_order_number || '';
      const rows = materialRowsByWorkOrder.get(workOrderNumber) || [];
      rows.push(row);
      materialRowsByWorkOrder.set(workOrderNumber, rows);
    }

    const workOrders = Array.from(materialRowsByWorkOrder.entries())
      .map(([workOrderNumber, rows]) => {
        const materialsByKey = new Map<string, TraceabilitySummaryRow[]>();

        for (const row of rows) {
          const materialKey = [
            row.material_item_code || '',
            row.material_item_name || '',
            row.material_uom || '',
          ].join('|');
          const materialRows = materialsByKey.get(materialKey) || [];
          materialRows.push(row);
          materialsByKey.set(materialKey, materialRows);
        }

        const materials = Array.from(materialsByKey.entries())
          .map(([materialKey, materialRows]) => {
            const [materialCode, materialName, materialUom] = materialKey.split('|');
            const existingMaterial =
              existingMaterials.get(`${workOrderNumber}|${materialCode}|${materialName}`) ||
              existingMaterials.get(`${workOrderNumber}|${materialCode}|`);

            return {
              material_item_code: materialCode,
              material_item_name: materialName,
              consumption_ratio: existingMaterial?.consumption_ratio || 0,
              ppkeks: materialRows.map((row) => ({
                ppkek_number: formatDisplayPPKEK(row.display_ppkek_number, row.ppkek_bucket_key),
                customs_registration_date: row.customs_registration_date || '',
                customs_document_type: row.customs_document_type || '',
                incoming_date: row.incoming_date || '',
                qty_allocated: row.final_allocated_qty,
                qty_uom: row.material_uom || materialUom,
              })),
            };
          })
          .sort((a, b) => a.material_item_code.localeCompare(b.material_item_code));

        return {
          work_order_number: workOrderNumber,
          qty_per_wo: existingWorkOrders.get(workOrderNumber)?.qty_per_wo || 0,
          materials,
        };
      })
      .sort((a, b) => a.work_order_number.localeCompare(b.work_order_number));

    return {
      ...item,
      work_orders: workOrders,
    };
  });
}

// ============================================================================
// GET - Get traceability data for outgoing items
// ============================================================================

export async function GET(request: NextRequest) {
  try {
    // Check authentication
    const session = await getServerSession(authOptions);
    if (!session) {
      return errorResponse('Unauthorized', 'UNAUTHORIZED', 401);
    }
    const canViewMaterialTraceabilityDetails = isAdminRole(session.user?.role);

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const itemIdsParam = searchParams.get('item_ids');
    const companyCodeParam = searchParams.get('company_code');
    const outgoingGoodIdParam = searchParams.get('outgoing_good_id');

    // Validate parameters
    if (!itemIdsParam || !companyCodeParam) {
      return errorResponse(
        'Missing required parameters: item_ids and company_code',
        'INVALID_PARAMS',
        400
      );
    }

    // Parse item IDs
    const itemIds = itemIdsParam
      .split(',')
      .map((id) => parseInt(id.trim()))
      .filter((id) => !isNaN(id));

    if (itemIds.length === 0) {
      return errorResponse(
        'Invalid item_ids format. Expected comma-separated numbers.',
        'INVALID_PARAMS',
        400
      );
    }

    // Parse company code
    const companyCode = parseInt(companyCodeParam);
    if (isNaN(companyCode)) {
      return errorResponse(
        'Invalid company_code. Expected a number.',
        'INVALID_PARAMS',
        400
      );
    }

    const outgoingGoodId = outgoingGoodIdParam ? parseInt(outgoingGoodIdParam, 10) : null;
    if (outgoingGoodIdParam && (outgoingGoodId === null || !Number.isInteger(outgoingGoodId) || outgoingGoodId <= 0)) {
      return errorResponse(
        'Invalid outgoing_good_id. Expected a positive integer.',
        'INVALID_PARAMS',
        400
      );
    }

    // Get traceability data. Keep the existing grouped hierarchy for current UI
    // compatibility, and add the Phase 2 persisted detail read model alongside it.
    const [traceabilityData, traceabilityDetails, recalculationStatus] = await Promise.all([
      traceabilityRepository.getTraceabilityByOutgoingItemIds(itemIds, companyCode),
      traceabilityRepository.getTraceabilityDetailsByOutgoingItemIds(itemIds, companyCode),
      outgoingGoodId !== null
        ? traceabilityRepository.getRecalculationStatus(outgoingGoodId, companyCode)
        : Promise.resolve<TraceabilityRecalculationStatus>({
            has_recalculated: false,
            last_recalculated_at: null,
            last_recalculated_by: null,
          }),
    ]);
    const traceabilitySummary = traceabilityRepository.buildTraceabilitySummary(traceabilityDetails);
    const legacyTraceabilityData = applyNetSummaryToLegacyItems(traceabilityData, traceabilitySummary);

    // Group by item code to merge items with same code (if multiple outgoing items same code)
    const groupedData = legacyTraceabilityData.reduce(
      (acc, item) => {
        const existing = acc.find((i) => i.item_code === item.item_code);
        if (existing) {
          // If item already exists, merge quantities
          existing.qty += item.qty;

          // For production-based items, merge work orders
          if (item.source_type === 'production' && existing.source_type === 'production') {
            const existingWOs = new Map((existing.work_orders || []).map((w) => [w.work_order_number, w]));

            (item.work_orders || []).forEach((wo) => {
              if (existingWOs.has(wo.work_order_number)) {
                // Already exists, skip merging (keep original)
                return;
              }
              existingWOs.set(wo.work_order_number, wo);
            });

            existing.work_orders = Array.from(existingWOs.values()).sort((a, b) =>
              a.work_order_number.localeCompare(b.work_order_number)
            );
          }

          // For incoming-based items, merge PPKEK array
          if (item.source_type === 'incoming' && existing.source_type === 'incoming') {
            const ppkekSet = new Map(
              (existing.incoming_ppkek_numbers || []).map((p) => [p.ppkek_number, p])
            );

            (item.incoming_ppkek_numbers || []).forEach((ppkek) => {
              if (!ppkekSet.has(ppkek.ppkek_number)) {
                ppkekSet.set(ppkek.ppkek_number, ppkek);
              }
            });

            existing.incoming_ppkek_numbers = Array.from(ppkekSet.values());
          }
        } else {
          acc.push(item);
        }
        return acc;
      },
      [] as TraceabilityItem[]
    );

    return successResponse<{
      items: TraceabilityItem[];
      traceability_details: TraceabilityDetailRow[];
      traceability_summary: TraceabilitySummaryRow[];
      recalculation_status: TraceabilityRecalculationStatus;
      can_view_material_traceability_details: boolean;
      count: number;
      detail_count: number;
      summary_count: number;
    }>({
      items: groupedData,
      traceability_details: canViewMaterialTraceabilityDetails ? traceabilityDetails : [],
      traceability_summary: traceabilitySummary,
      recalculation_status: recalculationStatus,
      can_view_material_traceability_details: canViewMaterialTraceabilityDetails,
      count: groupedData.length,
      detail_count: canViewMaterialTraceabilityDetails ? traceabilityDetails.length : 0,
      summary_count: traceabilitySummary.length,
    });
  } catch (error) {
    console.error('Error fetching traceability data:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Failed to fetch traceability data',
      'FETCH_ERROR',
      500
    );
  }
}
