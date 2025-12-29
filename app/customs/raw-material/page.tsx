'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ToastProvider';
import { Box, Stack, TextField, InputAdornment, MenuItem } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { DateRangeFilter } from '@/app/components/customs/DateRangeFilter';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { MutationReportTable, MutationData } from '@/app/components/customs/MutationReportTable';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';

export default function RawMaterialMutationPage() {
  const toast = useToast();

  // Default date range: last 30 days to today
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(now.getDate() - 30);

  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
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
      No: index + 1,
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'Unit': row.unit,
      'Beginning': row.beginning,
      'In': row.in,
      'Out': row.out,
      'Adjustment': row.adjustment,
      'Ending': row.ending,
      'Stock Opname': row.stockOpname,
      'Variant': row.variant,
    }));

    exportToExcel(
      exportData,
      `LPJ_Mutasi_Bahan_Baku_${startDate}_${endDate}`,
      'Raw Material Mutation'
    );
  };

  const handleExportPDF = () => {
    const exportData = filteredData.map((row, index) => ({
      no: index + 1,
      itemCode: row.itemCode,
      itemName: row.itemName,
      unit: row.unit,
      beginning: row.beginning.toString(),
      in: row.in.toString(),
      out: row.out.toString(),
      adjustment: row.adjustment.toString(),
      ending: row.ending.toString(),
      stockOpname: row.stockOpname.toString(),
      variant: row.variant.toString(),
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Unit', dataKey: 'unit' },
      { header: 'Beginning', dataKey: 'beginning' },
      { header: 'In', dataKey: 'in' },
      { header: 'Out', dataKey: 'out' },
      { header: 'Adjustment', dataKey: 'adjustment' },
      { header: 'Ending', dataKey: 'ending' },
      { header: 'Stock Opname', dataKey: 'stockOpname' },
      { header: 'Variant', dataKey: 'variant' },
    ];

    exportToPDF(
      exportData,
      columns,
      `LPJ_Mutasi_Bahan_Baku_${startDate}_${endDate}`,
      'LPJ Mutasi Bahan Baku/Bahan Penolong',
      `Period: ${formatDate(startDate)} - ${formatDate(endDate)}`
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
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 3, px: 3, gap: 2 }}>
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
        hideRemarks={true}
        hideActions={true}
        hideValueAmount={true}
      />
    </ReportLayout>
  );
}
