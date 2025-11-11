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
  Alert,
  Stack,
  alpha,
  useTheme,
} from '@mui/material';
import { Add, Save, Close } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';

interface Currency {
  id: string;
  code: string;
  name: string;
}

const columns: Column[] = [
  { id: 'code', label: 'Code', minWidth: 100 },
  { id: 'name', label: 'Name', minWidth: 200 },
];

export default function CurrencyPage() {
  const theme = useTheme();
  const toast = useToast();
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCurrency, setEditingCurrency] = useState<Currency | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
  });
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [currencyToDelete, setCurrencyToDelete] = useState<Currency | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchCurrencies = useCallback(async () => {
    setDataLoading(true);
    try {
      const response = await fetch('/api/master/currency');
      if (!response.ok) throw new Error('Failed to fetch currencies');
      const data = await response.json();
      setCurrencies(data);
    } catch (err) {
      console.error('Error fetching currencies:', err);
      toast.error('Failed to load currencies');
    } finally {
      setDataLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchCurrencies();
  }, [fetchCurrencies]);

  const handleAdd = () => {
    setEditingCurrency(null);
    setFormData({ code: '', name: '' });
    setDialogOpen(true);
  };

  const handleEdit = (currency: Currency) => {
    setEditingCurrency(currency);
    setFormData({ code: currency.code, name: currency.name });
    setDialogOpen(true);
  };

  const handleDelete = (currency: Currency) => {
    setCurrencyToDelete(currency);
    setConfirmDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!currencyToDelete) return;

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/master/currency/${currencyToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to delete currency');
      }

      await fetchCurrencies();
      toast.success(`Currency "${currencyToDelete.name}" deleted successfully!`);
      setConfirmDialogOpen(false);
      setCurrencyToDelete(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete currency';
      toast.error(errorMessage);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCancelDelete = () => {
    setConfirmDialogOpen(false);
    setCurrencyToDelete(null);
  };

  const handleSave = async () => {
    if (!formData.code || !formData.name) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = editingCurrency
        ? `/api/master/currency/${editingCurrency.id}`
        : '/api/master/currency';

      const response = await fetch(url, {
        method: editingCurrency ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to save currency');
      }

      await fetchCurrencies();
      setDialogOpen(false);
      toast.success(editingCurrency ? 'Currency updated successfully!' : 'Currency created successfully!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save currency';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
          pb: 2,
          borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Typography variant="h5" fontWeight="bold" color="primary">
          Currency
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleAdd}
          sx={{
            borderRadius: 2,
            textTransform: 'none',
            px: 3,
            boxShadow: 2,
          }}
        >
          Add Currency
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={currencies}
        loading={dataLoading}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <Dialog
        open={dialogOpen}
        onClose={(_event, reason) => {
          if (loading) return;
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
          setDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editingCurrency ? 'Edit Currency' : 'Add New Currency'}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              label="Code"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              required
              fullWidth
              placeholder="e.g., USD, IDR"
              disabled={loading}
            />
            <TextField
              label="Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              fullWidth
              placeholder="e.g., US Dollar"
              disabled={loading}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} startIcon={<Close />} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" startIcon={<Save />} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDialogOpen}
        title="Delete Currency"
        message={`Are you sure you want to delete "${currencyToDelete?.name}"? This action cannot be undone.`}
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
