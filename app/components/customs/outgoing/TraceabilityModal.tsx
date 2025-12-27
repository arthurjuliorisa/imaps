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
} from '@mui/material';
import { Close, OpenInNew } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface TraceabilityItem {
  item_code: string;
  item_name: string;
  qty: number;
  source_type: 'production' | 'incoming';
  work_orders: TraceabilityWorkOrder[];
  incoming_ppkek_numbers: string[];
}

interface TraceabilityWorkOrder {
  work_order_number: string;
  materials: TraceabilityMaterial[];
}

interface TraceabilityMaterial {
  item_code: string;
  item_name: string;
  registration_number: string;
}

interface TraceabilityItem {
  item_code: string;
  item_name: string;
  qty: number;
  work_orders: TraceabilityWorkOrder[];
}

interface TraceabilityModalProps {
  open: boolean;
  onClose: () => void;
  outgoingItemIds: number[];
  companyCode: number;
}

/**
 * TraceabilityModal Component
 *
 * Displays traceability data for outgoing items with hierarchical row structure:
 * - Item Code & Name columns merge for all rows of same item
 * - Qty column merges for all rows of same item
 * - Work Order Number merges for multiple materials of same WO
 * - Each ROH/HALB material gets its own row
 * - Registration Number shown per material
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

  /**
   * Compute row span for each item
   * Counts total rows including deduplicated materials with multiple PPKEK
   */
  const getItemRowSpans = (): Map<string, { startRow: number; rowSpan: number }> => {
    const spans = new Map<string, { startRow: number; rowSpan: number }>();
    let currentRow = 0;

    data.forEach((item) => {
      // Calculate total rows = sum of materials (dedup) × PPKEK rows
      let totalRows = 0;
      
      item.work_orders.forEach((wo) => {
        // Deduplicate materials
        const materialMap = new Map<string, string[]>();
        
        wo.materials.forEach((material) => {
          if (!materialMap.has(material.item_code)) {
            materialMap.set(material.item_code, []);
          }
          if (material.registration_number) {
            const ppkekList = materialMap.get(material.item_code)!;
            if (!ppkekList.includes(material.registration_number)) {
              ppkekList.push(material.registration_number);
            }
          }
        });

        // Count total rows for this WO = sum of PPKEK rows per material
        const deduplicatedMaterials = Array.from(materialMap.values());
        const woRows = deduplicatedMaterials.reduce(
          (sum, ppkekList) => sum + Math.max(1, ppkekList.length),
          0
        );
        
        totalRows += Math.max(1, woRows);
      });
      
      const rowCount = Math.max(1, totalRows);
      spans.set(item.item_code, { startRow: currentRow, rowSpan: rowCount });
      currentRow += rowCount;
    });

    return spans;
  };

  /**
   * Render table rows with proper row spans and deduplicated materials
   * For production-based items only (incoming-based handled separately)
   */
  const renderTableRows = () => {
    // Filter only production-based items
    const productionItems = data.filter((item) => item.source_type === 'production');
    
    const itemRowSpans = getItemRowSpans();
    const rows: React.ReactNode[] = [];
    let globalRowIndex = 0;

    productionItems.forEach((item) => {
      const { startRow, rowSpan } = itemRowSpans.get(item.item_code)!;
      const itemStartRowIndex = globalRowIndex;

      if (item.work_orders.length === 0) {
        // No work orders - show single row with dashes
        rows.push(
          <TableRow key={`${item.item_code}-no-wo-${Math.random()}`} hover>
            <TableCell
              rowSpan={rowSpan}
              sx={{
                fontWeight: 600,
                backgroundColor: alpha(theme.palette.primary.main, 0.05),
                borderRight: `2px solid ${theme.palette.divider}`,
              }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  {item.item_code}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {item.item_name}
                </Typography>
              </Box>
            </TableCell>

            <TableCell
              rowSpan={rowSpan}
              align="right"
              sx={{
                fontWeight: 600,
                backgroundColor: alpha(theme.palette.primary.main, 0.05),
                borderRight: `2px solid ${theme.palette.divider}`,
              }}
            >
              {item.qty.toLocaleString()}
            </TableCell>

            <TableCell sx={{ color: 'text.secondary' }}>-</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>-</TableCell>
            <TableCell sx={{ color: 'text.secondary' }}>-</TableCell>
          </TableRow>
        );

        globalRowIndex++;
        return;
      }

      // Process each work order with deduplicated materials
      item.work_orders.forEach((wo) => {
        // Deduplicate materials: group by item_code, collect all PPKEK for each
        const materialMap = new Map<
          string,
          { item_code: string; item_name: string; ppkek_numbers: string[] }
        >();

        wo.materials.forEach((material) => {
          const key = material.item_code;
          if (!materialMap.has(key)) {
            materialMap.set(key, {
              item_code: material.item_code,
              item_name: material.item_name,
              ppkek_numbers: [],
            });
          }
          // Add PPKEK if not already present
          const ppkekList = materialMap.get(key)!.ppkek_numbers;
          if (material.registration_number && !ppkekList.includes(material.registration_number)) {
            ppkekList.push(material.registration_number);
          }
        });

        const deduplicatedMaterials = Array.from(materialMap.values());

        // If no materials, show one empty row
        if (deduplicatedMaterials.length === 0) {
          const isFirstRow = globalRowIndex === itemStartRowIndex;

          rows.push(
            <TableRow key={`${item.item_code}-${wo.work_order_number}-empty-${globalRowIndex}`} hover>
              {isFirstRow && (
                <TableCell
                  rowSpan={rowSpan}
                  sx={{
                    fontWeight: 600,
                    backgroundColor: alpha(theme.palette.primary.main, 0.05),
                    borderRight: `2px solid ${theme.palette.divider}`,
                    verticalAlign: 'top',
                  }}
                >
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {item.item_code}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.item_name}
                    </Typography>
                  </Box>
                </TableCell>
              )}

              {isFirstRow && (
                <TableCell
                  rowSpan={rowSpan}
                  align="right"
                  sx={{
                    fontWeight: 600,
                    backgroundColor: alpha(theme.palette.primary.main, 0.05),
                    borderRight: `2px solid ${theme.palette.divider}`,
                    verticalAlign: 'top',
                  }}
                >
                  {item.qty.toLocaleString()}
                </TableCell>
              )}

              <TableCell sx={{ fontWeight: 500 }}>{wo.work_order_number}</TableCell>
              <TableCell sx={{ color: 'text.secondary' }}>-</TableCell>
              <TableCell sx={{ color: 'text.secondary' }}>-</TableCell>
            </TableRow>
          );

          globalRowIndex++;
          return;
        }

        // Render each deduplicated material with its PPKEK list
        deduplicatedMaterials.forEach((material, matIdx) => {
          const isFirstMaterialRow = matIdx === 0;
          const isFirstRow = globalRowIndex === itemStartRowIndex;
          const totalPPKEKRows = material.ppkek_numbers.length || 1;

          // First row of this material (with material info)
          rows.push(
            <TableRow key={`item-${item.item_code}-wo-${wo.work_order_number}-mat-${material.item_code}-0`} hover>
              {isFirstRow && (
                <TableCell
                  rowSpan={rowSpan}
                  sx={{
                    fontWeight: 600,
                    backgroundColor: alpha(theme.palette.primary.main, 0.05),
                    borderRight: `2px solid ${theme.palette.divider}`,
                    verticalAlign: 'top',
                  }}
                >
                  <Box>
                    <Typography variant="body2" fontWeight={600}>
                      {item.item_code}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {item.item_name}
                    </Typography>
                  </Box>
                </TableCell>
              )}

              {isFirstRow && (
                <TableCell
                  rowSpan={rowSpan}
                  align="right"
                  sx={{
                    fontWeight: 600,
                    backgroundColor: alpha(theme.palette.primary.main, 0.05),
                    borderRight: `2px solid ${theme.palette.divider}`,
                    verticalAlign: 'top',
                  }}
                >
                  {item.qty.toLocaleString()}
                </TableCell>
              )}

              {isFirstMaterialRow && (
                <TableCell
                  rowSpan={deduplicatedMaterials.reduce((sum, m) => sum + Math.max(1, m.ppkek_numbers.length), 0)}
                  sx={{
                    fontWeight: 500,
                    verticalAlign: 'top',
                  }}
                >
                  {wo.work_order_number}
                </TableCell>
              )}

              <TableCell>
                <Box>
                  <Typography variant="body2" fontWeight={600}>
                    {material.item_code}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {material.item_name}
                  </Typography>
                </Box>
              </TableCell>

              <TableCell>
                {material.ppkek_numbers.length > 0 ? (
                  <Typography variant="body2">{material.ppkek_numbers[0]}</Typography>
                ) : (
                  <Typography variant="caption" color="text.secondary">
                    -
                  </Typography>
                )}
              </TableCell>
            </TableRow>
          );

          globalRowIndex++;

          // Additional rows for remaining PPKEK
          for (let ppkekIdx = 1; ppkekIdx < material.ppkek_numbers.length; ppkekIdx++) {
            rows.push(
              <TableRow key={`item-${item.item_code}-wo-${wo.work_order_number}-mat-${material.item_code}-ppkek-${ppkekIdx}`} hover>
                <TableCell />
                <TableCell />
                <TableCell>
                  <Typography variant="body2">{material.ppkek_numbers[ppkekIdx]}</Typography>
                </TableCell>
              </TableRow>
            );

            globalRowIndex++;
          }
        });
      });
    });

    return rows;
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="lg"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 600,
          fontSize: '1.25rem',
          pb: 2,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <OpenInNew fontSize="small" color="primary" />
          Item Traceability
        </Box>
        <Button
          onClick={onClose}
          size="small"
          variant="text"
          sx={{ minWidth: 'auto', p: 0.5 }}
        >
          <Close fontSize="small" />
        </Button>
      </DialogTitle>

      <DialogContent sx={{ pt: 0, pb: 2 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        )}

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {!loading && data.length === 0 && !error && (
          <Alert severity="info">No traceability data found for selected items.</Alert>
        )}

        {!loading && data.length > 0 && (
          <Box>
            {/* Check if any item has incoming-based traceability */}
            {data.some((item) => item.source_type === 'incoming') && (
              <Alert severity="info" sx={{ mb: 2 }}>
                Showing direct PPKEK registration numbers from incoming data
              </Alert>
            )}

            {/* Render table based on data source type */}
            {data.some((item) => item.source_type === 'production') && (
              <Box sx={{ mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  Production-based Traceability
                </Typography>
                <TableContainer sx={{ maxHeight: '500px' }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12) }}>
                        <TableCell
                          sx={{
                            fontWeight: 700,
                            backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            minWidth: 200,
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                        >
                          Item Code - Item Name
                        </TableCell>
                        <TableCell
                          sx={{
                            fontWeight: 700,
                            backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            minWidth: 80,
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                          align="right"
                        >
                          Qty
                        </TableCell>
                        <TableCell
                          sx={{
                            fontWeight: 700,
                            backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            minWidth: 150,
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                        >
                          Work Order Number
                        </TableCell>
                        <TableCell
                          sx={{
                            fontWeight: 700,
                            backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            minWidth: 200,
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                        >
                          ROH/HALB Detail
                        </TableCell>
                        <TableCell
                          sx={{
                            fontWeight: 700,
                            backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            minWidth: 200,
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                        >
                          Registration Number
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {renderTableRows().filter((_, idx) => {
                        // Filter rows for production-based items only
                        return true; // Will be handled in renderTableRows
                      })}
                      {renderTableRows()}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}

            {/* Incoming-based Traceability Table */}
            {data.filter((item) => item.source_type === 'incoming').length > 0 && (
              <Box>
                <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600 }}>
                  Incoming-based Traceability
                </Typography>
                <TableContainer sx={{ maxHeight: '500px' }}>
                  <Table stickyHeader size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12) }}>
                        <TableCell
                          sx={{
                            fontWeight: 700,
                            backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            minWidth: 200,
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                        >
                          Item Code - Item Name
                        </TableCell>
                        <TableCell
                          sx={{
                            fontWeight: 700,
                            backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            minWidth: 80,
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                          align="right"
                        >
                          Qty
                        </TableCell>
                        <TableCell
                          sx={{
                            fontWeight: 700,
                            backgroundColor: alpha(theme.palette.primary.main, 0.12),
                            minWidth: 250,
                            position: 'sticky',
                            top: 0,
                            zIndex: 10,
                          }}
                        >
                          Registration Number (PPKEK)
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data
                        .filter((item) => item.source_type === 'incoming')
                        .map((item) => (
                          item.incoming_ppkek_numbers.length > 0 ? (
                            item.incoming_ppkek_numbers.map((ppkek, idx) => (
                              <TableRow key={`incoming-${item.item_code}-ppkek-${idx}`} hover>
                                {idx === 0 && (
                                  <>
                                    <TableCell
                                      rowSpan={item.incoming_ppkek_numbers.length}
                                      sx={{
                                        fontWeight: 600,
                                        backgroundColor: alpha(theme.palette.primary.main, 0.05),
                                        borderRight: `2px solid ${theme.palette.divider}`,
                                        verticalAlign: 'top',
                                      }}
                                    >
                                      <Box>
                                        <Typography variant="body2" fontWeight={600}>
                                          {item.item_code}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                          {item.item_name}
                                        </Typography>
                                      </Box>
                                    </TableCell>
                                    <TableCell
                                      rowSpan={item.incoming_ppkek_numbers.length}
                                      align="right"
                                      sx={{
                                        fontWeight: 600,
                                        backgroundColor: alpha(theme.palette.primary.main, 0.05),
                                        borderRight: `2px solid ${theme.palette.divider}`,
                                        verticalAlign: 'top',
                                      }}
                                    >
                                      {item.qty.toLocaleString()}
                                    </TableCell>
                                  </>
                                )}
                                <TableCell>
                                  <Typography variant="body2">{ppkek}</Typography>
                                </TableCell>
                              </TableRow>
                            ))
                          ) : (
                            <TableRow key={`incoming-${item.item_code}-empty`} hover>
                              <TableCell
                                sx={{
                                  fontWeight: 600,
                                  backgroundColor: alpha(theme.palette.primary.main, 0.05),
                                  borderRight: `2px solid ${theme.palette.divider}`,
                                }}
                              >
                                <Box>
                                  <Typography variant="body2" fontWeight={600}>
                                    {item.item_code}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {item.item_name}
                                  </Typography>
                                </Box>
                              </TableCell>
                              <TableCell
                                align="right"
                                sx={{
                                  fontWeight: 600,
                                  backgroundColor: alpha(theme.palette.primary.main, 0.05),
                                  borderRight: `2px solid ${theme.palette.divider}`,
                                }}
                              >
                                {item.qty.toLocaleString()}
                              </TableCell>
                              <TableCell sx={{ color: 'text.secondary' }}>-</TableCell>
                            </TableRow>
                          )
                        ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            )}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ pt: 0, pb: 2, pr: 3 }}>
        <Button onClick={onClose} variant="outlined" color="primary">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
