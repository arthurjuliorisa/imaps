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
import { formatQty, formatAmount } from '@/lib/utils/format';

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
  hideRemarks?: boolean;
  hideActions?: boolean;
  hideValueAmount?: boolean;
  hideRowNumber?: boolean;
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
  hideRemarks = false,
  hideActions = false,
  hideValueAmount = false,
  hideRowNumber = true,
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
              {hasRowNumber && !hideRowNumber && <TableCell sx={{ fontWeight: 600 }}>Row Number</TableCell>}
              {hasCompanyCode && <TableCell sx={{ fontWeight: 600 }}>Company Code</TableCell>}
              {hasCompanyName && <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>}
              <TableCell sx={{ fontWeight: 600 }}>Kode Barang</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Nama Barang</TableCell>
              {hasItemType && <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>}
              <TableCell sx={{ fontWeight: 600 }}>Satuan Barang</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Saldo Awal</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah Pemasukan Barang</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah Pengeluaran Barang</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Penyesuaian (Adjustment)</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Saldo Akhir</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Hasil Pencacahan</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Jumlah Selisih</TableCell>
              {!hideValueAmount && hasValueAmount && <TableCell sx={{ fontWeight: 600 }} align="right">Value Amount</TableCell>}
              {!hideValueAmount && hasCurrency && <TableCell sx={{ fontWeight: 600 }}>Currency</TableCell>}
              {!hideRemarks && <TableCell sx={{ fontWeight: 600 }}>Keterangan</TableCell>}
              {!hideActions && <TableCell sx={{ fontWeight: 600 }} align="center">Action</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={13 + (hasRowNumber && !hideRowNumber ? 1 : 0) + (hasCompanyCode ? 1 : 0) + (hasCompanyName ? 1 : 0) + (hasItemType ? 1 : 0) + (!hideValueAmount && hasValueAmount ? 1 : 0) + (!hideValueAmount && hasCurrency ? 1 : 0) - (hideRemarks ? 1 : 0) - (hideActions ? 1 : 0)}
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
                  {hasRowNumber && !hideRowNumber && <TableCell>{row.rowNumber ?? '-'}</TableCell>}
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
                  <TableCell align="right">{formatQty(row.beginning ?? 0)}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="success.main" fontWeight={600}>
                      {formatQty(row.in ?? 0)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="error.main" fontWeight={600}>
                      {formatQty(row.out ?? 0)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{formatQty(row.adjustment ?? 0)}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700}>
                      {formatQty(row.ending ?? 0)}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{formatQty(row.stockOpname ?? 0)}</TableCell>
                  <TableCell align="right">
                    <Chip
                      label={formatQty(row.variant ?? 0)}
                      size="small"
                      color={getVariantColor(row.variant ?? 0)}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
                  {!hideValueAmount && hasValueAmount && (
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {row.valueAmount !== undefined
                          ? row.currency
                            ? `${row.currency} ${formatAmount(row.valueAmount)}`
                            : formatAmount(row.valueAmount)
                          : '-'}
                      </Typography>
                    </TableCell>
                  )}
                  {!hideValueAmount && hasCurrency && !hasValueAmount && (
                    <TableCell>
                      <Chip label={row.currency || '-'} size="small" variant="outlined" />
                    </TableCell>
                  )}
                  {!hideRemarks && (
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {row.remarks || '-'}
                      </Typography>
                    </TableCell>
                  )}
                  {!hideActions && (
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
                  )}
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
