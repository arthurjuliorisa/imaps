'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Typography,
} from '@mui/material';
import { StockOpnameItem } from '@/types/stock-opname';
import { useToast } from '@/app/components/ToastProvider';

interface EditItemDialogProps {
  open: boolean;
  item: StockOpnameItem | null;
  stockOpnameId: number;
  onClose: () => void;
  onUpdate: () => void;
}

export function EditItemDialog({
  open,
  item,
  stockOpnameId,
  onClose,
  onUpdate,
}: EditItemDialogProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    sto_qty: '',
    report_area: '',
    remark: '',
  });

  useEffect(() => {
    if (item) {
      setFormData({
        sto_qty: item.sto_qty.toString(),
        report_area: item.report_area || '',
        remark: item.remark || '',
      });
    }
  }, [item]);

  const handleSubmit = async () => {
    if (!item) return;

    if (!formData.sto_qty || parseFloat(formData.sto_qty) < 0) {
      toast.error('Please enter a valid STO quantity');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(
        `/api/customs/stock-opname/${stockOpnameId}/items/${item.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sto_qty: parseFloat(formData.sto_qty),
            report_area: formData.report_area.trim() || null,
            remark: formData.remark.trim() || null,
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to update item');
      }

      toast.success('Item updated successfully');
      onUpdate();
      onClose();
    } catch (error) {
      console.error('Error updating item:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update item');
    } finally {
      setLoading(false);
    }
  };

  const variant = item
    ? parseFloat(formData.sto_qty || '0') - item.end_stock
    : 0;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit Item</DialogTitle>
      <DialogContent>
        {item && (
          <Stack spacing={3} sx={{ mt: 2 }}>
            <TextField
              label="Item Code"
              value={item.item_code}
              InputProps={{ readOnly: true }}
              fullWidth
              sx={{
                '& .MuiInputBase-root': {
                  backgroundColor: 'action.hover',
                },
              }}
            />

            <TextField
              label="Item Name"
              value={item.item_name}
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
              value={item.item_type}
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
              value={item.end_stock.toFixed(2)}
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
          </Stack>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
