'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ToastProvider';
import { Box, Stack, TextField, InputAdornment, MenuItem } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { MutationReportTable, MutationData } from '@/app/components/customs/MutationReportTable';
import { exportToPDF, formatDateShort } from '@/lib/exportUtils';
import {
  downloadExcelResponse,
  readExportErrorMessage,
  validateClientExportDateRange,
} from '@/lib/customs/lpj-export-client';

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

export default function ProductionMutationPage() {
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
  const [totalCount, setTotalCount] = useState(0);
  const [exportLoading, setExportLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        startDate,
        endDate,
        page: String(page + 1),
        limit: String(rowsPerPage),
      });
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (itemTypeFilter) params.append('itemType', itemTypeFilter);

      const response = await fetch(`/api/customs/production?${params}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result.data || []);
      setTotalCount(result.pagination?.total || 0);
    } catch (error) {
      console.error('Error fetching production mutation data:', error);
      toast.error('Failed to load production mutation data');
      setData([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, page, rowsPerPage, searchQuery, itemTypeFilter, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page to 0 when date range, search query, or item type filter changes
  useEffect(() => {
    setPage(0);
  }, [startDate, endDate, searchQuery, itemTypeFilter]);

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
          row.companyName?.toLowerCase().includes(query) ||
          row.itemCode?.toLowerCase().includes(query) ||
          row.itemName?.toLowerCase().includes(query) ||
          row.itemType?.toLowerCase().includes(query) ||
          row.unit?.toLowerCase().includes(query) ||
          row.currency?.toLowerCase().includes(query)
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

  const handleExportExcel = async () => {
    const validationMessage = validateClientExportDateRange(startDate, endDate);
    if (validationMessage) {
      toast.warning(validationMessage);
      return;
    }

    setExportLoading(true);
    toast.info('Preparing Excel export...');

    try {
      const params = new URLSearchParams({ startDate, endDate });
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (itemTypeFilter) params.append('itemType', itemTypeFilter);

      const response = await fetch(`/api/customs/production/export?${params}`);
      if (!response.ok) {
        throw new Error(await readExportErrorMessage(response));
      }

      await downloadExcelResponse(response, `Laporan_Hasil_Produksi_${startDate}_${endDate}.xlsx`);
      toast.success('Excel export downloaded.');
    } catch (error) {
      console.error('Error exporting production Excel:', error);
      toast.error(error instanceof Error ? error.message : 'Export failed. Please narrow the filters or try again.');
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      companyName: row.companyName || '-',
      itemCode: row.itemCode,
      itemName: row.itemName,
      itemType: row.itemType || '-',
      unit: row.unit,
      beginning: typeof row.beginning === 'string' ? row.beginning : row.beginning.toString(),
      in: typeof row.in === 'string' ? row.in : row.in.toString(),
      out: typeof row.out === 'string' ? row.out : row.out.toString(),
      adjustment: typeof row.adjustment === 'string' ? row.adjustment : row.adjustment.toString(),
      ending: typeof row.ending === 'string' ? row.ending : row.ending.toString(),
      remarks: row.remarks || '-',
    }));

    exportToPDF(
      exportData,
      PDF_COLUMNS,
      `Laporan_Hasil_Produksi_${startDate}_${endDate}`,
      'Laporan Hasil Produksi',
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
      title="LPJ Mutasi Hasil Produksi"
      subtitle="Laporan Pertanggungjawaban Mutasi Hasil Produksi"
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
              excelDisabled={exportLoading || !startDate || !endDate}
              pdfDisabled={filteredData.length === 0 || loading}
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
        totalCount={totalCount}
      />
    </ReportLayout>
  );
}
