'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Autocomplete,
  Stack,
} from '@mui/material';
import { Add as AddIcon } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';
import { ItemMaster } from '@/types/stock-opname';

interface ManualInputDialogProps {
  open: boolean;
  onClose: () => void;
  stockOpnameId: number;
  onSuccess: () => void;
}

export function ManualInputDialog({
  open,
  onClose,
  stockOpnameId,
  onSuccess,
}: ManualInputDialogProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<ItemMaster[]>([]);
  const [selectedItem, setSelectedItem] = useState<ItemMaster | null>(null);
  const [searchInput, setSearchInput] = useState('');

  const [formData, setFormData] = useState({
    sto_qty: '',
    report_area: '',
    remark: '',
  });

  // Load initial 5 items when dialog opens
  useEffect(() => {
    if (open) {
      loadInitialItems();
    }
  }, [open]);

  const loadInitialItems = async () => {
    try {
      const response = await fetch('/api/customs/stock-opname/items-master?limit=5');
      if (!response.ok) throw new Error('Failed to fetch items');

      const data = await response.json();
      setItems(data);
    } catch (error) {
      console.error('Error loading initial items:', error);
    }
  };

  const handleSearchItems = async (query: string) => {
    if (query.length < 2) {
      // Load initial 5 items if query is too short
      loadInitialItems();
      return;
    }

    try {
      const response = await fetch(
        `/api/customs/stock-opname/items-master?search=${encodeURIComponent(query)}`
      );
      if (!response.ok) throw new Error('Failed to fetch items');

      const data = await response.json();
      setItems(data);
    } catch (error) {
      console.error('Error searching items:', error);
      toast.error('Failed to search items');
    }
  };

  const handleAddItem = async () => {
    if (!selectedItem) {
      toast.error('Please select an item');
      return;
    }

    if (!formData.sto_qty || parseFloat(formData.sto_qty) < 0) {
      toast.error('Please enter a valid STO quantity');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/customs/stock-opname/${stockOpnameId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_code: selectedItem.item_code,
          sto_qty: parseFloat(formData.sto_qty),
          report_area: formData.report_area.trim() || null,
          remark: formData.remark.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to add item');
      }

      toast.success('Item added successfully');
      setSelectedItem(null);
      setSearchInput('');
      setFormData({
        sto_qty: '',
        report_area: '',
        remark: '',
      });
      onSuccess();
    } catch (error) {
      console.error('Error adding item:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to add item');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setSelectedItem(null);
      setSearchInput('');
      setFormData({
        sto_qty: '',
        report_area: '',
        remark: '',
      });
      onClose();
    }
  };

  const variant =
    selectedItem && formData.sto_qty
      ? parseFloat(formData.sto_qty) - (selectedItem.end_stock || 0)
      : 0;

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Manual Input Item</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 2 }}>
          <Autocomplete
            value={selectedItem}
            onChange={(_, newValue) => setSelectedItem(newValue)}
            inputValue={searchInput}
            onInputChange={(_, newValue) => {
              setSearchInput(newValue);
              handleSearchItems(newValue);
            }}
            options={items}
            getOptionLabel={(option) =>
              `${option.item_code} - ${option.item_name} (${option.item_type})`
            }
            renderInput={(params) => (
              <TextField {...params} label="Item Code" placeholder="Search item..." required />
            )}
            loading={loading}
            fullWidth
          />

          {selectedItem && (
            <>
              <TextField
                label="Item Name"
                value={selectedItem.item_name}
                InputProps={{ readOnly: true }}
                fullWidth
                sx={{
                  '& .MuiInputBase-root': {
                    backgroundColor: 'action.hover',
                  },
                }}
              />

              <TextField
                label="Item Type"
                value={selectedItem.item_type}
                InputProps={{ readOnly: true }}
                fullWidth
                sx={{
                  '& .MuiInputBase-root': {
                    backgroundColor: 'action.hover',
                  },
                }}
              />

              <TextField
                label="End Stock"
                value={(selectedItem.end_stock || 0).toFixed(2)}
                InputProps={{ readOnly: true }}
                fullWidth
                sx={{
                  '& .MuiInputBase-root': {
                    backgroundColor: 'action.hover',
                  },
                }}
              />

              <TextField
                label="STO Qty"
                type="number"
                value={formData.sto_qty}
                onChange={(e) => setFormData({ ...formData, sto_qty: e.target.value })}
                inputProps={{ min: 0, step: 0.01 }}
                required
                fullWidth
              />

              <TextField
                label="Variance"
                value={variant.toFixed(2)}
                InputProps={{ readOnly: true }}
                fullWidth
                sx={{
                  '& .MuiInputBase-root': {
                    backgroundColor: 'action.hover',
                  },
                  '& .MuiInputBase-input': {
                    color: variant > 0 ? 'success.main' : variant < 0 ? 'error.main' : 'inherit',
                    fontWeight: 600,
                  },
                }}
              />

              <TextField
                label="Report Area"
                value={formData.report_area}
                onChange={(e) => setFormData({ ...formData, report_area: e.target.value })}
                fullWidth
              />

              <TextField
                label="Remark"
                value={formData.remark}
                onChange={(e) => setFormData({ ...formData, remark: e.target.value })}
                multiline
                rows={3}
                fullWidth
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          onClick={handleAddItem}
          variant="contained"
          startIcon={<AddIcon />}
          disabled={loading || !selectedItem || !formData.sto_qty}
        >
          {loading ? 'Adding...' : 'Add Item'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
