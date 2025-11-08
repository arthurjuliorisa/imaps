'use client';

import React, { useState, useEffect } from 'react';
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
  const [items, setItems] = useState<Item[]>([]);
  const [uoms, setUoms] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentItem, setCurrentItem] = useState<Partial<Item>>({});
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

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
  }, []);

  const fetchItems = async () => {
    try {
      const response = await fetch('/api/master/item');
      if (response.ok) {
        const data = await response.json();
        setItems(data);
      }
    } catch (err) {
      console.error('Error fetching items:', err);
    }
  };

  const fetchUOMs = async () => {
    try {
      const response = await fetch('/api/master/uom');
      if (response.ok) {
        const data = await response.json();
        setUoms(data);
      }
    } catch (err) {
      console.error('Error fetching UOMs:', err);
    }
  };

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
      } else {
        const data = await response.json();
        setError(data.message || 'Failed to save item');
      }
    } catch (err) {
      setError('An error occurred while saving');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (item: Item) => {
    if (confirm(`Are you sure you want to delete "${item.name}"?`)) {
      try {
        const response = await fetch(`/api/master/item/${item.id}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          fetchItems();
        } else {
          alert('Failed to delete item');
        }
      } catch (err) {
        alert('An error occurred while deleting');
      }
    }
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
          <Typography variant="h5" fontWeight="bold">
            {editMode ? 'Edit Item' : 'Add New Item'}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {editMode ? 'Update the item details below' : 'Fill in the details to create a new item'}
          </Typography>
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
                      <Typography variant="body2">{getTypeLabel(type)}</Typography>
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
                        <Typography variant="body2" fontWeight={600}>
                          {uom.code}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          - {uom.name}
                        </Typography>
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
    </Box>
  );
}
