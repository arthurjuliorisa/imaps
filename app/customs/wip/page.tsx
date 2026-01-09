'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/app/components/ToastProvider';
import { Box, Stack, TextField, InputAdornment, MenuItem } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { ExportButtons } from '@/app/components/customs/ExportButtons';
import { WIPReportTable, WIPData } from '@/app/components/customs/WIPReportTable';
import { exportToExcel, exportToPDF, formatDate } from '@/lib/exportUtils';

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

  const fetchData = useCallback(async () => {
    if (!selectedDate) return;

    setLoading(true);
    try {
      const params = new URLSearchParams({
        stockDate: selectedDate,
      });

      const response = await fetch(`/api/customs/wip?${params}`);
      if (!response.ok) throw new Error('Failed to fetch data');
      const result = await response.json();
      setData(result);
    } catch (error) {
      console.error('Error fetching WIP mutation data:', error);
      toast.error('Failed to load WIP mutation data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [selectedDate, toast]);

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

  // Reset page to 0 when search query or item type filter changes
  useEffect(() => {
    setPage(0);
  }, [searchQuery, itemTypeFilter]);

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

  const handleExportExcel = () => {
    const exportData = filteredData.map((row) => ({
      No: row.no,
      'Company Name': row.companyName || '-',
      'Item Code': row.itemCode,
      'Item Name': row.itemName,
      'Item Type': row.itemType || '-',
      'Unit': row.unitQuantity,
      'Quantity': row.quantity,
      'Stock Date': formatDate(row.stockDate),
      'Remarks': row.remarks || '-',
      'Created At': formatDate(row.createdAt),
    }));

    exportToExcel(
      exportData,
      `WIP_Stock_Position_${selectedDate}`,
      'WIP Stock Position'
    );
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
      stockDate: formatDate(row.stockDate),
      remarks: row.remarks || '-',
      createdAt: formatDate(row.createdAt),
    }));

    const columns = [
      { header: 'No', dataKey: 'no' },
      { header: 'Company', dataKey: 'companyName' },
      { header: 'Item Code', dataKey: 'itemCode' },
      { header: 'Item Name', dataKey: 'itemName' },
      { header: 'Type', dataKey: 'itemType' },
      { header: 'Unit', dataKey: 'unit' },
      { header: 'Quantity', dataKey: 'quantity' },
      { header: 'Stock Date', dataKey: 'stockDate' },
      { header: 'Remarks', dataKey: 'remarks' },
      { header: 'Created At', dataKey: 'createdAt' },
    ];

    exportToPDF(
      exportData,
      columns,
      `WIP_Stock_Position_${selectedDate}`,
      'WIP Stock Position Report',
      `Date: ${formatDate(selectedDate)}`
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
      title="LPJ Mutasi WIP"
      subtitle="Laporan Pertanggungjawaban Mutasi Work In Process"
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
              disabled={filteredData.length === 0 || loading || initialLoading}
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
        loading={loading}
      />
    </ReportLayout>
  );
}
