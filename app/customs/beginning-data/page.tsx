'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Box, Stack, Button, Autocomplete, TextField } from '@mui/material';
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

interface ItemType {
  code: string;
  name: string;
}

export default function BeginningDataPage() {
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

  // Item Type Management
  const [selectedItemType, setSelectedItemType] = useState<string>('ALL');
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [itemTypesLoading, setItemTypesLoading] = useState(true);

  // Load item types on mount
  useEffect(() => {
    const fetchItemTypes = async () => {
      setItemTypesLoading(true);
      try {
        const response = await fetch('/api/master/item-types');
        if (!response.ok) {
          throw new Error('Failed to fetch item types');
        }
        const result = await response.json();
        const itemTypesData = result.data || result;
        const types = itemTypesData.map((it: any) => ({
          code: it.item_type_code,
          name: it.name_id || it.name_en,
        }));
        // Add "All" option at the beginning
        setItemTypes([{ code: 'ALL', name: 'All Item Types' }, ...types]);
      } catch (error) {
        console.error('Error fetching item types:', error);
        toast.error('Failed to load item types');
        setItemTypes([{ code: 'ALL', name: 'All Item Types' }]);
      } finally {
        setItemTypesLoading(false);
      }
    };
    fetchItemTypes();
  }, []);

  // Fetch data from API
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      // Only filter by itemType if not "All"
      if (selectedItemType && selectedItemType !== 'ALL') {
        params.append('itemType', selectedItemType);
      }

      if (searchTerm) {
        params.append('itemCode', searchTerm);
        params.append('itemName', searchTerm);
      }
      if (filterDate) {
        params.append('startDate', filterDate);
        params.append('endDate', filterDate);
      }

      const response = await fetch(
        `/api/customs/beginning-data${params.toString() ? `?${params.toString()}` : ''}`
      );
      if (!response.ok) {
        throw new Error('Failed to fetch data');
      }
      const result = await response.json();

      // Transform API response to match BeginningStockData interface
      const transformed = Array.isArray(result) ? result.map((item: any) => ({
        id: item.id,
        itemCode: item.item.code,
        itemName: item.item.name,
        itemType: item.itemType,
        uom: item.uom.code,
        beginningBalance: item.beginningBalance,
        beginningDate: item.beginningDate,
        remarks: item.remarks,
        // Keep item and uom IDs for edit functionality
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
  }, [selectedItemType, searchTerm, filterDate]);

  // Load data when item type or filters change
  useEffect(() => {
    if (!itemTypesLoading) {
      fetchData();
    }
  }, [fetchData, itemTypesLoading]);

  // Handle item type change
  const handleItemTypeChange = (_event: any, newValue: ItemType | null) => {
    if (newValue) {
      setSelectedItemType(newValue.code);
      setSearchTerm('');
      setFilterDate(null);
    }
  };

  // Handle add button click
  const handleAddClick = () => {
    if (selectedItemType === 'ALL') {
      toast.error('Please select a specific item type to add data');
      return;
    }
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
      const response = await fetch(`/api/customs/beginning-data/${selectedItem.id}`, {
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
        ? '/api/customs/beginning-data'
        : `/api/customs/beginning-data/${selectedItem?.id}`;

      const method = formMode === 'add' ? 'POST' : 'PUT';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          itemType: selectedItemType,
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
      const response = await fetch('/api/customs/beginning-data/import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          records: records.map((r) => ({
            itemType: r.itemType,
            itemCode: r.itemCode,
            itemName: r.itemName,
            uom: r.uom,
            qty: r.qty,
            balanceDate: r.balanceDate,
            remarks: r.remarks,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.message || 'Failed to import data';
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      // Enhanced success message with queue info
      let successMessage = result.message || `Successfully imported ${records.length} beginning stock record(s)!`;
      if (result.success) {
        successMessage += '\n✓ Snapshot recalculation queued for processing';
      }
      
      toast.success(successMessage);
      await fetchData();
    } catch (error: any) {
      console.error('Error importing data:', error);
      toast.error(error.message || 'Failed to import records. Please try again.');
      throw error;
    }
  };

  // Convert data for form initialization
  const getFormInitialData = (): BeginningStockFormData | null => {
    if (!selectedItem || formMode === 'add') return null;

    return {
      itemId: (selectedItem as any).itemId || '',
      item_code: selectedItem.itemCode,
      item_name: selectedItem.itemName,
      item_type: (selectedItem as any).itemType || '',
      uomId: (selectedItem as any).uomId || '',
      uom: selectedItem.uom,
      beginningBalance: selectedItem.beginningBalance,
      qty: selectedItem.beginningBalance,
      beginningDate: dayjs(selectedItem.beginningDate),
      balance_date: dayjs(selectedItem.beginningDate),
      remarks: selectedItem.remarks || '',
    };
  };

  // Get dynamic page title
  const getPageTitle = () => {
    if (selectedItemType === 'ALL') {
      return 'Beginning Data - All Item Types';
    }
    const itemType = itemTypes.find((it) => it.code === selectedItemType);
    return itemType ? `Beginning Data - ${itemType.name}` : 'Beginning Data';
  };

  return (
    <ReportLayout
      title={getPageTitle()}
      subtitle="Manage beginning balance data for stock mutations"
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
      {/* Item Type Dropdown */}
      <Box
        sx={{
          mb: 3,
          p: 2.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        <Autocomplete
          value={itemTypes.find((it) => it.code === selectedItemType) || itemTypes[0] || null}
          onChange={handleItemTypeChange}
          options={itemTypes}
          getOptionLabel={(option) => option.code === 'ALL' ? option.name : `${option.code} - ${option.name}`}
          loading={itemTypesLoading}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Filter by Item Type"
              placeholder="Select item type..."
              size="medium"
              sx={{
                '& .MuiOutlinedInput-root': {
                  bgcolor: 'background.default',
                  '& fieldset': {
                    borderColor: 'divider',
                  },
                  '&:hover fieldset': {
                    borderColor: 'primary.main',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: 'primary.main',
                  },
                },
              }}
            />
          )}
          disableClearable
          sx={{ maxWidth: 500 }}
        />
      </Box>

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
        itemType={selectedItemType}
        initialData={getFormInitialData()}
        mode={formMode}
      />

      {/* Excel Import Dialog */}
      <BeginningStockImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onSubmit={handleImportSubmit}
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
