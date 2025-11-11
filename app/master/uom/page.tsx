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

interface Uom {
  id: string;
  code: string;
  name: string;
}

const columns: Column[] = [
  { id: 'code', label: 'Code', minWidth: 150 },
  { id: 'name', label: 'Name', minWidth: 200 },
];

export default function UomPage() {
  const theme = useTheme();
  const toast = useToast();
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUom, setEditingUom] = useState<Uom | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
  });
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [uomToDelete, setUomToDelete] = useState<Uom | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchUoms = useCallback(async () => {
    try {
      const response = await fetch('/api/master/uom');
      if (!response.ok) throw new Error('Failed to fetch UOMs');
      const data = await response.json();
      setUoms(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUoms();
  }, [fetchUoms]);

  const handleAdd = () => {
    setEditingUom(null);
    setFormData({ code: '', name: '' });
    setDialogOpen(true);
  };

  const handleEdit = (uom: Uom) => {
    setEditingUom(uom);
    setFormData({ code: uom.code, name: uom.name });
    setDialogOpen(true);
  };

  const handleDelete = (uom: Uom) => {
    setUomToDelete(uom);
    setConfirmDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!uomToDelete) return;

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/master/uom/${uomToDelete.id}`, {
        method: 'DELETE',
      });
      if (!response.ok) {
        const data = await response.json();
        const errorMessage = data.message || 'Failed to delete UOM';
        if (errorMessage.toLowerCase().includes('related') ||
            errorMessage.toLowerCase().includes('cannot delete') ||
            errorMessage.toLowerCase().includes('foreign key') ||
            errorMessage.toLowerCase().includes('constraint')) {
          toast.error('Cannot delete: This UOM is referenced in other records');
        } else {
          toast.error(errorMessage);
        }
        return;
      }
      await fetchUoms();
      toast.success(`UOM "${uomToDelete.name}" deleted successfully!`);
      setConfirmDialogOpen(false);
      setUomToDelete(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete UOM';
      toast.error(errorMessage);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCancelDelete = () => {
    setConfirmDialogOpen(false);
    setUomToDelete(null);
  };

  const handleSave = async () => {
    try {
      const url = editingUom
        ? `/api/master/uom/${editingUom.id}`
        : '/api/master/uom';

      const response = await fetch(url, {
        method: editingUom ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to save UOM');
      }

      setDialogOpen(false);
      await fetchUoms();
      toast.success(editingUom ? 'UOM updated successfully!' : 'UOM created successfully!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save UOM';
      setError(errorMessage);
      toast.error(errorMessage);
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
          Unit of Measurement (UOM)
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
          Add UOM
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={uoms}
        loading={loading}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <Dialog open={dialogOpen} onClose={() => !loading && setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingUom ? 'Edit UOM' : 'Add New UOM'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              label="Code"
              value={formData.code}
              onChange={(e) => setFormData({ ...formData, code: e.target.value })}
              required
              fullWidth
            />
            <TextField
              label="Name"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} startIcon={<Close />}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" startIcon={<Save />}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDialogOpen}
        title="Delete UOM"
        message={`Are you sure you want to delete "${uomToDelete?.name}"? This action cannot be undone.`}
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
