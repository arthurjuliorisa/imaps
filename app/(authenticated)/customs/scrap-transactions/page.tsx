'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Box, Stack, Button, Chip, CircularProgress, Typography, TextField, InputAdornment, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Divider, Table, TableBody, TableCell, TableHead, TableRow, ToggleButton, ToggleButtonGroup } from '@mui/material';
import {
  Add as AddIcon,
  UploadFile as UploadFileIcon,
  RemoveCircleOutline as RemoveIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Send as SendIcon,
  Visibility as VisibilityIcon
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
import { EditScrapTransactionHeaderDialog } from '@/app/components/customs/EditScrapTransactionHeaderDialog';
import { useToast } from '@/app/components/ToastProvider';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';
import { formatQty, formatAmount } from '@/lib/utils/format';
import type { ScrapTransaction } from '@/types/transaction';

type ScrapTransactionDetails = {
  companyName?: string;
  transactionNumber: string;
  transactionDate: string;
  direction: 'IN' | 'OUT';
  documentNumber: string;
  documentDate: string;
  documentType?: string | null;
  registrationNumber?: string | null;
  registrationDate?: string | null;
  recipientName?: string | null;
  remarks?: string | null;
  items: Array<{ code: string; name: string; itemType: string; quantity: number; uom: string; currency?: string; valueAmount?: number }>;
  isSez: boolean;
  inswStatus?: 'NOT_SENT' | 'PENDING' | 'FAILED' | 'SUCCESS';
  lastAttempt?: { status: string; at: string; message?: string | null } | null;
};

export default function ScrapTransactionsPage() {
  const toast = useToast();
  const { data: session } = useSession();

  const now = new Date();

  // Check if user is admin
  const isAdmin = (session?.user as any)?.role === 'ADMIN' || (session?.user as any)?.role === 'SUPER_ADMIN';

  const [startDate, setStartDate] = useState(now.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [data, setData] = useState<ScrapTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10,
  });
  const [rowCount, setRowCount] = useState(0);
  const [addInDialogOpen, setAddInDialogOpen] = useState(false);
  const [addOutDialogOpen, setAddOutDialogOpen] = useState(false);
  const [importIncomingDialogOpen, setImportIncomingDialogOpen] = useState(false);
  const [importOutgoingDialogOpen, setImportOutgoingDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [headerEditDialogOpen, setHeaderEditDialogOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'summary' | 'detail'>('summary');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<ScrapTransaction | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [companyType, setCompanyType] = useState<string | null>(null);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [transactionDetails, setTransactionDetails] = useState<ScrapTransactionDetails | null>(null);

  const isSezCompany = companyType === 'SEZ';
  const columns: GridColDef[] = [
    {
      field: 'no',
      headerName: 'No',
      width: 50,
      valueGetter: (value, row, column, apiRef) => {
        const rowIndex = apiRef.current.getRowIndexRelativeToVisibleRows(row.id);
        return paginationModel.page * paginationModel.pageSize + rowIndex + 1;
      },
    },
    {
      field: 'transactionDate',
      headerName: 'Transaction Date',
      width: 125,
      valueFormatter: (value) => value ? formatDate(value) : '',
    },
    {
      field: 'transactionType',
      headerName: viewMode === 'summary' ? 'Transaction Code' : 'Direction',
      width: 70,
    },
    {
      field: 'docNumber',
      headerName: 'Document Number',
      flex: 1,
      minWidth: 170,
    },
    ...(viewMode === 'summary' ? [
      { field: 'companyName', headerName: 'Company', minWidth: 150, flex: 1 },
      { field: 'ppkekNumber', headerName: 'Registration Number', minWidth: 150 },
      { field: 'regDate', headerName: 'Registration Date', width: 125, valueFormatter: (value: string) => value ? formatDate(value) : '' },
      { field: 'docType', headerName: 'Custom Doc Type', width: 130 },
      { field: 'recipientName', headerName: 'Recipient', minWidth: 140, flex: 1 },
    ] : []),
    ...(viewMode === 'detail' ? [{
      field: 'itemName',
      headerName: 'Scrap Code / Name',
      flex: 1,
      minWidth: 200,
      renderCell: (params: GridRenderCellParams) => <>{params.row.itemCode} / {params.value}</>,
    }, {
      field: 'quantity',
      headerName: 'Quantity',
      width: 110,
      renderCell: (params: GridRenderCellParams) => formatQty(params.row.inQty || params.row.outQty || 0),
    }, {
      field: 'unit',
      headerName: 'UOM',
      width: 85,
    }, {
      field: 'currency', headerName: 'Currency', width: 90,
    }, {
      field: 'valueAmount', headerName: 'Amount', width: 130,
      renderCell: (params: GridRenderCellParams) => `${params.row.currency || ''} ${formatAmount(params.value || 0)}`,
    }] : [{
      field: 'itemCount',
      headerName: 'Items Count',
      width: 120,
      renderCell: (params: GridRenderCellParams) => (
        <Tooltip title={`This row belongs to one transaction header containing ${params.row.itemCount || 1} active item(s).`}>
          <Chip size="small" label={`${params.row.itemCount || 1} item${(params.row.itemCount || 1) === 1 ? '' : 's'}`} />
        </Tooltip>
      ),
    }]),
    ...(isSezCompany ? [{
      field: 'inswStatus',
      headerName: 'INSW Status',
      width: 115,
      renderCell: (params: GridRenderCellParams) => (
        <Chip
          size="small"
          label={(params.row.inswStatus || 'NOT_SENT').replace('_', ' ')}
          color={params.row.inswStatus === 'SUCCESS' ? 'success' : params.row.inswStatus === 'FAILED' ? 'error' : params.row.inswStatus === 'PENDING' ? 'warning' : 'default'}
        />
      ),
    }] : []),
    {
      field: 'actions',
      headerName: 'Actions',
      width: viewMode === 'summary' ? 330 : 220,
      sortable: false,
      filterable: false,
      align: 'center',
      headerAlign: 'center',
      renderCell: (params: GridRenderCellParams) => (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title="View transaction details">
            <Button size="small" variant="text" startIcon={<VisibilityIcon />} onClick={() => handleView(params.row)}>View</Button>
          </Tooltip>
          {viewMode === 'summary' && isSezCompany && (params.row.inswStatus === 'NOT_SENT' || params.row.inswStatus === 'FAILED') && params.row.inswTransactionId && (
            <Tooltip title={`Send the entire document header and all ${params.row.itemCount || 1} active item(s) to INSW`}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<SendIcon />}
                onClick={() => handleSendClick(params.row)}
              >
                {params.row.inswStatus === 'FAILED' ? 'Retry' : 'Send'}
              </Button>
            </Tooltip>
          )}
          {isAdmin && params.row.inswStatus !== 'PENDING' && params.row.inswStatus !== 'SUCCESS' && (
            <>
              <Tooltip title={viewMode === 'summary' ? 'Edit Transaction' : 'Edit Item'}>
                <IconButton
                  size="small"
                  color="primary"
                  onClick={() => viewMode === 'summary' ? handleHeaderEdit(params.row) : handleEdit(params.row)}
                >
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              {viewMode === 'detail' && <Tooltip title="Delete Item">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleDeleteClick(params.row)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>}
              {viewMode === 'summary' && <Tooltip title="Delete Transaction">
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => handleDeleteClick(params.row)}
                >
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </Tooltip>}
            </>
          )}
        </Box>
      ),
    },
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        page: String(paginationModel.page + 1),
        pageSize: String(paginationModel.pageSize),
        ...(searchQuery.trim() && { search: searchQuery.trim() }),
        view: viewMode,
      });

      const response = await fetch(`/api/customs/scrap-transactions?${params}`);

      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }

      const result = await response.json();
      setData(result.data || []);
      setRowCount(result.pagination?.totalRecords || 0);
      setCompanyType(result.companyType || null);
    } catch (error) {
      console.error('Error fetching scrap transactions:', error);
      toast.error('Failed to load scrap transaction data');
      setData([]);
      setRowCount(0);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, paginationModel.page, paginationModel.pageSize, searchQuery, viewMode, toast]);

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

  const handleHeaderEdit = (transaction: ScrapTransaction) => {
    setSelectedTransaction(transaction);
    setHeaderEditDialogOpen(true);
  };

  const handleViewMode = (_event: React.MouseEvent<HTMLElement>, next: 'summary' | 'detail' | null) => {
    if (next) { setViewMode(next); setPaginationModel(current => ({ ...current, page: 0 })); }
  };

  const handleView = async (transaction: ScrapTransaction) => {
    setDetailsDialogOpen(true);
    setTransactionDetails(null);
    setDetailsLoading(true);
    try {
      const response = await fetch(`/api/customs/scrap-transactions/${transaction.id}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to load transaction details');
      setTransactionDetails(result.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load transaction details');
      setDetailsDialogOpen(false);
    } finally {
      setDetailsLoading(false);
    }
  };

  const handleDeleteClick = (transaction: ScrapTransaction) => {
    setSelectedTransaction(transaction);
    setDeleteDialogOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!selectedTransaction) return;

    setDeleting(true);
    try {
      const response = await fetch(`/api/customs/scrap-transactions/${selectedTransaction.id}?scope=${viewMode === 'summary' ? 'header' : 'item'}`, {
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

  const handleSendClick = (transaction: ScrapTransaction) => {
    setSelectedTransaction(transaction);
    setSendDialogOpen(true);
  };

  const handleSendConfirm = async () => {
    if (!selectedTransaction?.inswTransactionId) return;
    setSending(true);
    try {
      const response = await fetch(`/api/customs/scrap-transactions/${selectedTransaction.inswTransactionId}/transmit-insw`, {
        method: 'POST',
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || result.data?.message || 'Failed to send transaction to INSW');
      if (result.status === 'PENDING') {
        toast.info('INSW transmission is pending. The transaction is locked until it is resolved.');
      } else {
        toast.success('Scrap transaction sent to INSW successfully');
      }
      setSendDialogOpen(false);
      setSelectedTransaction(null);
      await fetchData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send transaction to INSW');
      await fetchData();
    } finally {
      setSending(false);
    }
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(event.target.value);
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  };

  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  };

  const handleEndDateChange = (value: string) => {
    setEndDate(value);
    setPaginationModel((prev) => ({ ...prev, page: 0 }));
  };

  const handleExportExcel = () => {
    const exportData = data.map((row, index) => ({
      No: index + 1,
      'Company Name': row.companyName,
      'Type': row.transactionType,
      'Doc Type': row.docType || '-',
      'Nomor Pendaftaran': row.ppkekNumber,
      'Reg Date': formatDate(row.regDate),
      'Doc Number': row.docNumber,
      'Doc Date': formatDate(row.docDate),
      'Transaction Date': formatDate(row.transactionDate),
      'Recipient Name': row.recipientName,
      'Item Type': row.itemType,
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'Unit': row.unit,
      'In': row.inQty,
      'Out': row.outQty,
      'Currency': row.currency,
      'Value Amount': row.valueAmount,
    }));

    exportToExcel(
      exportData,
      `Transaksi_Scrap_${startDate}_${endDate}`,
      'Scrap Transactions'
    );
  };

  const handleExportPDF = () => {
    const exportData = data.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName,
      transactionType: row.transactionType,
      docType: row.docType || '-',
      ppkekNumber: row.ppkekNumber,
      regDate: formatDate(row.regDate),
      docNumber: row.docNumber,
      docDate: formatDate(row.docDate),
      transactionDate: formatDate(row.transactionDate),
      recipientName: row.recipientName,
      itemType: row.itemType,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      inQty: (row.inQty || 0).toString(),
      outQty: (row.outQty || 0).toString(),
      currency: row.currency || '',
      valueAmount: (row.valueAmount || 0).toString(),
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
      { header: 'Transaction Date', dataKey: 'transactionDate' },
      { header: 'Recipient', dataKey: 'recipientName' },
      { header: 'Item Type', dataKey: 'itemType' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Unit', dataKey: 'unit' },
      { header: 'In', dataKey: 'inQty' },
      { header: 'Out', dataKey: 'outQty' },
      { header: 'Currency', dataKey: 'currency' },
      { header: 'Value', dataKey: 'valueAmount' },
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
          <Typography variant="body2" color="text.secondary">Filters by Transaction Date</Typography>
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={handleStartDateChange}
            onEndDateChange={handleEndDateChange}
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
              disabled={data.length === 0 || loading}
            />
          </Box>
        </Stack>
      }
    >
      <Box sx={{ width: '100%', mt: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, px: 3, gap: 2, flexWrap: 'wrap' }}>
          <ToggleButtonGroup value={viewMode} exclusive onChange={handleViewMode} size="small" aria-label="Scrap transaction view mode">
            <ToggleButton value="summary">List by Summary</ToggleButton>
            <ToggleButton value="detail">List by Detail</ToggleButton>
          </ToggleButtonGroup>
          <TextField
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={handleSearchChange}
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
          rows={data}
          columns={columns}
          paginationModel={paginationModel}
          onPaginationModelChange={setPaginationModel}
          paginationMode="server"
          rowCount={rowCount}
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

      <EditScrapTransactionHeaderDialog
        open={headerEditDialogOpen}
        transaction={selectedTransaction}
        onClose={() => { setHeaderEditDialogOpen(false); setSelectedTransaction(null); }}
        onSuccess={handleDialogSuccess}
      />

      <Dialog open={detailsDialogOpen} onClose={() => !detailsLoading && setDetailsDialogOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>Transaction Details</DialogTitle>
        <DialogContent dividers>
          {detailsLoading ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}><CircularProgress /></Box> : transactionDetails && (
            <Stack spacing={2}>
              <Box>
                <Typography variant="subtitle1" fontWeight={600}>Transaction</Typography>
                <Typography variant="body2">Company: {transactionDetails.companyName || '-'}</Typography>
                <Typography variant="body2">Transaction Number / Reference: {transactionDetails.transactionNumber}</Typography>
                <Typography variant="body2">Transaction Date: {formatDate(transactionDetails.transactionDate)}</Typography>
                <Typography variant="body2">Direction: {transactionDetails.direction}</Typography>
                <Typography variant="body2">Document Number: {transactionDetails.documentNumber}</Typography>
                <Typography variant="body2">Document Date: {formatDate(transactionDetails.documentDate)}</Typography>
                <Typography variant="body2">Registration Number: {transactionDetails.registrationNumber || '-'}</Typography>
                <Typography variant="body2">Registration Date: {transactionDetails.registrationDate ? formatDate(transactionDetails.registrationDate) : '-'}</Typography>
                <Typography variant="body2">Custom Doc Type: {transactionDetails.documentType || '-'}</Typography>
                <Typography variant="body2">Recipient: {transactionDetails.direction === 'OUT' ? (transactionDetails.recipientName || '-') : '-'}</Typography>
                <Typography variant="body2">Remarks: {transactionDetails.remarks || '-'}</Typography>
              </Box>
              <Divider />
              <Box>
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>Item / Items</Typography>
                <Table size="small" aria-label="Scrap transaction items">
                  <TableHead><TableRow><TableCell>#</TableCell><TableCell>Scrap Code</TableCell><TableCell>Scrap Name</TableCell><TableCell>Item Type</TableCell><TableCell align="right">Quantity</TableCell><TableCell>UOM</TableCell><TableCell>Currency</TableCell><TableCell align="right">Amount</TableCell></TableRow></TableHead>
                  <TableBody>{transactionDetails.items.map((item, index) => <TableRow key={`${item.code}-${index}`}><TableCell>{index + 1}</TableCell><TableCell>{item.code}</TableCell><TableCell>{item.name}</TableCell><TableCell>{item.itemType}</TableCell><TableCell align="right">{formatQty(item.quantity)}</TableCell><TableCell>{item.uom}</TableCell><TableCell>{item.currency || '-'}</TableCell><TableCell align="right">{formatAmount(item.valueAmount || 0)}</TableCell></TableRow>)}</TableBody>
                </Table>
              </Box>
              {transactionDetails.isSez && <><Divider /><Box><Typography variant="subtitle1" fontWeight={600}>INSW</Typography><Typography variant="body2">INSW Status: {transactionDetails.inswStatus?.replace('_', ' ') || 'NOT SENT'}</Typography>{transactionDetails.lastAttempt && <Typography variant="body2">Last attempt: {formatDate(transactionDetails.lastAttempt.at)} — {transactionDetails.lastAttempt.status}{transactionDetails.lastAttempt.message ? ` (${transactionDetails.lastAttempt.message})` : ''}</Typography>}</Box></>}
            </Stack>
          )}
        </DialogContent>
        <DialogActions><Button onClick={() => setDetailsDialogOpen(false)} disabled={detailsLoading}>Close</Button></DialogActions>
      </Dialog>

      <Dialog
        open={deleteDialogOpen}
        onClose={handleDeleteCancel}
      >
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to delete this {viewMode === 'summary' ? 'scrap transaction and all of its active items' : 'scrap item'}?
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

      <Dialog open={sendDialogOpen} onClose={() => !sending && setSendDialogOpen(false)}>
        <DialogTitle>Confirm INSW Finalization</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Send document <strong>{selectedTransaction?.docNumber}</strong> and all{' '}
            <strong>{selectedTransaction?.itemCount || 1} active item(s)</strong> to INSW?
            <br /><br />
            After successful transmission to INSW, this Scrap transaction can no longer be edited or deleted.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setSendDialogOpen(false); setSelectedTransaction(null); }} disabled={sending}>Cancel</Button>
          <Button onClick={handleSendConfirm} variant="contained" startIcon={sending ? <CircularProgress size={16} /> : <SendIcon />} disabled={sending}>
            {sending ? 'Sending...' : 'Confirm & Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </ReportLayout>
  );
}
