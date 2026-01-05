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
  Box,
  CircularProgress,
} from '@mui/material';
import { formatQty } from '@/lib/utils/format';


export interface WIPData {
  id: string;
  no: number;
  companyName: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  unitQuantity: string;
  quantity: number;
  stockDate: Date | string;
  remarks: string | null;
  createdAt: Date | string;
}

interface WIPReportTableProps {
  data: WIPData[];
  page: number;
  rowsPerPage: number;
  onPageChange: (event: unknown, newPage: number) => void;
  onRowsPerPageChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  loading?: boolean;
}

export function WIPReportTable({
  data,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  loading = false,
}: WIPReportTableProps) {
  const theme = useTheme();
  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  const formatDate = (date: Date | string | null | undefined): string => {
    if (!date) return '-';

    try {
      const dateObj = typeof date === 'string' ? new Date(date) : date;

      if (!(dateObj instanceof Date) || isNaN(dateObj.getTime())) {
        return '-';
      }

      return dateObj.toLocaleDateString('id-ID', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch (error) {
      console.error('Error formatting date:', error, date);
      return '-';
    }
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
        <Table sx={{ minWidth: 650 }} aria-label="wip report table">
          <TableHead>
            <TableRow
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.08),
              }}
            >
              <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Company Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Unit</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Quantity</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Stock Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Remarks</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Created At</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={10}
                  align="center"
                  sx={{ py: 8 }}
                >
                  <Typography variant="body1" color="text.secondary">
                    No records found for the selected date range
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row) => (
                <TableRow
                  key={row.id}
                  sx={{
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.04),
                    },
                  }}
                >
                  <TableCell>{row.no}</TableCell>
                  <TableCell>{row.companyName || '-'}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.itemCode}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.itemName}</TableCell>
                  <TableCell>
                    <Chip label={row.itemType} size="small" color="info" />
                  </TableCell>
                  <TableCell>
                    <Chip label={row.unitQuantity} size="small" />
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={700}>
                      {formatQty(row.quantity)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(row.stockDate)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {row.remarks || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {formatDate(row.createdAt)}
                    </Typography>
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
