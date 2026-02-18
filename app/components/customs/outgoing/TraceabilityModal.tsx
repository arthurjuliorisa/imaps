'use client';

import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import { Close } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

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

interface TraceabilityMaterial {
  material_item_code: string;
  material_item_name: string;
  consumption_ratio: number;
  material_qty_allocated: number;
  qty_uom: string;
  ppkek?: TraceabilityPPKEKDetail | null;
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

interface TraceabilityModalProps {
  open: boolean;
  onClose: () => void;
  outgoingItemIds: number[];
  companyCode: number;
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
}: TraceabilityModalProps) {
  const theme = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<TraceabilityItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tabValue, setTabValue] = useState<'production' | 'incoming'>('production');
  const [companyType, setCompanyType] = useState<string>('');

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
          `/api/customs/outgoing/traceability?item_ids=${itemIds}&company_code=${companyCode}`
        );

        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }

        const result = await response.json();

        if (!result.success) {
          throw new Error(result.message || 'Failed to fetch traceability data');
        }

        setData(result.data.items || []);

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
  }, [open, outgoingItemIds, companyCode, toast]);

  // ============================================================================
  // RENDER: PRODUCTION-BASED TABLE
  // ============================================================================

  const productionItems = data.filter((item) => item.source_type === 'production');

  const renderProductionTable = () => {
    if (productionItems.length === 0) {
      return <Alert severity="info">No production-based traceability data found.</Alert>;
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
              {renderShouldShowQtyColumns() && (
                <>
                  <TableCell sx={{ fontWeight: 700, minWidth: 100, textAlign: 'right' }}>Qty Allocated</TableCell>
                  <TableCell sx={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>UOM</TableCell>
                </>
              )}
              <TableCell sx={{ fontWeight: 700, minWidth: 120 }}>Reg Number</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Doc Type</TableCell>
              <TableCell sx={{ fontWeight: 700, minWidth: 100 }}>Reg Date</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {productionItems.map((item) => {
              const workOrders = item.work_orders || [];
              
              if (workOrders.length === 0) {
                return (
                  <TableRow key={`${item.item_code}-no-wo`}>
                    <TableCell>{item.item_code}</TableCell>
                    <TableCell>{item.item_name}</TableCell>
                    <TableCell align="right">{Number(item.qty).toLocaleString()}</TableCell>
                    <TableCell>{item.uom}</TableCell>
                    <TableCell colSpan={11} sx={{ color: 'text.secondary' }}>
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
                      <TableCell align="right">{woIdx === 0 ? Number(item.qty).toLocaleString() : ''}</TableCell>
                      <TableCell>{woIdx === 0 ? item.uom : ''}</TableCell>
                      <TableCell>{wo.work_order_number}</TableCell>
                      <TableCell align="right">{Number(wo.qty_per_wo).toLocaleString()}</TableCell>
                      <TableCell colSpan={8} sx={{ color: 'text.secondary' }}>
                        No materials
                      </TableCell>
                    </TableRow>
                  );
                }

                return materials.map((material, matIdx) => (
                  <TableRow key={`${item.item_code}-${wo.work_order_number}-${material.material_item_code}-${matIdx}`}>
                    {woIdx === 0 && matIdx === 0 && (
                      <>
                        <TableCell rowSpan={materials.length}>{item.item_code}</TableCell>
                        <TableCell rowSpan={materials.length}>{item.item_name}</TableCell>
                        <TableCell align="right" rowSpan={materials.length}>
                          {Number(item.qty).toLocaleString()}
                        </TableCell>
                        <TableCell rowSpan={materials.length}>{item.uom}</TableCell>
                      </>
                    )}
                    {matIdx === 0 && (
                      <>
                        <TableCell rowSpan={materials.length}>{wo.work_order_number}</TableCell>
                        <TableCell align="right" rowSpan={materials.length}>
                          {Number(wo.qty_per_wo).toLocaleString()}
                        </TableCell>
                      </>
                    )}
                    <TableCell>{material.material_item_code}</TableCell>
                    <TableCell>{material.material_item_name}</TableCell>
                    {renderShouldShowQtyColumns() && (
                      <>
                        <TableCell align="right">{Number(material.material_qty_allocated).toLocaleString()}</TableCell>
                        <TableCell>{material.qty_uom}</TableCell>
                      </>
                    )}
                    <TableCell>{material.ppkek?.ppkek_number || '-'}</TableCell>
                    <TableCell>{material.ppkek?.customs_document_type || '-'}</TableCell>
                    <TableCell>{material.ppkek?.customs_registration_date || '-'}</TableCell>
                  </TableRow>
                ));
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

  const renderIncomingTable = () => {
    if (incomingItems.length === 0) {
      return <Alert severity="info">No incoming-based traceability data found.</Alert>;
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
            {incomingItems.map((item) => {
              const ppkeks = item.incoming_ppkek_numbers || [];

              if (ppkeks.length === 0) {
                return (
                  <TableRow key={`${item.item_code}-no-ppkek`}>
                    <TableCell>{item.item_code}</TableCell>
                    <TableCell>{item.item_name}</TableCell>
                    <TableCell align="right">{Number(item.qty).toLocaleString()}</TableCell>
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
                        {Number(item.qty).toLocaleString()}
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
            {productionItems.length > 0 && incomingItems.length > 0 && (
              <Tabs
                value={tabValue}
                onChange={(_, newValue) => setTabValue(newValue)}
                sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}
              >
                <Tab label={`Production-Based (${productionItems.length})`} value="production" />
                <Tab label={`Incoming-Based (${incomingItems.length})`} value="incoming" />
              </Tabs>
            )}

            {tabValue === 'production' && renderProductionTable()}
            {tabValue === 'incoming' && renderIncomingTable()}
          </>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose} variant="outlined">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
