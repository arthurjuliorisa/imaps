'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Stack, Button, CircularProgress, Typography, TextField, InputAdornment } from '@mui/material';
import {
  RemoveCircleOutline as RemoveIcon,
  UploadFile as UploadFileIcon,
  Search as SearchIcon
} from '@mui/icons-material';
import { DataGrid, GridColDef } from '@mui/x-data-grid';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { AddOutCapitalGoodsDialog } from '@/app/components/customs/AddOutCapitalGoodsDialog';
import { ImportCeisaExcelDialog } from '@/app/components/customs/ImportCeisaExcelDialog';
import { useToast } from '@/app/components/ToastProvider';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';
import type { CapitalGoodsTransaction } from '@/types/transaction';

export default function CapitalGoodsTransactionsPage() {
  const toast = useToast();

  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [data, setData] = useState<CapitalGoodsTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [paginationModel, setPaginationModel] = useState({
    page: 0,
    pageSize: 10,
  });
  const [addOutDialogOpen, setAddOutDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);

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
      field: 'docType',
      headerName: 'Doc Type',
      width: 120,
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
      valueFormatter: (value) => value || 0,
    },
    {
      field: 'outQty',
      headerName: 'Out',
      width: 100,
      type: 'number',
      valueFormatter: (value) => value || 0,
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
      valueFormatter: (value: number) => value ? value.toLocaleString() : '0',
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
  ];

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `/api/customs/capital-goods-transactions?startDate=${startDate}&endDate=${endDate}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }

      const result = await response.json();
      setData(result.data || []);
    } catch (error) {
      console.error('Error fetching capital goods transactions:', error);
      toast.error('Failed to load capital goods transaction data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleAddOut = () => {
    setAddOutDialogOpen(true);
  };

  const handleImportExcel = () => {
    setImportDialogOpen(true);
  };

  const handleDialogSuccess = () => {
    fetchData();
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
      'Doc Type': row.docType,
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
      `Transaksi_Barang_Modal_${startDate}_${endDate}`,
      'Capital Goods Transactions'
    );
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName,
      docType: row.docType,
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
      `Transaksi_Barang_Modal_${startDate}_${endDate}`,
      'Transaksi Barang Modal',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
    );
  };

  return (
    <ReportLayout
      title="Transaksi Barang Modal"
      subtitle="Capital goods transaction records"
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
                color="error"
                startIcon={<RemoveIcon />}
                onClick={handleAddOut}
                disabled={loading}
              >
                Add Out
              </Button>
              <Button
                variant="contained"
                color="primary"
                startIcon={<UploadFileIcon />}
                onClick={handleImportExcel}
                disabled={loading}
              >
                Import from Excel
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
      <Box sx={{ width: '100%' }}>
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
          sx={{ mb: 2, maxWidth: 400 }}
        />
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
                  No capital goods transactions found for the selected date range
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

      <AddOutCapitalGoodsDialog
        open={addOutDialogOpen}
        onClose={() => setAddOutDialogOpen(false)}
        onSuccess={handleDialogSuccess}
      />

      <ImportCeisaExcelDialog
        open={importDialogOpen}
        onClose={() => setImportDialogOpen(false)}
        onSuccess={handleDialogSuccess}
        transactionType="CAPITAL_GOODS"
        defaultDirection="OUT"
        allowDirectionChange={false}
      />
    </ReportLayout>
  );
}
