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
  Alert,
  Stack,
  alpha,
  useTheme,
} from '@mui/material';
import { Add, Save, Close } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';

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
  const [uoms, setUoms] = useState<Uom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUom, setEditingUom] = useState<Uom | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
  });

  useEffect(() => {
    fetchUoms();
  }, []);

  const fetchUoms = async () => {
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
  };

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

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this UOM?')) return;

    try {
      const response = await fetch(`/api/master/uom/${id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete UOM');
      fetchUoms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete UOM');
    }
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

      if (!response.ok) throw new Error('Failed to save UOM');

      setDialogOpen(false);
      fetchUoms();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save UOM');
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

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
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
    </Box>
  );
}
