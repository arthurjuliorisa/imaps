'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Alert,
  Stack,
  Chip,
  alpha,
  useTheme,
  CircularProgress,
  Fade,
} from '@mui/material';
import { Add, Save, Close } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';

interface Item {
  id: string;
  code: string;
  name: string;
  type: string;
  uomId: string;
  uomName?: string;
}

const itemTypes = ['RM', 'FG', 'SFG', 'CAPITAL', 'SCRAP'];

const columns: Column[] = [
  { id: 'code', label: 'Code', minWidth: 100 },
  { id: 'name', label: 'Name', minWidth: 200 },
  { id: 'uomName', label: 'UOM', minWidth: 100 },
  {
    id: 'type',
    label: 'Type',
    minWidth: 120,
    format: (value: string) => {
      if (!value) return '-';

      const typeMap: { [key: string]: string } = {
        'RM': 'Raw Material',
        'FG': 'Finished Goods',
        'SFG': 'Semi-Finished Goods',
        'CAPITAL': 'Capital Goods',
        'SCRAP': 'Scrap',
      };
      return typeMap[value] || value;
    }
  },
];

export default function ItemPage() {
  const theme = useTheme();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [uoms, setUoms] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentItem, setCurrentItem] = useState<Partial<Item>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchItems = useCallback(async () => {
    try {
      const response = await fetch('/api/master/item');
      if (response.ok) {
        const data = await response.json();
        setItems(data);
      }
    } catch (err) {
      console.error('Error fetching items:', err);
    }
  }, []);

  const fetchUOMs = useCallback(async () => {
    try {
      const response = await fetch('/api/master/uom');
      if (response.ok) {
        const data = await response.json();
        setUoms(data);
      }
    } catch (err) {
      console.error('Error fetching UOMs:', err);
    }
  }, []);

  useEffect(() => {
    const loadData = async () => {
      setDataLoading(true);
      try {
        await Promise.all([fetchItems(), fetchUOMs()]);
      } finally {
        setDataLoading(false);
      }
    };
    loadData();
  }, [fetchItems, fetchUOMs]);

  const handleOpen = () => {
    setEditMode(false);
    setCurrentItem({});
    setError('');
    setOpen(true);
  };

  const handleEdit = (item: Item) => {
    setEditMode(true);
    setCurrentItem(item);
    setError('');
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setCurrentItem({});
    setError('');
  };

  const handleSave = async () => {
    if (!currentItem.code || !currentItem.name || !currentItem.type || !currentItem.uomId) {
      setError('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const url = editMode ? `/api/master/item/${currentItem.id}` : '/api/master/item';
      const method = editMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(currentItem),
      });

      if (response.ok) {
        await fetchItems();
        handleClose();
        toast.success(editMode ? 'Item updated successfully!' : 'Item created successfully!');
      } else {
        const data = await response.json();
        const errorMessage = data.message || 'Failed to save item';
        setError(errorMessage);
        toast.error(errorMessage);
      }
    } catch (err) {
      const errorMessage = 'An error occurred while saving';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (item: Item) => {
    setItemToDelete(item);
    setConfirmDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!itemToDelete) return;

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/master/item/${itemToDelete.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchItems();
        toast.success(`Item "${itemToDelete.name}" deleted successfully!`);
        setConfirmDialogOpen(false);
        setItemToDelete(null);
      } else {
        const data = await response.json();
        const errorMessage = data.message || 'Failed to delete item';
        if (errorMessage.toLowerCase().includes('related') ||
            errorMessage.toLowerCase().includes('cannot delete') ||
            errorMessage.toLowerCase().includes('foreign key') ||
            errorMessage.toLowerCase().includes('constraint')) {
          toast.error('Cannot delete: This item is referenced in other records');
        } else {
          toast.error(errorMessage);
        }
      }
    } catch (err) {
      toast.error('An error occurred while deleting');
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCancelDelete = () => {
    setConfirmDialogOpen(false);
    setItemToDelete(null);
  };

  const getTypeLabel = (type: string) => {
    const typeMap: { [key: string]: string } = {
      'RM': 'Raw Material',
      'FG': 'Finished Goods',
      'SFG': 'Semi-Finished Goods',
      'CAPITAL': 'Capital Goods',
      'SCRAP': 'Scrap',
    };
    return typeMap[type] || type;
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            Item Master
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage your inventory items and their details
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleOpen}
          size="large"
          sx={{
            px: 3,
            boxShadow: theme.shadows[4],
          }}
        >
          Add Item
        </Button>
      </Box>

      <DataTable
        columns={columns}
        data={items}
        onEdit={handleEdit}
        onDelete={handleDelete}
        searchPlaceholder="Search items..."
        loading={dataLoading}
        emptyMessage="No items found"
      />

      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          elevation: 8,
          sx: {
            borderRadius: 3,
          },
        }}
      >
        <DialogTitle
          sx={{
            pb: 2,
            background: alpha(theme.palette.primary.main, 0.05),
            borderBottom: `1px solid ${theme.palette.divider}`,
          }}
        >
          <Box component="span" sx={{ fontSize: '1.5rem', fontWeight: 'bold', display: 'block' }}>
            {editMode ? 'Edit Item' : 'Add New Item'}
          </Box>
          <Box component="span" sx={{ fontSize: '0.875rem', color: 'text.secondary', display: 'block', mt: 0.5 }}>
            {editMode ? 'Update the item details below' : 'Fill in the details to create a new item'}
          </Box>
        </DialogTitle>
        <DialogContent sx={{ mt: 3 }}>
          <Fade in={!!error}>
            <Box>
              {error && (
                <Alert
                  severity="error"
                  sx={{
                    mb: 2,
                    borderRadius: 2,
                  }}
                  onClose={() => setError('')}
                >
                  {error}
                </Alert>
              )}
            </Box>
          </Fade>
          <Stack spacing={2.5}>
            <TextField
              fullWidth
              label="Item Code"
              value={currentItem.code || ''}
              onChange={(e) => setCurrentItem({ ...currentItem, code: e.target.value })}
              required
              placeholder="e.g., ITM-001"
              helperText="Unique identifier for the item"
            />
            <TextField
              fullWidth
              label="Item Name"
              value={currentItem.name || ''}
              onChange={(e) => setCurrentItem({ ...currentItem, name: e.target.value })}
              required
              placeholder="e.g., Steel Sheet"
              helperText="Descriptive name of the item"
            />
            <FormControl fullWidth required>
              <InputLabel>Item Type</InputLabel>
              <Select
                value={currentItem.type || ''}
                onChange={(e) => setCurrentItem({ ...currentItem, type: e.target.value })}
                label="Item Type"
              >
                {itemTypes.map((type) => (
                  <MenuItem key={type} value={type}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Chip
                        label={type}
                        size="small"
                        color="primary"
                        variant="outlined"
                        sx={{ fontWeight: 600 }}
                      />
                      <Box component="span" sx={{ fontSize: '0.875rem' }}>{getTypeLabel(type)}</Box>
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth required>
              <InputLabel>Unit of Measure (UOM)</InputLabel>
              <Select
                value={currentItem.uomId || ''}
                onChange={(e) => setCurrentItem({ ...currentItem, uomId: e.target.value })}
                label="Unit of Measure (UOM)"
              >
                {uoms.length === 0 ? (
                  <MenuItem disabled>No UOMs available</MenuItem>
                ) : (
                  uoms.map((uom) => (
                    <MenuItem key={uom.id} value={uom.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box component="span" sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
                          {uom.code}
                        </Box>
                        <Box component="span" sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>
                          - {uom.name}
                        </Box>
                      </Box>
                    </MenuItem>
                  ))
                )}
              </Select>
            </FormControl>
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{
            px: 3,
            py: 2,
            gap: 1,
            borderTop: `1px solid ${theme.palette.divider}`,
            bgcolor: alpha(theme.palette.background.default, 0.5),
          }}
        >
          <Button
            onClick={handleClose}
            disabled={loading}
            startIcon={<Close />}
            sx={{ px: 3 }}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <Save />}
            sx={{ px: 3 }}
          >
            {loading ? 'Saving...' : editMode ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDialogOpen}
        title="Delete Item"
        message={`Are you sure you want to delete "${itemToDelete?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        severity="error"
        loading={deleteLoading}
      />
    </Box>
  );
}
