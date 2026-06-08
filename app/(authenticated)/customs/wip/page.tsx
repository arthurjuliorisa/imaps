'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ToastProvider';
import { Box, Stack, TextField, InputAdornment, MenuItem } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { WIPReportTable, WIPData } from '@/app/components/customs/WIPReportTable';
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
  { header: 'jumlah', dataKey: 'quantity' },
  { header: 'Stock Date', dataKey: 'stockDate' },
  { header: 'catatan', dataKey: 'remarks' },
];

export default function WIPMutationPage() {
  const toast = useToast();

  // Initialize with null, will be set to latest date on mount
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [data, setData] = useState<WIPData[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [itemTypeFilter, setItemTypeFilter] = useState<string>('');
  const [totalCount, setTotalCount] = useState(0);
  const [exportLoading, setExportLoading] = useState(false);

  const fetchData = useCallback(async () => {
    if (!selectedDate) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        stockDate: selectedDate,
        page: String(page + 1),
        limit: String(rowsPerPage),
      });
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (itemTypeFilter) params.append('itemType', itemTypeFilter);

      const response = await fetch(`/api/customs/wip?${params}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      // Extract data array from new API response format
      setData(result.data || []);
      setTotalCount(result.pagination?.total || 0);
    } catch (error) {
      console.error('Error fetching WIP mutation data:', error);
      toast.error('Failed to load WIP mutation data');
      setData([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, page, rowsPerPage, searchQuery, itemTypeFilter, toast]);

  // Fetch latest stock date on component mount
  useEffect(() => {
    const fetchLatestDate = async () => {
      try {
        const response = await fetch('/api/customs/wip', {
          method: 'POST',
        });
        if (!response.ok) throw new Error('Failed to fetch latest date');
        const { latestDate } = await response.json();
        if (latestDate) {
          setSelectedDate(latestDate);
        }
      } catch (error) {
        console.error('Error fetching latest stock date:', error);
        // Fallback to today if fetch fails
        const now = new Date();
        setSelectedDate(now.toISOString().split('T')[0]);
      } finally {
        setInitialLoading(false);
      }
    };

    fetchLatestDate();
  }, []);

  useEffect(() => {
    if (!initialLoading) {
      fetchData();
    }
  }, [selectedDate, fetchData, initialLoading]);

  // Reset page to 0 when search query, date, or item type filter changes
  useEffect(() => {
    setPage(0);
  }, [selectedDate, searchQuery, itemTypeFilter]);

  // Get unique item types from data
  const uniqueItemTypes = useMemo(() => {
    const types = new Set(data.map(item => item.itemType));
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
          row.unitQuantity?.toLowerCase().includes(query) ||
          row.remarks?.toLowerCase().includes(query)
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
    const validationMessage = validateClientExportDateRange(selectedDate, selectedDate);
    if (validationMessage) {
      toast.warning(validationMessage);
      return;
    }

    setExportLoading(true);
    toast.info('Preparing Excel export...');

    try {
      const params = new URLSearchParams({ stockDate: selectedDate });
      if (searchQuery.trim()) params.append('search', searchQuery.trim());
      if (itemTypeFilter) params.append('itemType', itemTypeFilter);

      const response = await fetch(`/api/customs/wip/export?${params}`);
      if (!response.ok) {
        throw new Error(await readExportErrorMessage(response));
      }

      await downloadExcelResponse(
        response,
        `Laporan_Posisi_Barang_Dalam_Proses_${selectedDate}.xlsx`
      );
      toast.success('Excel export downloaded.');
    } catch (error) {
      console.error('Error exporting WIP Excel:', error);
      toast.error(error instanceof Error ? error.message : 'Export failed. Please narrow the filters or try again.');
    } finally {
      setExportLoading(false);
    }
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row) => ({
      no: row.no,
      companyName: row.companyName || '-',
      itemCode: row.itemCode,
      itemName: row.itemName,
      itemType: row.itemType || '-',
      unit: row.unitQuantity,
      quantity: row.quantity.toString(),
      stockDate: formatDateShort(row.stockDate),
      remarks: row.remarks || '-',
    }));

    exportToPDF(
      exportData,
      PDF_COLUMNS,
      `Laporan_Posisi_Barang_Dalam_Proses_${selectedDate}`,
      'Laporan Posisi Barang Dalam Proses',
      `Date: ${formatDateShort(selectedDate)}`
    );
  };

  const handleEdit = (item: WIPData) => {
    console.log('Edit item:', item);
    // Implement edit functionality
  };

  const handleView = (item: WIPData) => {
    console.log('View item:', item);
    // Implement view functionality
  };

  return (
    <ReportLayout
      title="Laporan Posisi Barang Dalam Proses"
      subtitle="Laporan posisi barang dalam proses produksi"
      actions={
        <Stack spacing={3}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <TextField
              label="Stock Date"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              disabled={initialLoading}
              InputLabelProps={{
                shrink: true,
              }}
              sx={{ minWidth: 200 }}
            />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButtons
              onExportExcel={handleExportExcel}
              onExportPDF={handleExportPDF}
              excelDisabled={exportLoading || initialLoading || !selectedDate}
              pdfDisabled={filteredData.length === 0 || loading || initialLoading}
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
      <WIPReportTable
        data={filteredData}
        page={page}
        rowsPerPage={rowsPerPage}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        totalCount={totalCount}
        loading={loading}
      />
    </ReportLayout>
  );
}
