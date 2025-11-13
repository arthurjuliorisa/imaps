'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Stack, Button } from '@mui/material';
import { Add as AddIcon, UploadFile as UploadFileIcon } from '@mui/icons-material';
import { ReportLayout } from '@/app/components/customs/ReportLayout';
import {
  BeginningStockTable,
  BeginningStockData,
} from '@/app/components/customs/BeginningStockTable';
import {
  BeginningStockForm,
  BeginningStockFormData,
} from '@/app/components/customs/BeginningStockForm';
import { BeginningStockImport } from '@/app/components/customs/BeginningStockImport';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';
import { useToast } from '@/app/components/ToastProvider';
import dayjs from 'dayjs';

export default function BeginningFinishGoodPage() {
  const toast = useToast();
  const [data, setData] = useState<BeginningStockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<BeginningStockData | null>(null);
  const [formMode, setFormMode] = useState<'add' | 'edit'>('add');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState<string | null>(null);

  // Fetch data from API
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (searchTerm) {
        params.append('itemCode', searchTerm);
        params.append('itemName', searchTerm);
      }
      if (filterDate) {
        params.append('startDate', filterDate);
        params.append('endDate', filterDate);
      }

      const response = await fetch(
        `/api/customs/beginning-finish-good${params.toString() ? `?${params.toString()}` : ''}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      const result = await response.json();

      const transformed = Array.isArray(result) ? result.map((item: any) => ({
        id: item.id,
        itemCode: item.item.code,
        itemName: item.item.name,
        uom: item.uom.code,
        beginningBalance: item.beginningBalance,
        beginningDate: item.beginningDate,
        remarks: item.remarks,
        itemId: item.itemId,
        uomId: item.uomId,
      })) : [];

      setData(transformed);
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [searchTerm, filterDate]);

  // Load data on mount and when filters change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Handle add button click
  const handleAddClick = () => {
    setSelectedItem(null);
    setFormMode('add');
    setFormOpen(true);
  };

  // Handle edit
  const handleEdit = (item: BeginningStockData) => {
    setSelectedItem(item);
    setFormMode('edit');
    setFormOpen(true);
  };

  // Handle delete click
  const handleDeleteClick = (item: BeginningStockData) => {
    setSelectedItem(item);
    setDeleteDialogOpen(true);
  };

  // Handle delete confirm
  const handleDeleteConfirm = async () => {
    if (!selectedItem) return;

    try {
      const response = await fetch(`/api/customs/beginning-finish-good/${selectedItem.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete data');
      }

      toast.success('Beginning stock data deleted successfully!');
      await fetchData();
      setDeleteDialogOpen(false);
      setSelectedItem(null);
    } catch (error) {
      console.error('Error deleting data:', error);
      toast.error('Failed to delete beginning stock data. Please try again.');
    }
  };

  // Handle form submission (both add and edit)
  const handleFormSubmit = async (formData: BeginningStockFormData) => {
    try {
      const endpoint = formMode === 'add'
        ? '/api/customs/beginning-finish-good'
        : `/api/customs/beginning-finish-good/${selectedItem?.id}`;

      const method = formMode === 'add' ? 'POST' : 'PUT';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          itemId: formData.itemId,
          uomId: formData.uomId,
          beginningBalance: formData.beginningBalance,
          beginningDate: formData.beginningDate?.format('YYYY-MM-DD'),
          remarks: formData.remarks,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `Failed to ${formMode} data`);
      }

      toast.success(
        `Beginning stock data ${formMode === 'add' ? 'added' : 'updated'} successfully!`
      );
      await fetchData();
      setFormOpen(false);
      setSelectedItem(null);
    } catch (error: any) {
      console.error(`Error ${formMode}ing data:`, error);
      toast.error(error.message || `Failed to ${formMode} beginning stock data. Please try again.`);
    }
  };

  // Handle Excel import submission
  const handleImportSubmit = async (records: any[]) => {
    try {
      const response = await fetch('/api/customs/beginning-finish-good/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          records: records.map((r) => ({
            itemCode: r.itemCode,
            beginningBalance: r.beginningBalance,
            beginningDate: r.beginningDate,
            remarks: r.remarks,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to import data');
      }

      toast.success(`Successfully imported ${records.length} beginning stock record(s)!`);
      await fetchData();
    } catch (error) {
      console.error('Error importing data:', error);
      toast.error('Failed to import records. Please try again.');
      throw error;
    }
  };

  // Convert data for form initialization
  const getFormInitialData = (): BeginningStockFormData | null => {
    if (!selectedItem || formMode === 'add') return null;

    return {
      itemId: (selectedItem as any).itemId || '',
      itemCode: selectedItem.itemCode,
      itemName: selectedItem.itemName,
      uomId: (selectedItem as any).uomId || '',
      uom: selectedItem.uom,
      beginningBalance: selectedItem.beginningBalance,
      beginningDate: dayjs(selectedItem.beginningDate),
      remarks: selectedItem.remarks || '',
    };
  };

  return (
    <ReportLayout
      title="Beginning Stock - Finish Good"
      subtitle="Manage beginning balance data for finish good mutations"
      actions={
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 2, flexWrap: 'wrap' }}>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={handleAddClick}
            sx={{
              textTransform: 'none',
              borderRadius: 2,
              bgcolor: 'success.main',
              '&:hover': {
                bgcolor: 'success.dark',
              },
            }}
          >
            Add Manually
          </Button>
          <Button
            variant="contained"
            startIcon={<UploadFileIcon />}
            onClick={() => setImportOpen(true)}
            sx={{
              textTransform: 'none',
              borderRadius: 2,
              bgcolor: 'info.main',
              '&:hover': {
                bgcolor: 'info.dark',
              },
            }}
          >
            Import from Excel
          </Button>
        </Box>
      }
    >
      <BeginningStockTable
        data={data}
        loading={loading}
        onEdit={handleEdit}
        onDelete={handleDeleteClick}
        onSearch={setSearchTerm}
        onDateFilter={setFilterDate}
      />

      {/* Add/Edit Form Dialog */}
      <BeginningStockForm
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setSelectedItem(null);
        }}
        onSubmit={handleFormSubmit}
        itemType="FINISH_GOOD"
        initialData={getFormInitialData()}
        mode={formMode}
      />

      {/* Excel Import Dialog */}
      <BeginningStockImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSubmit={handleImportSubmit}
        itemType="FINISH_GOOD"
      />

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={deleteDialogOpen}
        title="Delete Beginning Stock Data?"
        message={
          selectedItem
            ? `Are you sure you want to delete beginning stock for ${selectedItem.itemCode} - ${selectedItem.itemName}? This action cannot be undone.`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleDeleteConfirm}
        onCancel={() => {
          setDeleteDialogOpen(false);
          setSelectedItem(null);
        }}
        severity="error"
      />
    </ReportLayout>
  );
}
