'use client';

import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Chip,
  IconButton,
  Tooltip,
  Typography,
  alpha,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@mui/material';
import { Visibility, Delete } from '@mui/icons-material';
import { useRouter } from 'next/navigation';
import { StockOpname } from '@/types/stock-opname';
import { useToast } from '@/app/components/ToastProvider';

interface StockOpnameTableProps {
  data: StockOpname[];
  loading: boolean;
  onDelete: (id: number) => void;
}

export function StockOpnameTable({ data, loading, onDelete }: StockOpnameTableProps) {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; id: number | null }>({
    open: false,
    id: null,
  });
  const [companyNames, setCompanyNames] = useState<Record<string, string>>({});

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleDeleteClick = (id: number) => {
    setDeleteDialog({ open: true, id });
  };

  const handleDeleteConfirm = () => {
    if (deleteDialog.id !== null) {
      onDelete(deleteDialog.id);
      setDeleteDialog({ open: false, id: null });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialog({ open: false, id: null });
  };

  const formatDateTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }).replace(',', '');
    } catch {
      return '-';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'OPEN':
        return 'warning';
      case 'PROCESS':
        return 'info';
      case 'RELEASED':
        return 'success';
      default:
        return 'default';
    }
  };

  React.useEffect(() => {
    const fetchCompanyNames = async () => {
      const uniqueCompanyCodes = [...new Set(data.map(item => item.company_code))];
      const names: Record<string, string> = {};

      for (const code of uniqueCompanyCodes) {
        try {
          const response = await fetch(`/api/master/companies?code=${code}`);
          if (response.ok) {
            const result = await response.json();
            if (result.success && result.data && result.data.length > 0) {
              names[code] = result.data[0].name;
            }
          }
        } catch (error) {
          console.error(`Failed to fetch company name for code ${code}:`, error);
        }
      }

      setCompanyNames(names);
    };

    if (data.length > 0) {
      fetchCompanyNames();
    }
  }, [data]);

  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  return (
    <>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
              <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Company</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>STO Number</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>STO Date & Time</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>PIC Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Total Items</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Created By</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">
                    Loading...
                  </Typography>
                </TableCell>
              </TableRow>
            ) : paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">
                    No stock opname records found
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
                      {row.company_code}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {companyNames[row.company_code] || 'Loading...'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.sto_number}
                    </Typography>
                  </TableCell>
                  <TableCell>{formatDateTime(row.sto_datetime)}</TableCell>
                  <TableCell>{row.pic_name || '-'}</TableCell>
                  <TableCell>
                    <Chip
                      label={row.status}
                      color={getStatusColor(row.status)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell align="right">
                    {row._count?.stock_opname_items || 0}
                  </TableCell>
                  <TableCell>{row.created_by}</TableCell>
                  <TableCell align="center">
                    <Tooltip title="View Details">
                      <IconButton
                        size="small"
                        color="primary"
                        onClick={() => router.push(`/customs/stock-opname/${row.id}`)}
                      >
                        <Visibility fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {row.status === 'OPEN' && (
                      <Tooltip title="Delete">
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() => handleDeleteClick(row.id)}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
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
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />

      <Dialog open={deleteDialog.open} onClose={handleDeleteCancel}>
        <DialogTitle>Delete Stock Opname</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Delete this Stock Opname? This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel}>Cancel</Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
