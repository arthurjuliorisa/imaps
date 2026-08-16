'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  CircularProgress,
  Box,
  Typography,
  Alert,
  alpha,
  useTheme,
  Tab,
  Tabs,
  TextField,
  InputAdornment,
  Chip,
  Collapse,
  IconButton,
} from '@mui/material';
import { Close, ExpandLess, ExpandMore, Search } from '@mui/icons-material';
import { useSession } from 'next-auth/react';
import { useToast } from '@/app/components/ToastProvider';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';
import { formatTraceabilityQty, formatTraceabilityRatio } from '@/lib/utils/traceability-format';

// ============================================================================
// INTERFACES - Match lib/repositories/traceability.repository.ts
// ============================================================================

interface TraceabilityPPKEKDetail {
  ppkek_number: string;
  customs_registration_date: string;
  customs_document_type: string;
  incoming_date: string;
  incoming_evidence_number?: string;
}

interface TraceabilityPPKEKWithQty extends TraceabilityPPKEKDetail {
  qty_allocated: number;
  qty_uom: string;
}

interface TraceabilityMaterial {
  material_item_code: string;
  material_item_name: string;
  consumption_ratio: number;
  ppkeks?: TraceabilityPPKEKWithQty[];
}

interface TraceabilityWorkOrder {
  work_order_number: string;
  qty_per_wo: number;
  materials: TraceabilityMaterial[];
}

interface TraceabilityItem {
  item_code: string;
  item_name: string;
  qty: number;
  item_type: string;
  uom: string;
  source_type: 'production' | 'incoming';
  work_orders?: TraceabilityWorkOrder[];
  incoming_ppkek_numbers?: TraceabilityPPKEKDetail[];
}

interface TraceabilityDetailRow {
  outgoing_good_item_id: number;
  work_order_number: string | null;
  production_wms_id: string;
  material_item_code: string | null;
  material_item_name: string | null;
  material_uom: string | null;
  consumption_ratio: number | null;
  allocated_qty: number | null;
  material_qty_allocated: number | null;
  component_demand_qty: number | null;
  planned_production_qty: number | null;
  source_material_usage_wms_id: string | null;
  source_material_usage_item_id: number | null;
  trace_row_type: string | null;
  display_ppkek_number: string | null;
  ppkek_bucket_key: string | null;
  actual_qty: number | null;
  signed_qty: number | null;
  raw_allocated_qty: number | null;
  final_allocated_qty: number | null;
  rounding_adjustment: number | null;
  material_net_usage_total: number | null;
  incoming_goods_id: number | null;
  ppkek_number_incoming: string | null;
  customs_document_type: string | null;
  customs_registration_date: string | null;
  incoming_date: string | null;
}

interface TraceabilityRecalculationStatus {
  has_recalculated: boolean;
  last_recalculated_at: string | null;
  last_recalculated_by: string | null;
}

interface TraceabilityModalProps {
  open: boolean;
  onClose: () => void;
  outgoingItemIds: number[];
  companyCode: number;
  outgoingGoodId: number;
}

function includesSearch(value: unknown, search: string): boolean {
  return String(value ?? '').toLowerCase().includes(search);
}

const formatQty = formatTraceabilityQty;
const formatRatio = formatTraceabilityRatio;

