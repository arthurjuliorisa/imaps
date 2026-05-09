'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import { StockOpname, StockOpnameStatus } from '@/types/stock-opname';
import { CreateDialog } from './components/CreateDialog';
import { FilterSection } from './components/FilterSection';
import { StockOpnameTable } from './components/StockOpnameTable';

export default function StockOpnamePage() {
  const toast = useToast();
  const [data, setData] = useState<StockOpname[]>([]);
  const [loading, setLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const now = new Date();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StockOpnameStatus | ''>('');
  const [year, setYear] = useState(now.getFullYear().toString());
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [totalCount, setTotalCount] = useState(0);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      const params = new URLSearchParams({
        date_from: startDate,
        date_to: endDate,
        page: String(page + 1),
        limit: String(rowsPerPage),
      });

      if (statusFilter) {
        params.append('status', statusFilter);
      }

      if (searchQuery.trim()) {
        params.append('search', searchQuery.trim());
      }

      const response = await fetch(`/api/customs/stock-opname?${params}`);
      if (!response.ok) throw new Error('Failed to fetch data');

      const result = await response.json();
      setData(result.data || []);
      setTotalCount(result.total || result.pagination?.total || 0);
    } catch (error) {
      console.error('Error fetching stock opname data:', error);
      toast.error('Failed to load stock opname data');
      setData([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }, [year, statusFilter, searchQuery, page, rowsPerPage]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = async (id: number) => {
    try {
      const response = await fetch(`/api/customs/stock-opname/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete stock opname');
      }

      toast.success('Stock opname deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting stock opname:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete stock opname');
    }
  };

  const handleResetFilters = () => {
    setSearchQuery('');
    setStatusFilter('');
    setYear(new Date().getFullYear().toString());
    setPage(0);
  };

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      return b.sto_number.localeCompare(a.sto_number);
    });
  }, [data]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPage(0);
  };

  const handleStatusChange = (value: StockOpnameStatus | '') => {
    setStatusFilter(value);
    setPage(0);
  };

  const handleYearChange = (value: string) => {
    setYear(value);
    setPage(0);
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  return (
    <ReportLayout
      title="Stock Opname"
      subtitle="Manage stock opname records"
      actions={
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => setCreateDialogOpen(true)}
        >
          Register Stock Opname
        </Button>
      }
    >
      <Box sx={{ p: 3 }}>
        <FilterSection
          searchQuery={searchQuery}
          onSearchChange={handleSearchChange}
          statusFilter={statusFilter}
          onStatusChange={handleStatusChange}
          year={year}
          onYearChange={handleYearChange}
          onReset={handleResetFilters}
        />

        <StockOpnameTable
          data={sortedData}
          loading={loading}
          onDelete={handleDelete}
          pagination={{
            page,
            rowsPerPage,
            total: totalCount,
            onPageChange: setPage,
            onRowsPerPageChange: handleRowsPerPageChange,
          }}
        />
      </Box>

      <CreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </ReportLayout>
  );
}
