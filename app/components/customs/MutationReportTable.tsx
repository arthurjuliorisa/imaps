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
  id: number;
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
  remarks: string;
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
}: MutationReportTableProps) {
  const theme = useTheme();
  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const getVariantColor = (variant: number): 'success' | 'error' | 'default' => {
    if (variant > 0) return 'success';
    if (variant < 0) return 'error';
    return 'default';
  };

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
              <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Beginning</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">In</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Out</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Adjustment</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Ending</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Stock Opname</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Variant</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Remarks</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="center">Action</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} align="center" sx={{ py: 8 }}>
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
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.itemCode}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.itemName}</TableCell>
                  <TableCell>
                    <Chip label={row.unit} size="small" />
                  </TableCell>
                  <TableCell align="right">{(row.beginning ?? 0).toLocaleString('id-ID')}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="success.main" fontWeight={600}>
                      {(row.in ?? 0).toLocaleString('id-ID')}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" color="error.main" fontWeight={600}>
                      {(row.out ?? 0).toLocaleString('id-ID')}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{(row.adjustment ?? 0).toLocaleString('id-ID')}</TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700}>
                      {(row.ending ?? 0).toLocaleString('id-ID')}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">{(row.stockOpname ?? 0).toLocaleString('id-ID')}</TableCell>
                  <TableCell align="right">
                    <Chip
                      label={(row.variant ?? 0).toLocaleString('id-ID')}
                      size="small"
                      color={getVariantColor(row.variant ?? 0)}
                      sx={{ fontWeight: 600 }}
                    />
                  </TableCell>
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
