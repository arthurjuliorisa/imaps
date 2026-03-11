'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ToastProvider';
import { Box, Stack, TextField, InputAdornment, MenuItem } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { MutationReportTable, MutationData } from '@/app/components/customs/MutationReportTable';
import { exportToExcelWithHeaders, exportToPDF, formatDate, formatDateShort } from '@/lib/exportUtils';

const EXCEL_HEADERS = [
  { key: 'no', label: 'No', type: 'number' as const },
  { key: 'companyName', label: 'Company Name', type: 'text' as const },
  { key: 'itemCode', label: 'Kode Barang', type: 'text' as const },
  { key: 'itemName', label: 'Nama Barang', type: 'text' as const },
  { key: 'itemType', label: 'Item Type', type: 'text' as const },
  { key: 'unit', label: 'Satuan Barang', type: 'text' as const },
  { key: 'beginning', label: 'Saldo Awal', type: 'number' as const },
  { key: 'in', label: 'Jumlah Pemasukan Barang', type: 'number' as const },
  { key: 'out', label: 'Jumlah Pengeluaran Barang', type: 'number' as const },
  { key: 'adjustment', label: 'Penyesuaian', type: 'number' as const },
  { key: 'ending', label: 'Saldo Akhir', type: 'number' as const },
  { key: 'stockOpname', label: 'Hasil Pencacahan', type: 'number' as const },
  { key: 'variant', label: 'Jumlah Selisih', type: 'number' as const },
  { key: 'remarks', label: 'Keterangan', type: 'text' as const },
];

const PDF_COLUMNS = [
  { header: 'No', dataKey: 'no' },
  { header: 'Company Name', dataKey: 'companyName' },
  { header: 'Kode Barang', dataKey: 'itemCode' },
  { header: 'Nama Barang', dataKey: 'itemName' },
  { header: 'Item Type', dataKey: 'itemType' },
  { header: 'Satuan Barang', dataKey: 'unit' },
  { header: 'Saldo Awal', dataKey: 'beginning' },
  { header: 'Jumlah Pemasukan Barang', dataKey: 'in' },
  { header: 'Jumlah Pengeluaran Barang', dataKey: 'out' },
  { header: 'Penyesuaian', dataKey: 'adjustment' },
  { header: 'Saldo Akhir', dataKey: 'ending' },
  { header: 'Keterangan', dataKey: 'remarks' },
];

export default function RawMaterialMutationPage() {
  const toast = useToast();

  // Default date range: today
  const now = new Date();

  const [startDate, setStartDate] = useState(now.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(now.toISOString().split('T')[0]);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<MutationData[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState<string>('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
      });

      const response = await fetch(`/api/customs/raw-material?${params}`);
      const result = await response.json();

      if (!response.ok) {
        if (response.status === 503) {
          toast.error(result.message || 'This feature is temporarily unavailable');
        } else {
          toast.error('Failed to load raw material mutation data');
        }
        setData([]);
      } else {
        setData(result.data || result);
      }
    } catch (error) {
      console.error('Error fetching raw material mutation data:', error);
      toast.error('Failed to load raw material mutation data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page to 0 when search query or item type filter changes
  useEffect(() => {
    setPage(0);
  }, [searchQuery, itemTypeFilter]);

  // Get unique item types from data
  const uniqueItemTypes = useMemo(() => {
    const types = new Set(data.map(item => item.itemType).filter(Boolean));
    return Array.from(types).sort();
  }, [data]);

  // Filter data based on search query and item type filter
  const filteredData = useMemo(() => {
    let filtered = data;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((row) => {
        return (
          row.companyCode?.toString().toLowerCase().includes(query) ||
          row.companyName?.toLowerCase().includes(query) ||
          row.itemCode?.toLowerCase().includes(query) ||
          row.itemName?.toLowerCase().includes(query) ||
          row.itemType?.toLowerCase().includes(query) ||
          row.unit?.toLowerCase().includes(query)
        );
      });
    }

    // Apply item type filter
    if (itemTypeFilter) {
      filtered = filtered.filter(row => row.itemType === itemTypeFilter);
    }

    return filtered;
  }, [data, searchQuery, itemTypeFilter]);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleExportExcel = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName || '-',
      itemCode: row.itemCode,
      itemName: row.itemName,
      itemType: row.itemType || '-',
      unit: row.unit,
      beginning: row.beginning,
      in: row.in,
      out: row.out,
      adjustment: row.adjustment,
      ending: row.ending,
      stockOpname: row.stockOpname,
      variant: row.variant,
      remarks: row.remarks || '-',
    }));

    exportToExcelWithHeaders(
      exportData,
      EXCEL_HEADERS,
      `Laporan_Bahan_Baku_${startDate}_${endDate}`,
      'Laporan Bahan Baku'
    );
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName || '-',
      itemCode: row.itemCode,
      itemName: row.itemName,
      itemType: row.itemType || '-',
      unit: row.unit,
      beginning: row.beginning.toString(),
      in: row.in.toString(),
      out: row.out.toString(),
      adjustment: row.adjustment.toString(),
      ending: row.ending.toString(),
      remarks: row.remarks || '-',
    }));

    exportToPDF(
      exportData,
      PDF_COLUMNS,
      `Laporan_Bahan_Baku_${startDate}_${endDate}`,
      'Laporan Bahan Baku',
      `Period: ${formatDateShort(startDate)} - ${formatDateShort(endDate)}`
    );
  };

  const handleEdit = (item: MutationData) => {
    console.log('Edit item:', item);
    // Implement edit functionality
  };

  const handleView = (item: MutationData) => {
    console.log('View item:', item);
    // Implement view functionality
  };

  return (
    <ReportLayout
      title="LPJ Mutasi Bahan Baku/Bahan Penolong"
      subtitle="Laporan Pertanggungjawaban Mutasi Bahan Baku dan Bahan Penolong"
      actions={
        <Stack spacing={3}>
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButtons
              onExportExcel={handleExportExcel}
              onExportPDF={handleExportPDF}
              disabled={filteredData.length === 0 || loading}
            />
          </Box>
        </Stack>
      }
    >
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 3, mb: 3, px: 3, gap: 2 }}>
        <TextField
          select
          label="Item Type"
          value={itemTypeFilter}
          onChange={(e) => setItemTypeFilter(e.target.value)}
          size="small"
          sx={{ minWidth: 200 }}
        >
          <MenuItem value="">All Item Types</MenuItem>
          {uniqueItemTypes.map((type) => (
            <MenuItem key={type} value={type}>
              {type}
            </MenuItem>
          ))}
        </TextField>
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
      <MutationReportTable
        data={filteredData}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        onEdit={handleEdit}
        onView={handleView}
        loading={loading}
        hideRemarks={false}
        hideActions={true}
        hideValueAmount={true}
      />
    </ReportLayout>
  );
}
