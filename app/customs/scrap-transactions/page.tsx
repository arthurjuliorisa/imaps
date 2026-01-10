'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Stack, Button, CircularProgress, Typography, TextField, InputAdornment, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import {
  Add as AddIcon,
  UploadFile as UploadFileIcon,
  RemoveCircleOutline as RemoveIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon
} from '@mui/icons-material';
import { DataGrid, GridColDef, GridRenderCellParams } from '@mui/x-data-grid';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { AddInScrapDialog } from '@/app/components/customs/AddInScrapDialog';
import { AddOutScrapDialog } from '@/app/components/customs/AddOutScrapDialog';
import { ImportCeisaExcelDialog } from '@/app/components/customs/ImportCeisaExcelDialog';
import { ImportScrapIncomingExcelDialog } from '@/app/components/customs/ImportScrapIncomingExcelDialog';
import { EditScrapTransactionDialog } from '@/app/components/customs/EditScrapTransactionDialog';
import { useToast } from '@/app/components/ToastProvider';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';
import { formatQty, formatAmount } from '@/lib/utils/format';
import type { ScrapTransaction } from '@/types/transaction';

export default function ScrapTransactionsPage() {
  const toast = useToast();

  const now = new Date();

  const [startDate, setStartDate] = useState(now.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [data, setData] = useState<ScrapTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10,
  });
  const [addInDialogOpen, setAddInDialogOpen] = useState(false);
  const [addOutDialogOpen, setAddOutDialogOpen] = useState(false);
  const [importIncomingDialogOpen, setImportIncomingDialogOpen] = useState(false);
  const [importOutgoingDialogOpen, setImportOutgoingDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<ScrapTransaction | null>(null);
  const [deleting, setDeleting] = useState(false);

  const columns: GridColDef[] = [
    {
      field: 'no',
      headerName: 'No',
      width: 70,
      valueGetter: (value, row, column, apiRef) => {
        const rowIndex = apiRef.current.getRowIndexRelativeToVisibleRows(row.id);
        return paginationModel.page * paginationModel.pageSize + rowIndex + 1;
      },
    },
    {
      field: 'companyName',
      headerName: 'Company Name',
      width: 150,
    },
    {
      field: 'transactionType',
      headerName: 'Type',
      width: 80,
    },
    {
      field: 'docType',
      headerName: 'Doc Type',
      width: 100,
    },
    {
      field: 'ppkekNumber',
      headerName: 'Nomor Pendaftaran',
      width: 140,
    },
    {
      field: 'regDate',
      headerName: 'Reg Date',
      width: 120,
      valueFormatter: (value) => value ? formatDate(value) : '',
    },
    {
      field: 'docNumber',
      headerName: 'Doc Number',
      width: 140,
    },
    {
      field: 'docDate',
      headerName: 'Doc Date',
      width: 120,
      valueFormatter: (value) => value ? formatDate(value) : '',
    },
    {
      field: 'recipientName',
      headerName: 'Recipient Name',
      width: 150,
    },
    {
      field: 'itemType',
      headerName: 'Item Type',
      width: 120,
    },
    {
      field: 'itemCode',
      headerName: 'Item Code',
      width: 120,
    },
    {
      field: 'itemName',
      headerName: 'Item Name',
      width: 200,
    },
    {
      field: 'unit',
      headerName: 'Unit',
      width: 80,
    },
    {
      field: 'inQty',
      headerName: 'In',
      width: 100,
      type: 'number',
      valueFormatter: (value: number) => value ? formatQty(value) : '0',
    },
    {
      field: 'outQty',
      headerName: 'Out',
      width: 100,
      type: 'number',
      valueFormatter: (value: number) => value ? formatQty(value) : '0',
    },
    {
      field: 'currency',
      headerName: 'Currency',
      width: 100,
    },
    {
      field: 'valueAmount',
      headerName: 'Value Amount',
      width: 140,
      type: 'number',
      valueFormatter: (value: number) => value ? formatAmount(value) : '0',
    },
    {
      field: 'remarks',
      headerName: 'Remarks',
      width: 200,
    },
    {
      field: 'createdAt',
      headerName: 'Created At',
      width: 160,
      valueFormatter: (value) => value ? formatDate(value) : '',
    },
    {
      field: 'actions',
      headerName: 'Actions',
      width: 120,
      sortable: false,
      filterable: false,
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="Edit">
            <IconButton
              size="small"
              color="primary"
              onClick={() => handleEdit(params.row)}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={() => handleDeleteClick(params.row)}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ),
    },
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/customs/scrap-transactions?startDate=${startDate}&endDate=${endDate}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }

      const result = await response.json();
      setData(result.data || []);
    } catch (error) {
      console.error('Error fetching scrap transactions:', error);
      toast.error('Failed to load scrap transaction data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddIn = () => {
    setAddInDialogOpen(true);
  };

  const handleAddOut = () => {
    setAddOutDialogOpen(true);
  };

  const handleImportIncoming = () => {
    setImportIncomingDialogOpen(true);
  };

  const handleImportOutgoing = () => {
    setImportOutgoingDialogOpen(true);
  };

  const handleDialogSuccess = () => {
    fetchData();
  };

  const handleEdit = (transaction: ScrapTransaction) => {
    setSelectedTransaction(transaction);
    setEditDialogOpen(true);
  };

  const handleDeleteClick = (transaction: ScrapTransaction) => {
    setSelectedTransaction(transaction);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedTransaction) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/customs/scrap-transactions/${selectedTransaction.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to delete transaction');
      }

      toast.success('Transaction deleted successfully');
      setDeleteDialogOpen(false);
      setSelectedTransaction(null);
      fetchData();
    } catch (error) {
      console.error('Error deleting transaction:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete transaction');
    } finally {
      setDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteDialogOpen(false);
    setSelectedTransaction(null);
  };

  // Filter data based on search query
  const filteredData = useMemo(() => {
    if (!searchQuery.trim()) {
      return data;
    }

    const query = searchQuery.toLowerCase();
    return data.filter((row) => {
      return (
        row.companyName?.toLowerCase().includes(query) ||
        row.transactionType?.toLowerCase().includes(query) ||
        row.docType?.toLowerCase().includes(query) ||
        row.ppkekNumber?.toLowerCase().includes(query) ||
        row.docNumber?.toLowerCase().includes(query) ||
        row.recipientName?.toLowerCase().includes(query) ||
        row.itemType?.toLowerCase().includes(query) ||
        row.itemCode?.toLowerCase().includes(query) ||
        row.itemName?.toLowerCase().includes(query) ||
        row.unit?.toLowerCase().includes(query) ||
        row.currency?.toLowerCase().includes(query) ||
        row.remarks?.toLowerCase().includes(query)
      );
    });
  }, [data, searchQuery]);

  const handleExportExcel = () => {
    const exportData = filteredData.map((row, index) => ({
      No: index + 1,
      'Company Name': row.companyName,
      'Type': row.transactionType,
      'Doc Type': row.docType || '-',
      'Nomor Pendaftaran': row.ppkekNumber,
      'Reg Date': formatDate(row.regDate),
      'Doc Number': row.docNumber,
      'Doc Date': formatDate(row.docDate),
      'Recipient Name': row.recipientName,
      'Item Type': row.itemType,
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'Unit': row.unit,
      'In': row.inQty,
      'Out': row.outQty,
      'Currency': row.currency,
      'Value Amount': row.valueAmount,
      'Remarks': row.remarks,
      'Created At': formatDate(row.createdAt),
    }));

    exportToExcel(
      exportData,
      `Transaksi_Scrap_${startDate}_${endDate}`,
      'Scrap Transactions'
    );
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName,
      transactionType: row.transactionType,
      docType: row.docType || '-',
      ppkekNumber: row.ppkekNumber,
      regDate: formatDate(row.regDate),
      docNumber: row.docNumber,
      docDate: formatDate(row.docDate),
      recipientName: row.recipientName,
      itemType: row.itemType,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      inQty: (row.inQty || 0).toString(),
      outQty: (row.outQty || 0).toString(),
      currency: row.currency || '',
      valueAmount: (row.valueAmount || 0).toString(),
      remarks: row.remarks,
    }));

    const pdfColumns = [
      { header: 'No', dataKey: 'no' },
      { header: 'Company', dataKey: 'companyName' },
      { header: 'Type', dataKey: 'transactionType' },
      { header: 'Doc Type', dataKey: 'docType' },
      { header: 'Nomor Pendaftaran', dataKey: 'ppkekNumber' },
      { header: 'Reg Date', dataKey: 'regDate' },
      { header: 'Doc Number', dataKey: 'docNumber' },
      { header: 'Doc Date', dataKey: 'docDate' },
      { header: 'Recipient', dataKey: 'recipientName' },
      { header: 'Item Type', dataKey: 'itemType' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Unit', dataKey: 'unit' },
      { header: 'In', dataKey: 'inQty' },
      { header: 'Out', dataKey: 'outQty' },
      { header: 'Currency', dataKey: 'currency' },
      { header: 'Value', dataKey: 'valueAmount' },
      { header: 'Remarks', dataKey: 'remarks' },
    ];

    exportToPDF(
      exportData,
      pdfColumns,
      `Transaksi_Scrap_${startDate}_${endDate}`,
      'Transaksi Scrap',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  return (
    <ReportLayout
      title="Transaksi Scrap"
      subtitle="Scrap transaction records"
      actions={
        <Stack spacing={2}>
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                color="success"
                startIcon={<AddIcon />}
                onClick={handleAddIn}
                disabled={loading}
              >
                Add In
              </Button>
              <Button
                variant="contained"
                color="error"
                startIcon={<RemoveIcon />}
                onClick={handleAddOut}
                disabled={loading}
              >
                Add Out
              </Button>
              <Button
                variant="outlined"
                color="success"
                startIcon={<UploadFileIcon />}
                onClick={handleImportIncoming}
                disabled={loading}
              >
                Import Incoming
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<UploadFileIcon />}
                onClick={handleImportOutgoing}
                disabled={loading}
              >
                Import Outgoing
              </Button>
            </Stack>
            <ExportButtons
              onExportExcel={handleExportExcel}
              onExportPDF={handleExportPDF}
              disabled={filteredData.length === 0 || loading}
            />
          </Box>
        </Stack>
      }
    >
      <Box sx={{ width: '100%', mt: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 3, px: 3 }}>
          <TextField
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            size="small"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon />
                </InputAdornment>
              ),
            }}
            sx={{ maxWidth: 400 }}
          />
        </Box>
        <DataGrid
          rows={filteredData}
          columns={columns}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          pageSizeOptions={[10, 20, 50, 100]}
          loading={loading}
          disableRowSelectionOnClick
          autoHeight
          sx={{
            '& .MuiDataGrid-cell': {
              borderRight: '1px solid',
              borderColor: 'divider',
            },
            '& .MuiDataGrid-columnHeaders': {
              backgroundColor: 'primary.main',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
            },
            '& .MuiDataGrid-columnHeader': {
              backgroundColor: 'primary.main',
              color: 'white',
              fontSize: 14,
              fontWeight: 600,
            },
            '& .MuiDataGrid-row:hover': {
              backgroundColor: 'action.hover',
            },
          }}
          slots={{
            noRowsOverlay: () => (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', p: 4 }}>
                <Typography variant="body1" color="text.secondary">
                  No scrap transactions found for the selected date range
                </Typography>
              </Box>
            ),
            loadingOverlay: () => (
              <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
                <CircularProgress />
              </Box>
            ),
          }}
        />
      </Box>

      <AddInScrapDialog
        open={addInDialogOpen}
        onClose={() => setAddInDialogOpen(false)}
        onSuccess={handleDialogSuccess}
      />

      <AddOutScrapDialog
        open={addOutDialogOpen}
        onClose={() => setAddOutDialogOpen(false)}
        onSuccess={handleDialogSuccess}
      />

      <ImportScrapIncomingExcelDialog
        open={importIncomingDialogOpen}
        onClose={() => setImportIncomingDialogOpen(false)}
        onSuccess={handleDialogSuccess}
      />

      <ImportCeisaExcelDialog
        open={importOutgoingDialogOpen}
        onClose={() => setImportOutgoingDialogOpen(false)}
        onSuccess={handleDialogSuccess}
        transactionType="SCRAP"
        defaultDirection="OUT"
        allowDirectionChange={false}
      />

      <EditScrapTransactionDialog
        open={editDialogOpen}
        transaction={selectedTransaction}
        onClose={() => {
          setEditDialogOpen(false);
          setSelectedTransaction(null);
        }}
        onSuccess={handleDialogSuccess}
      />

      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this scrap transaction?
            {selectedTransaction && (
              <>
                <br /><br />
                <strong>Doc Number:</strong> {selectedTransaction.docNumber}<br />
                <strong>Item:</strong> {selectedTransaction.itemName}<br />
                <strong>Type:</strong> {selectedTransaction.transactionType}
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeleteCancel} disabled={deleting}>
            Cancel
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" variant="contained" disabled={deleting}>
            {deleting ? 'Deleting...' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </ReportLayout>
  );
}
