'use client';

import React, { useState } from 'react';
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

interface Supplier {
  id: string;
  code: string;
  name: string;
  address: string;
}

const columns: Column[] = [
  { id: 'code', label: 'Code', minWidth: 100 },
  { id: 'name', label: 'Name', minWidth: 200 },
  { id: 'address', label: 'Address', minWidth: 250 },
];

export default function SupplierPage() {
  const theme = useTheme();
  const [suppliers, setSuppliers] = useState<Supplier[]>([
    { id: '1', code: 'SUP001', name: 'PT. Supplier Indonesia', address: 'Bandung, Indonesia' },
    { id: '2', code: 'SUP002', name: 'CV. Material Supply', address: 'Semarang, Indonesia' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState({
    code: '',
    name: '',
    address: '',
  });

  const handleAdd = () => {
    setEditingSupplier(null);
    setFormData({ code: '', name: '', address: '' });
    setDialogOpen(true);
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({ code: supplier.code, name: supplier.name, address: supplier.address });
    setDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this supplier?')) return;
    setSuppliers(suppliers.filter((s) => s.id !== id));
  };

  const handleSave = async () => {
    if (editingSupplier) {
      setSuppliers(
        suppliers.map((s) =>
          s.id === editingSupplier.id ? { ...s, ...formData } : s
        )
      );
    } else {
      const newSupplier = {
        id: Date.now().toString(),
        ...formData,
      };
      setSuppliers([...suppliers, newSupplier]);
    }
    setDialogOpen(false);
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
          Suppliers
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
          Add Supplier
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={suppliers}
        loading={loading}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editingSupplier ? 'Edit Supplier' : 'Add New Supplier'}
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
            <TextField
              label="Address"
              value={formData.address}
              onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              required
              fullWidth
              multiline
              rows={3}
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
