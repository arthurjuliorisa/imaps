'use client';

import React, { useState, useMemo } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  Typography,
  alpha,
  useTheme,
  IconButton,
  Tooltip,
  TextField,
  InputAdornment,
  Box,
  Stack,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Paper,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  FileDownload,
} from '@mui/icons-material';
import { StockOpnameItem, StockOpname } from '@/types/stock-opname';
import { useToast } from '@/app/components/ToastProvider';
import { exportStockOpnameToExcel } from '@/lib/exportUtils';

interface ItemsTableProps {
  items: StockOpnameItem[];
  stockOpname: StockOpname;
  canEdit: boolean;
  onEdit: (item: StockOpnameItem) => void;
  onDelete: (itemId: bigint | string) => void;
}

export function ItemsTable({ items, stockOpname, canEdit, onEdit, onDelete }: ItemsTableProps) {
  const theme = useTheme();
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [companyName, setCompanyName] = useState<string>('');
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; itemId: bigint | string | null }>({
    open: false,
    itemId: null,
  });

  React.useEffect(() => {
    const fetchCompanyName = async () => {
      try {
        const response = await fetch(`/api/master/companies?code=${stockOpname.company_code}`);
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.data && result.data.length > 0) {
            setCompanyName(result.data[0].name);
          }
        }
      } catch (error) {
        console.error('Failed to fetch company name:', error);
      }
    };

    fetchCompanyName();
  }, [stockOpname.company_code]);

  const formatDateTime = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).replace(',', '');
    } catch {
      return '-';
    }
  };

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;

    const query = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.item_code.toLowerCase().includes(query) ||
        item.item_name.toLowerCase().includes(query)
    );
  }, [items, searchQuery]);

  const paginatedItems = filteredItems.slice(
    page * rowsPerPage,
    page * rowsPerPage + rowsPerPage
  );

  const totals = useMemo(() => {
    return filteredItems.reduce(
      (acc, item) => ({
        sto_qty: acc.sto_qty + Number(item.sto_qty || 0),
        end_stock: acc.end_stock + Number(item.end_stock || 0),
        variant: acc.variant + Number(item.variant || 0),
      }),
      { sto_qty: 0, end_stock: 0, variant: 0 }
    );
  }, [filteredItems]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleDeleteClick = (itemId: bigint | string) => {
    setDeleteDialog({ open: true, itemId });
  };

  const handleDeleteConfirm = () => {
    if (deleteDialog.itemId !== null) {
      onDelete(deleteDialog.itemId);
      setDeleteDialog({ open: false, itemId: null });
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialog({ open: false, itemId: null });
  };

  const handleExportExcel = () => {
    // Header information
    const headerInfo = [
      { label: 'STO Number', value: stockOpname.sto_number },
      { label: 'Company', value: `${stockOpname.company_code} - ${companyName || 'Loading...'}` },
      { label: 'STO Date & Time', value: formatDateTime(stockOpname.sto_datetime) + ' ' + new Date(stockOpname.sto_datetime).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) },
      { label: 'PIC Name', value: stockOpname.pic_name || '-' },
      { label: 'Status', value: stockOpname.status },
      { label: 'Created By', value: stockOpname.created_by },
      { label: '', value: '' }, // Empty row
    ];

    // Items data
    const exportData = filteredItems.map((item, index) => ({
      No: index + 1,
      'Item Code': item.item_code,
      'Item Name': item.item_name,
      'Item Type': item.item_type,
      'STO Date': formatDateTime(stockOpname.sto_datetime),
      'STO Qty': item.sto_qty,
      'End Stock': item.end_stock,
      Variance: item.variant,
      'Report Area': item.report_area || '-',
      Remark: item.remark || '-',
    }));

    exportStockOpnameToExcel(headerInfo, exportData, `Stock_Opname_${stockOpname.sto_number}_${Date.now()}`);
    toast.success('Export successful');
  };

  const getVarianceColor = (variance: number) => {
    if (variance > 0) return theme.palette.success.main;
    if (variance < 0) return theme.palette.error.main;
    return theme.palette.text.secondary;
  };

  return (
    <>
      <Paper sx={{ p: 2, mb: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <TextField
            placeholder="Search by item code or name..."
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setPage(0);
            }}
            size="small"
            sx={{ flex: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
          />
          <Button
            variant="outlined"
            startIcon={<FileDownload />}
            onClick={handleExportExcel}
            disabled={filteredItems.length === 0}
          >
            Export to Excel
          </Button>
        </Stack>
      </Paper>

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
              <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>STO Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">STO Qty</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">End Stock</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">Variance</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Report Area</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Remark</TableCell>
              {canEdit && <TableCell sx={{ fontWeight: 600 }} align="center">Actions</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canEdit ? 9 : 8} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">
                    No items found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              <>
                {paginatedItems.map((item, index) => (
                  <TableRow
                    key={item.id}
                    sx={{
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <TableCell>{page * rowsPerPage + index + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {item.item_code}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {item.item_name}
                      </Typography>
                      <br />
                      <Typography variant="caption" color="text.secondary">
                        ({item.item_type})
                      </Typography>
                    </TableCell>
                    <TableCell>{formatDateTime(stockOpname.sto_datetime)}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {Number(item.sto_qty || 0).toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography variant="body2">
                        {Number(item.end_stock || 0).toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        sx={{ color: getVarianceColor(item.variant) }}
                      >
                        {Number(item.variant || 0).toFixed(2)}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.report_area || '-'}</TableCell>
                    <TableCell>
                      {item.remark ? (
                        <Tooltip title={item.remark}>
                          <Typography
                            variant="body2"
                            sx={{
                              maxWidth: 150,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {item.remark}
                          </Typography>
                        </Tooltip>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    {canEdit && (
                      <TableCell align="center">
                        <Tooltip title="Edit">
                          <IconButton size="small" color="primary" onClick={() => onEdit(item)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDeleteClick(item.id)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                ))}

                <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.12) }}>
                  <TableCell colSpan={3} sx={{ fontWeight: 600 }}>
                    TOTAL
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    {totals.sto_qty.toFixed(2)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>
                    {totals.end_stock.toFixed(2)}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600, color: getVarianceColor(totals.variant) }}>
                    {totals.variant.toFixed(2)}
                  </TableCell>
                  <TableCell colSpan={canEdit ? 3 : 2} />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <TablePagination
        rowsPerPageOptions={[5, 10, 25, 50]}
        component="div"
        count={filteredItems.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />

      <Dialog open={deleteDialog.open} onClose={handleDeleteCancel}>
        <DialogTitle>Delete Item</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Remove this item from Stock Opname?
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
