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

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;

      const params = new URLSearchParams({
        date_from: startDate,
        date_to: endDate,
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
    } catch (error) {
      console.error('Error fetching stock opname data:', error);
      toast.error('Failed to load stock opname data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [year, statusFilter, searchQuery]);

  useEffect(() => {
    fetchData();
  }, [year, statusFilter, searchQuery]);

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
  };

  const sortedData = useMemo(() => {
    return [...data].sort((a, b) => {
      return b.sto_number.localeCompare(a.sto_number);
    });
  }, [data]);

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
          onSearchChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusChange={setStatusFilter}
          year={year}
          onYearChange={setYear}
          onReset={handleResetFilters}
        />

        <StockOpnameTable
          data={sortedData}
          loading={loading}
          onDelete={handleDelete}
        />
      </Box>

      <CreateDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
      />
    </ReportLayout>
  );
}