function formatRecalculatedAt(value: string | null): string | null {
  if (!value) return null;

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString('en-US', { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatPPKEK(displayValue: string | null | undefined, bucketKey?: string | null): string {
  const normalized = displayValue?.trim().toLowerCase();
  if (!displayValue?.trim() || normalized === 'n' || normalized === 'blank ppkek' || bucketKey === 'LITERAL_N' || bucketKey === 'BLANK' || !bucketKey) {
    return '-';
  }

  return displayValue;
}

function filterTraceabilityDetails(
  details: TraceabilityDetailRow[],
  search: string
): TraceabilityDetailRow[] {
  if (!search) {
    return details;
  }

  return details.filter((detail) =>
    [
      detail.work_order_number,
      detail.production_wms_id,
      detail.material_item_code,
      detail.material_item_name,
      detail.material_uom,
      detail.source_material_usage_wms_id,
      detail.trace_row_type,
      detail.display_ppkek_number,
      detail.ppkek_bucket_key,
      detail.customs_document_type,
    ].some((value) => includesSearch(value, search))
  );
}

function filterProductionTraceability(
  items: TraceabilityItem[],
  search: string
): TraceabilityItem[] {
  if (!search) {
    return items;
  }

  return items
    .map((item) => {
      const itemUomMatches = includesSearch(item.uom, search);
      const workOrders = item.work_orders || [];

      if (workOrders.length === 0) {
        return itemUomMatches ? item : null;
      }

      const filteredWorkOrders = workOrders
        .map((wo) => {
          const workOrderMatches =
            itemUomMatches || includesSearch(wo.work_order_number, search);
          const materials = wo.materials || [];

          if (materials.length === 0) {
            return workOrderMatches ? wo : null;
          }

          const filteredMaterials = materials
            .map((material) => {
              const materialMatches =
                workOrderMatches ||
                includesSearch(material.material_item_code, search) ||
                includesSearch(material.material_item_name, search);
              const ppkeks = material.ppkeks || [];

              if (ppkeks.length === 0) {
                return materialMatches ? material : null;
              }

              const filteredPPKEKs = materialMatches
                ? ppkeks
                : ppkeks.filter(
                    (ppkek) =>
                      includesSearch(ppkek.ppkek_number, search) ||
                      includesSearch(ppkek.customs_document_type, search) ||
                      includesSearch(ppkek.qty_uom, search)
                  );

              if (filteredPPKEKs.length === 0) {
                return null;
              }

              return {
                ...material,
                ppkeks: filteredPPKEKs,
              };
            })
            .filter((material): material is TraceabilityMaterial => Boolean(material));

          if (filteredMaterials.length === 0) {
            return null;
          }

          return {
            ...wo,
            materials: filteredMaterials,
          };
        })
        .filter((wo): wo is TraceabilityWorkOrder => Boolean(wo));

      if (filteredWorkOrders.length === 0) {
        return null;
      }

      return {
        ...item,
        work_orders: filteredWorkOrders,
      };
    })
    .filter((item): item is TraceabilityItem => Boolean(item));
}

function filterIncomingTraceability(
  items: TraceabilityItem[],
  search: string
): TraceabilityItem[] {
  if (!search) {
    return items;
  }

  return items
    .map((item) => {
      const itemUomMatches = includesSearch(item.uom, search);
      const ppkeks = item.incoming_ppkek_numbers || [];

      if (ppkeks.length === 0) {
        return itemUomMatches ? item : null;
      }

      const filteredPPKEKs = itemUomMatches
        ? ppkeks
        : ppkeks.filter(
            (ppkek) =>
              includesSearch(ppkek.ppkek_number, search) ||
              includesSearch(ppkek.customs_document_type, search)
          );

      if (filteredPPKEKs.length === 0) {
        return null;
      }

      return {
        ...item,
        incoming_ppkek_numbers: filteredPPKEKs,
      };
    })
    .filter((item): item is TraceabilityItem => Boolean(item));
}

/**
 * TraceabilityModal Component - Refactored for proper 4-level hierarchy
 * 
 * Displays two scenarios:
 * 1. Production-based: Item → Work Orders → Materials → PPKEK
 * 2. Incoming-based: Item → Direct PPKEK array with full details
 */
export function TraceabilityModal({
  open,
  onClose,
  outgoingItemIds,
  companyCode,
  outgoingGoodId,
}: TraceabilityModalProps) {
  const theme = useTheme();
  const toast = useToast();
  const { data: session } = useSession();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TraceabilityItem[]>([]);
  const [traceabilityDetails, setTraceabilityDetails] = useState<TraceabilityDetailRow[]>([]);
  const [recalculationStatus, setRecalculationStatus] = useState<TraceabilityRecalculationStatus>({
    has_recalculated: false,
    last_recalculated_at: null,
    last_recalculated_by: null,
  });
  const [canViewMaterialTraceabilityDetails, setCanViewMaterialTraceabilityDetails] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState<'production' | 'incoming'>('production');
  const [companyType, setCompanyType] = useState<string>('');
  const [traceabilitySearch, setTraceabilitySearch] = useState('');
  const [expandedTraceabilityRow, setExpandedTraceabilityRow] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [recalculateConfirmOpen, setRecalculateConfirmOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const normalizedSearch = traceabilitySearch.trim().toLowerCase();
  const userRole = session?.user?.role;
  const isAdminUser =
    userRole === 'ADMIN' || userRole === 'SUPER_ADMIN' || userRole === 'SUPERADMIN';

  /**
   * Determine if Qty Allocated and UOM columns should be shown
   * Only shown for BZ company type
   */
  const renderShouldShowQtyColumns = () => {
    return companyType === 'BZ';
  };

  /**
   * Fetch traceability data
   */
  useEffect(() => {
    if (!open || outgoingItemIds.length === 0) {
      return;
    }

    const fetchTraceability = async () => {
      setLoading(true);
      setError(null);

      try {
        const itemIds = outgoingItemIds.join(',');
        const response = await fetch(
          `/api/customs/outgoing/traceability?item_ids=${itemIds}&company_code=${companyCode}&outgoing_good_id=${outgoingGoodId}`
        );

        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.message || 'Failed to fetch traceability data');
        }

        setData(result.data.items || []);
        setTraceabilityDetails(result.data.traceability_details || []);
        setRecalculationStatus(result.data.recalculation_status || {
          has_recalculated: false,
          last_recalculated_at: null,
          last_recalculated_by: null,
        });
        setCanViewMaterialTraceabilityDetails(Boolean(result.data.can_view_material_traceability_details));

        // Fetch company type
        if (companyCode) {
          const companyResponse = await fetch(`/api/master/companies?code=${companyCode}`);
          if (companyResponse.ok) {
            const companyData = await companyResponse.json();
            // API returns array of companies, get the first one
            const company = Array.isArray(companyData.data) ? companyData.data[0] : companyData.data;
            setCompanyType(company?.company_type || '');
          }
        }

        // Set initial tab based on what data we have
        const hasProduction = (result.data.items || []).some((i: any) => i.source_type === 'production');
        setTabValue(hasProduction ? 'production' : 'incoming');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        toast.error(`Failed to load traceability: ${errorMsg}`);
      } finally {
        setLoading(false);
      }
    };

    fetchTraceability();
  }, [open, outgoingItemIds, companyCode, outgoingGoodId, toast, refreshToken]);

  useEffect(() => {
    if (!open) {
      setTraceabilitySearch('');
      setExpandedTraceabilityRow(null);
    }
  }, [open]);

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      const response = await fetch('/api/customs/outgoing/traceability/recalculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outgoing_good_id: outgoingGoodId, company_code: companyCode }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.message || 'Failed to recalculate traceability');
      }
      toast.success(`Traceability recalculated (${result.data.oldRowCount} rows replaced with ${result.data.newRowCount}).`);
      setRecalculateConfirmOpen(false);
      setRefreshToken((value) => value + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      toast.error(`Failed to recalculate traceability: ${message}`);
    } finally {
      setRecalculating(false);
    }
  };

  // ============================================================================
  // RENDER: PRODUCTION-BASED TABLE
  // ============================================================================

  const productionItems = data.filter((item) => item.source_type === 'production');
  const filteredProductionItems = useMemo(
    () => filterProductionTraceability(productionItems, normalizedSearch),
    [productionItems, normalizedSearch]
  );
  const filteredTraceabilityDetails = useMemo(
    () => filterTraceabilityDetails(traceabilityDetails, normalizedSearch),
    [traceabilityDetails, normalizedSearch]
  );

  const renderTraceabilityDetailsTable = () => {
    if (!isAdminUser || !canViewMaterialTraceabilityDetails || traceabilityDetails.length === 0) {
      return null;
    }

    return (
      <Box sx={{ mt: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            Material Traceability Details
          </Typography>
          <Chip
            size="small"
            label={recalculationStatus.has_recalculated ? 'Recalculated' : 'Original'}
            color={recalculationStatus.has_recalculated ? 'primary' : 'default'}
            variant={recalculationStatus.has_recalculated ? 'filled' : 'outlined'}
          />
          {recalculationStatus.has_recalculated && formatRecalculatedAt(recalculationStatus.last_recalculated_at) && (
            <Typography variant="caption" color="text.secondary">
              Last recalculated: {formatRecalculatedAt(recalculationStatus.last_recalculated_at)}
              {recalculationStatus.last_recalculated_by ? ` by ${recalculationStatus.last_recalculated_by}` : ''}
            </Typography>
          )}
        </Box>
        {filteredTraceabilityDetails.length === 0 ? (
          <Alert severity="info">No matching detail rows found.</Alert>
        ) : (
          <TableContainer sx={{ maxHeight: '420px' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12) }}>
                  <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Row Type</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 130 }}>Source WMS ID</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 120 }}>Work Order</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 220 }}>Material</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 70 }}>UOM</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 130 }}>PPKEK</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 140, textAlign: 'right' }}>Component Demand</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 150, textAlign: 'right' }}>Planned Production</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 100, textAlign: 'right' }}>Actual Qty</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 120, textAlign: 'right' }}>Final Allocated</TableCell>
                  <TableCell sx={{ fontWeight: 700, width: 76, textAlign: 'center' }}>Details</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {filteredTraceabilityDetails.map((detail, index) => {
                  const rowKey = `${detail.outgoing_good_item_id}-${detail.source_material_usage_item_id}-${detail.ppkek_bucket_key}-${index}`;
                  const isExpanded = expandedTraceabilityRow === rowKey;

                  return (
                    <React.Fragment key={rowKey}>
                      <TableRow>
                        <TableCell>
                          <Chip
                            size="small"
                            label={detail.trace_row_type || 'NORMAL'}
                            color={detail.trace_row_type === 'REVERSAL' ? 'warning' : 'default'}
                            variant={detail.trace_row_type === 'REVERSAL' ? 'filled' : 'outlined'}
                          />
                        </TableCell>
                        <TableCell>{detail.source_material_usage_wms_id || '-'}</TableCell>
                        <TableCell>{detail.work_order_number || '-'}</TableCell>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {detail.material_item_code || '-'}
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {detail.material_item_name || '-'}
                          </Typography>
                        </TableCell>
                        <TableCell>{detail.material_uom || '-'}</TableCell>
                        <TableCell>{formatPPKEK(detail.display_ppkek_number, detail.ppkek_bucket_key)}</TableCell>
                        <TableCell align="right">{formatQty(detail.component_demand_qty)}</TableCell>
                        <TableCell align="right">{formatQty(detail.planned_production_qty)}</TableCell>
                        <TableCell align="right">{formatQty(detail.actual_qty)}</TableCell>
                        <TableCell align="right">{formatQty(detail.final_allocated_qty)}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            aria-label={isExpanded ? 'Hide calculation basis' : 'Show calculation basis'}
                            aria-expanded={isExpanded}
                            size="small"
                            onClick={() => setExpandedTraceabilityRow(isExpanded ? null : rowKey)}
                          >
                            {isExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
                          </IconButton>
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell colSpan={11} sx={{ p: 0, borderBottom: isExpanded ? undefined : 0 }}>
                          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                            <Box sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.035) }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.25 }}>
                                Calculation Detail
                              </Typography>
                              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, gap: 2 }}>
                                {[
                                  ['Traceability Context', [
                                    ['Work Order', detail.work_order_number],
                                    ['Material Code', detail.material_item_code],
                                    ['Material Name', detail.material_item_name],
                                    ['Material UOM', detail.material_uom],
                                    ['Trace Row Type', detail.trace_row_type || 'NORMAL'],
                                    ['Display PPKEK', formatPPKEK(detail.display_ppkek_number, detail.ppkek_bucket_key)],
                                    ['Internal PPKEK Bucket', detail.ppkek_bucket_key],
                                  ]],
                                  ['Calculation Basis', [
                                    ['Component Demand', formatQty(detail.component_demand_qty)],
                                    ['Planned Production', formatQty(detail.planned_production_qty)],
                                    ['Consumption Ratio', formatRatio(detail.consumption_ratio)],
                                    ['WO Allocation Qty', formatQty(detail.allocated_qty)],
                                    ['Material Allocated Qty', formatQty(detail.material_qty_allocated)],
                                  ]],
                                  ['Material Usage Contribution', [
                                    ['Actual Qty', formatQty(detail.actual_qty)],
                                    ['Signed Qty', formatQty(detail.signed_qty)],
                                    ['Material Net Usage Total', formatQty(detail.material_net_usage_total)],
                                    ['Source MU WMS ID', detail.source_material_usage_wms_id],
                                  ]],
                                  ['Allocation Result', [
                                    ['Raw Allocated Qty', formatQty(detail.raw_allocated_qty)],
                                    ['Final Allocated Qty', formatQty(detail.final_allocated_qty)],
                                    ['Rounding Adjustment', formatQty(detail.rounding_adjustment)],
                                  ]],
                                  ['Production Source', [
                                    ['Source Production Output WMS ID', detail.production_wms_id],
                                  ]],
                                ].map(([title, fields]) => (
                                  <Box key={title as string}>
                                    <Typography variant="caption" sx={{ display: 'block', fontWeight: 700, color: 'text.secondary', mb: 0.75 }}>
                                      {title as string}
                                    </Typography>
                                    <Box sx={{ display: 'grid', gap: 0.5 }}>
                                      {(fields as [string, string | number | null | undefined][]).map(([label, value]) => (
                                        <Typography key={label} variant="body2" sx={{ overflowWrap: 'anywhere' }}>
                                          <Box component="span" sx={{ color: 'text.secondary' }}>{label}: </Box>
                                          {value === null || value === undefined || value === '' ? '-' : value}
                                        </Typography>
                                      ))}
                                    </Box>
                                  </Box>
                                ))}
                              </Box>
                            </Box>
                          </Collapse>
                        </TableCell>
                      </TableRow>
                    </React.Fragment>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>
    );
  };

  const renderProductionTable = () => {
    if (filteredProductionItems.length === 0) {
      return (
        <Alert severity="info">
          {normalizedSearch
            ? 'No matching traceability data found.'
            : 'No production-based traceability data found.'}
        </Alert>
      );
    }

    return (
      <TableContainer sx={{ maxHeight: '600px' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12) }}>
              <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Item Name</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>Qty</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>UOM</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 120 }}>Work Order</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 100, textAlign: 'right' }}>WO Qty</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Material Code</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Material Name</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 120 }}>Reg Number</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Doc Type</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Reg Date</TableCell>
              {renderShouldShowQtyColumns() && (
                <>
                  <TableCell sx={{ fontWeight: 700, minWidth: 100, textAlign: 'right' }}>Qty Allocated</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>UOM</TableCell>
                </>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredProductionItems.map((item) => {
              const workOrders = item.work_orders || [];
              
              // Calculate total PPKEK rows across all work orders
              // Each material has 1 or more PPKEK rows (min 1 if no PPKEKs)
              const totalPPKEKRows = workOrders.reduce((woSum, wo) => {
                const woPPKEKCount = (wo.materials || []).reduce(
                  (matSum, mat) => matSum + Math.max(1, mat.ppkeks?.length || 0),
                  0
                );
                return woSum + woPPKEKCount;
              }, 0);
              
              if (workOrders.length === 0) {
                return (
                  <TableRow key={`${item.item_code}-no-wo`}>
                    <TableCell>{item.item_code}</TableCell>
                    <TableCell>{item.item_name}</TableCell>
                    <TableCell align="right">{formatQty(item.qty)}</TableCell>
                    <TableCell>{item.uom}</TableCell>
                    <TableCell colSpan={9} sx={{ color: 'text.secondary' }}>
                      No work order allocations
                    </TableCell>
                  </TableRow>
                );
              }

              return workOrders.map((wo, woIdx) => {
                const materials = wo.materials || [];

                if (materials.length === 0) {
                  return (
                    <TableRow key={`${item.item_code}-${wo.work_order_number}-no-mat`}>
                      <TableCell>{woIdx === 0 ? item.item_code : ''}</TableCell>
                      <TableCell>{woIdx === 0 ? item.item_name : ''}</TableCell>
                      <TableCell align="right">{woIdx === 0 ? formatQty(item.qty) : ''}</TableCell>
                      <TableCell>{woIdx === 0 ? item.uom : ''}</TableCell>
                      <TableCell>{wo.work_order_number}</TableCell>
                      <TableCell align="right">{formatQty(wo.qty_per_wo)}</TableCell>
                      <TableCell colSpan={7} sx={{ color: 'text.secondary' }}>
                        No materials
                      </TableCell>
                    </TableRow>
                  );
                }

                // Calculate PPKEK rows for this work order
                const woPPKEKRowCount = materials.reduce(
                  (sum, mat) => sum + Math.max(1, mat.ppkeks?.length || 0),
                  0
                );

                return materials.map((material, matIdx) => {
                  // Get PPKEKs for this material (or [null] if no PPKEKs)
                  const ppkeks = material.ppkeks && material.ppkeks.length > 0 ? material.ppkeks : [null];
                  
                  return ppkeks.map((ppkek, ppkekIdx) => (
                    <TableRow key={`${item.item_code}-${wo.work_order_number}-${material.material_item_code}-${ppkekIdx}`}>
                      {woIdx === 0 && matIdx === 0 && ppkekIdx === 0 && (
                        <>
                          <TableCell rowSpan={totalPPKEKRows}>{item.item_code}</TableCell>
                          <TableCell rowSpan={totalPPKEKRows}>{item.item_name}</TableCell>
                          <TableCell align="right" rowSpan={totalPPKEKRows}>
                            {formatQty(item.qty)}
                          </TableCell>
                          <TableCell rowSpan={totalPPKEKRows}>{item.uom}</TableCell>
                        </>
                      )}
                      {matIdx === 0 && ppkekIdx === 0 && (
                        <>
                          <TableCell rowSpan={woPPKEKRowCount}>{wo.work_order_number}</TableCell>
                          <TableCell align="right" rowSpan={woPPKEKRowCount}>
                            {formatQty(wo.qty_per_wo)}
                          </TableCell>
                        </>
                      )}
                      {ppkekIdx === 0 && (
                        <>
                          <TableCell rowSpan={ppkeks.length}>{material.material_item_code}</TableCell>
                          <TableCell rowSpan={ppkeks.length}>{material.material_item_name}</TableCell>
                        </>
                      )}
                      <TableCell>{ppkek?.ppkek_number || '-'}</TableCell>
                      <TableCell>{ppkek?.customs_document_type || '-'}</TableCell>
                      <TableCell>{ppkek?.customs_registration_date || '-'}</TableCell>
                      {renderShouldShowQtyColumns() && (
                        <>
                          <TableCell align="right">
                            {ppkek && ppkek.qty_allocated !== undefined && ppkek.qty_allocated !== null
                              ? formatQty(ppkek.qty_allocated)
                              : '-'}
                          </TableCell>
                          <TableCell>{ppkek?.qty_uom || '-'}</TableCell>
                        </>
                      )}
                    </TableRow>
                  ));
                });
              });
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  // ============================================================================
  // RENDER: INCOMING-BASED TABLE
  // ============================================================================

  const incomingItems = data.filter((item) => item.source_type === 'incoming');
  const filteredIncomingItems = useMemo(
    () => filterIncomingTraceability(incomingItems, normalizedSearch),
    [incomingItems, normalizedSearch]
  );

  const renderIncomingTable = () => {
    if (filteredIncomingItems.length === 0) {
      return (
        <Alert severity="info">
          {normalizedSearch
            ? 'No matching traceability data found.'
            : 'No incoming-based traceability data found.'}
        </Alert>
      );
    }

    return (
      <TableContainer sx={{ maxHeight: '600px' }}>
        <Table stickyHeader size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12) }}>
              <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 200 }}>Item Name</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>Qty</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>UOM</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 120 }}>PPKEK Number</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Doc Type</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Reg Date</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Inc Date</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 150 }}>Evidence Number</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredIncomingItems.map((item) => {
              const ppkeks = item.incoming_ppkek_numbers || [];

              if (ppkeks.length === 0) {
                return (
                  <TableRow key={`${item.item_code}-no-ppkek`}>
                    <TableCell>{item.item_code}</TableCell>
                    <TableCell>{item.item_name}</TableCell>
                    <TableCell align="right">{formatQty(item.qty)}</TableCell>
                    <TableCell>{item.uom}</TableCell>
                    <TableCell colSpan={5} sx={{ color: 'text.secondary' }}>
                      No PPKEK references
                    </TableCell>
                  </TableRow>
                );
              }

              return ppkeks.map((ppkek, idx) => (
                <TableRow key={`${item.item_code}-${ppkek.ppkek_number}-${idx}`}>
                  {idx === 0 && (
                    <>
                      <TableCell rowSpan={ppkeks.length}>{item.item_code}</TableCell>
                      <TableCell rowSpan={ppkeks.length}>{item.item_name}</TableCell>
                      <TableCell align="right" rowSpan={ppkeks.length}>
                        {formatQty(item.qty)}
                      </TableCell>
                      <TableCell rowSpan={ppkeks.length}>{item.uom}</TableCell>
                    </>
                  )}
                  <TableCell>{ppkek.ppkek_number}</TableCell>
                  <TableCell>{ppkek.customs_document_type}</TableCell>
                  <TableCell>{ppkek.customs_registration_date}</TableCell>
                  <TableCell>{ppkek.incoming_date}</TableCell>
                  <TableCell>{ppkek.incoming_evidence_number || '-'}</TableCell>
                </TableRow>
              ));
            })}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  // ============================================================================
  // RENDER: DIALOG
  // ============================================================================

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xl"
      fullWidth
      PaperProps={{
        sx: {
          maxHeight: '90vh',
        },
      }}
    >
      <DialogTitle>
        Traceability View
        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
          Chain of Custody for Outgoing Goods
        </Typography>
      </DialogTitle>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {!loading && data.length === 0 && !error && (
          <Alert severity="info">No traceability data found for selected items.</Alert>
        )}

        {!loading && data.length > 0 && (
          <>
            <TextField
              fullWidth
              size="small"
              value={traceabilitySearch}
              onChange={(event) => setTraceabilitySearch(event.target.value)}
              placeholder="Search material, work order, reg number, doc type, UOM..."
              sx={{ mb: 2 }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />

            {productionItems.length > 0 && incomingItems.length > 0 && (
              <Tabs
                value={tabValue}
                onChange={(_, newValue) => setTabValue(newValue)}
                sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
              >
                <Tab label={`Production-Based (${filteredProductionItems.length})`} value="production" />
                <Tab label={`Incoming-Based (${filteredIncomingItems.length})`} value="incoming" />
              </Tabs>
            )}

            {tabValue === 'production' && (
              <>
                {renderProductionTable()}
                {renderTraceabilityDetailsTable()}
              </>
            )}
            {tabValue === 'incoming' && renderIncomingTable()}
          </>
        )}
      </DialogContent>

      <DialogActions>
        {isAdminUser && (
          <Button
            onClick={() => setRecalculateConfirmOpen(true)}
            disabled={loading || recalculating || outgoingGoodId <= 0}
            variant="contained"
            color="warning"
          >
            {recalculating ? 'Recalculating...' : 'Recalculate'}
          </Button>
        )}
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
      </DialogActions>
      <ConfirmDialog
        open={recalculateConfirmOpen}
        title="Recalculate traceability?"
        message="This will replace the current traceability calculation result using the latest Material Usage and Production Output data. Existing traceability detail rows for this outgoing transaction will be deleted and rebuilt. This will not change outgoing goods, stock snapshot, or INSW transmission."
        confirmText="Recalculate"
        cancelText="Cancel"
        onConfirm={handleRecalculate}
        onCancel={() => setRecalculateConfirmOpen(false)}
        severity="warning"
        loading={recalculating}
      />
    </Dialog>
  );
}
