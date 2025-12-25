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

interface TraceabilityWorkOrder {
  work_order_number: string;
  ppkek_numbers: string[];
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
 * Displays traceability data for outgoing items with hierarchical row merging:
 * - Item Code & Name columns merge for all work orders of same item
 * - Qty column merges for all work orders of same item
 * - Each work order gets its own row
 * - PPKEK numbers are comma-separated within each work order row
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
   * Maps item_code -> starting row index & row span count
   */
  const getItemRowSpans = (): Map<string, { startRow: number; rowSpan: number }> => {
    const spans = new Map<string, { startRow: number; rowSpan: number }>();
    let currentRow = 0;

    data.forEach((item) => {
      const rowCount = Math.max(1, item.work_orders.length);
      spans.set(item.item_code, { startRow: currentRow, rowSpan: rowCount });
      currentRow += rowCount;
    });

    return spans;
  };

  /**
   * Render table rows with proper row spans
   */
  const renderTableRows = () => {
    const itemRowSpans = getItemRowSpans();
    const rows: React.ReactNode[] = [];
    let rowIndex = 0;

    data.forEach((item) => {
      const { rowSpan } = itemRowSpans.get(item.item_code)!;

      if (item.work_orders.length === 0) {
        // No work orders - show single row with dashes
        return rows.push(
          <TableRow key={`${item.item_code}-no-wo`} hover>
            {/* Item Code - Item Name (merged) */}
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

            {/* Qty (merged) */}
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

            {/* Work Order Number */}
            <TableCell sx={{ color: 'text.secondary' }}>-</TableCell>

            {/* PPKEK Numbers */}
            <TableCell sx={{ color: 'text.secondary' }}>-</TableCell>
          </TableRow>
        );
      }

      // Render rows for each work order
      item.work_orders.forEach((wo, woIndex) => {
        const isFirstRow = woIndex === 0;

        rows.push(
          <TableRow key={`${item.item_code}-${wo.work_order_number}`} hover>
            {/* Item Code - Item Name (only on first row of item) */}
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

            {/* Qty (only on first row of item) */}
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

            {/* Work Order Number */}
            <TableCell sx={{ fontWeight: 500 }}>{wo.work_order_number}</TableCell>

            {/* PPKEK Numbers (comma separated) */}
            <TableCell>
              {wo.ppkek_numbers.length > 0 ? (
                wo.ppkek_numbers.join(', ')
              ) : (
                <Typography variant="caption" color="text.secondary">
                  -
                </Typography>
              )}
            </TableCell>
          </TableRow>
        );

        rowIndex++;
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
          <TableContainer sx={{ maxHeight: '500px' }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12) }}>
                  <TableCell
                    sx={{
                      fontWeight: 700,
                      backgroundColor: alpha(theme.palette.primary.main, 0.12),
                      minWidth: 200,
                    }}
                  >
                    Item Code - Item Name
                  </TableCell>
                  <TableCell
                    sx={{
                      fontWeight: 700,
                      backgroundColor: alpha(theme.palette.primary.main, 0.12),
                      minWidth: 80,
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
                    }}
                  >
                    Work Order Number
                  </TableCell>
                  <TableCell
                    sx={{
                      fontWeight: 700,
                      backgroundColor: alpha(theme.palette.primary.main, 0.12),
                      minWidth: 250,
                    }}
                  >
                    PPKEK Numbers
                  </TableCell>
                </TableRow>
              </TableHead>
              <TableBody>{renderTableRows()}</TableBody>
            </Table>
          </TableContainer>
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
