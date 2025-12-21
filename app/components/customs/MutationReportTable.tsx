'use client';

import React from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  TablePagination,
  alpha,
  useTheme,
  Chip,
  IconButton,
  Tooltip,
  Box,
  CircularProgress,
} from '@mui/material';
import { Edit as EditIcon, Visibility as ViewIcon } from '@mui/icons-material';

export interface MutationData {
  id: string;
  itemCode: string;
  itemName: string;
  unit: string;
  beginning: number;
  in: number;
  out: number;
  adjustment: number;
  ending: number;
  stockOpname: number;
  variant: number;
  remarks: string | null;
  rowNumber?: number;
  companyCode?: number;
  companyName?: string;
  itemType?: string;
  valueAmount?: number;
  currency?: string;
}

interface MutationReportTableProps {
  data: MutationData[];
  page: number;
  rowsPerPage: number;
  onPageChange: (event: unknown, newPage: number) => void;
  onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  onEdit?: (item: MutationData) => void;
  onView?: (item: MutationData) => void;
  loading?: boolean;
  showOnlyEnding?: boolean; // For WIP page: only show ending balance without transaction columns
}

export function MutationReportTable({
  data,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  onEdit,
  onView,
  loading = false,
  showOnlyEnding = false,
}: MutationReportTableProps) {
  const theme = useTheme();
  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const getVariantColor = (variant: number): 'success' | 'error' | 'default' => {
    if (variant > 0) return 'success';
    if (variant < 0) return 'error';
    return 'default';
  };

  const hasRowNumber = data.some((item) => item.rowNumber !== undefined);
  const hasCompanyCode = data.some((item) => item.companyCode !== undefined);
  const hasValueAmount = data.some((item) => item.valueAmount !== undefined);
  const hasCurrency = data.some((item) => item.currency !== undefined);

  // Always show Company Name and Item Type in LPJ Mutasi reports
  const hasCompanyName = true;
  const hasItemType = true;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <>
      <TableContainer>
        <Table sx={{ minWidth: 650 }} aria-label="mutation report table">
          <TableHead>
            <TableRow
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.08),
              }}
            >
              <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
              {hasRowNumber && <TableCell sx={{ fontWeight: 600 }}>Row Number</TableCell>}
              {hasCompanyCode && <TableCell sx={{ fontWeight: 600 }}>Company Code</TableCell>}
              {hasCompanyName && <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>}
              <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
              {hasItemType && <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>}
              <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
              {!showOnlyEnding && <TableCell sx={{ fontWeight: 600 }} align="right">Beginning</TableCell>}
              {!showOnlyEnding && <TableCell sx={{ fontWeight: 600 }} align="right">In</TableCell>}
              {!showOnlyEnding && <TableCell sx={{ fontWeight: 600 }} align="right">Out</TableCell>}
              {!showOnlyEnding && <TableCell sx={{ fontWeight: 600 }} align="right">Adjustment</TableCell>}
              <TableCell sx={{ fontWeight: 600 }} align="right">Ending</TableCell>
              {!showOnlyEnding && <TableCell sx={{ fontWeight: 600 }} align="right">Stock Opname</TableCell>}
              {!showOnlyEnding && <TableCell sx={{ fontWeight: 600 }} align="right">Variant</TableCell>}
              {hasValueAmount && <TableCell sx={{ fontWeight: 600 }} align="right">Value Amount</TableCell>}
              {hasCurrency && <TableCell sx={{ fontWeight: 600 }}>Currency</TableCell>}
              <TableCell sx={{ fontWeight: 600 }}>Remarks</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="center">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={13 + (hasRowNumber ? 1 : 0) + (hasCompanyCode ? 1 : 0) + (hasCompanyName ? 1 : 0) + (hasItemType ? 1 : 0) + (hasValueAmount ? 1 : 0) + (hasCurrency ? 1 : 0) - (showOnlyEnding ? 6 : 0)}
                  align="center"
                  sx={{ py: 8 }}
                >
                  <Typography variant="body1" color="text.secondary">
                    No records found for the selected date range
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, index) => (
                <TableRow
                  key={row.id}
                  sx={{
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.04),
                    },
                  }}
                >
                  <TableCell>{page * rowsPerPage + index + 1}</TableCell>
                  {hasRowNumber && <TableCell>{row.rowNumber ?? '-'}</TableCell>}
                  {hasCompanyCode && (
                    <TableCell>
                      <Chip label={row.companyCode} size="small" variant="outlined" />
                    </TableCell>
                  )}
                  {hasCompanyName && <TableCell>{row.companyName || '-'}</TableCell>}
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.itemCode}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.itemName}</TableCell>
                  {hasItemType && (
                    <TableCell>
                      <Chip label={row.itemType} size="small" color="info" />
                    </TableCell>
                  )}
                  <TableCell>
                    <Chip label={row.unit} size="small" />
                  </TableCell>
                  {!showOnlyEnding && <TableCell align="right">{(row.beginning ?? 0).toLocaleString('id-ID')}</TableCell>}
                  {!showOnlyEnding && (
                    <TableCell align="right">
                      <Typography variant="body2" color="success.main" fontWeight={600}>
                        {(row.in ?? 0).toLocaleString('id-ID')}
                      </Typography>
                    </TableCell>
                  )}
                  {!showOnlyEnding && (
                    <TableCell align="right">
                      <Typography variant="body2" color="error.main" fontWeight={600}>
                        {(row.out ?? 0).toLocaleString('id-ID')}
                      </Typography>
                    </TableCell>
                  )}
                  {!showOnlyEnding && <TableCell align="right">{(row.adjustment ?? 0).toLocaleString('id-ID')}</TableCell>}
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700}>
                      {(row.ending ?? 0).toLocaleString('id-ID')}
                    </Typography>
                  </TableCell>
                  {!showOnlyEnding && <TableCell align="right">{(row.stockOpname ?? 0).toLocaleString('id-ID')}</TableCell>}
                  {!showOnlyEnding && (
                    <TableCell align="right">
                      <Chip
                        label={(row.variant ?? 0).toLocaleString('id-ID')}
                        size="small"
                        color={getVariantColor(row.variant ?? 0)}
                        sx={{ fontWeight: 600 }}
                      />
                    </TableCell>
                  )}
                  {hasValueAmount && (
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {row.valueAmount !== undefined
                          ? row.currency
                            ? `${row.currency} ${row.valueAmount.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                            : row.valueAmount.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                          : '-'}
                      </Typography>
                    </TableCell>
                  )}
                  {hasCurrency && !hasValueAmount && (
                    <TableCell>
                      <Chip label={row.currency || '-'} size="small" variant="outlined" />
                    </TableCell>
                  )}
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {row.remarks || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="View Details">
                      <IconButton
                        size="small"
                        onClick={() => onView?.(row)}
                        sx={{ mr: 0.5 }}
                      >
                        <ViewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => onEdit?.(row)}
                        color="primary"
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[5, 10, 25, 50]}
        component="div"
        count={data.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={onPageChange}
        onRowsPerPageChange={onRowsPerPageChange}
      />
    </>
  );
}
