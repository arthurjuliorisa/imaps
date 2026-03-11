'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
  alpha,
  useTheme,
  Chip,
  TextField,
  Stack,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  FormControlLabel,
  Switch,
} from '@mui/material';
import { Refresh, Add, Edit, Delete } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';

interface INSWUOM {
  id: number;
  kode: string;
  uraian: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function INSWUOMPage() {
  const theme = useTheme();
  const toast = useToast();
  const [data, setData] = useState<INSWUOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedUOM, setSelectedUOM] = useState<INSWUOM | null>(null);
  const [formData, setFormData] = useState({
    kode: '',
    uraian: '',
    is_active: true,
  });

  const columns: Column[] = [
    {
      id: 'kode',
      label: 'Kode',
      minWidth: 100,
    },
    {
      id: 'uraian',
      label: 'Uraian',
      minWidth: 300,
    },
    {
      id: 'is_active',
      label: 'Status',
      minWidth: 100,
      format: (value: boolean) => (
        <Chip
          label={value ? 'ACTIVE' : 'INACTIVE'}
          color={value ? 'success' : 'default'}
          size="small"
          sx={{ fontWeight: 'bold' }}
        />
      ),
    },
    {
      id: 'actions',
      label: 'Actions',
      minWidth: 120,
      format: (value: any, row: any) => (
        <Stack direction="row" spacing={1}>
          <Tooltip title="Edit">
            <IconButton
              size="small"
              color="primary"
              onClick={() => handleEdit(row as INSWUOM)}
            >
              <Edit fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={() => handleDeleteClick(row as INSWUOM)}
            >
              <Delete fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
      ),
    },
  ];

  useEffect(() => {
    fetchData();
  }, [searchQuery]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ...(searchQuery && { search: searchQuery }),
      });

      const response = await fetch(`/api/insw/uom?${params}`);
      const result = await response.json();

      if (result.success) {
        setData(result.data);
        setError(null);
      } else {
        setData([]);
        setError(result.error || 'Failed to fetch data');
      }
    } catch (err) {
      console.error('Error fetching INSW UOM:', err);
      setData([]);
      setError('Failed to fetch INSW UOM data');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchData();
    toast.success('Data refreshed');
  };

  const handleAdd = () => {
    setEditMode(false);
    setSelectedUOM(null);
    setFormData({
      kode: '',
      uraian: '',
      is_active: true,
    });
    setDialogOpen(true);
  };

  const handleEdit = (uom: INSWUOM) => {
    setEditMode(true);
    setSelectedUOM(uom);
    setFormData({
      kode: uom.kode,
      uraian: uom.uraian,
      is_active: uom.is_active,
    });
    setDialogOpen(true);
  };

  const handleDeleteClick = (uom: INSWUOM) => {
    setSelectedUOM(uom);
    setDeleteDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedUOM(null);
    setFormData({
      kode: '',
      uraian: '',
      is_active: true,
    });
  };

  const handleSave = async () => {
    if (!formData.kode || !formData.uraian) {
      toast.error('Kode and Uraian are required');
      return;
    }

    try {
      const url = editMode && selectedUOM
        ? `/api/insw/uom/${selectedUOM.id}`
        : '/api/insw/uom';

      const method = editMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`UOM ${editMode ? 'updated' : 'created'} successfully`);
        handleCloseDialog();
        fetchData();
      } else {
        toast.error(result.error || `Failed to ${editMode ? 'update' : 'create'} UOM`);
      }
    } catch (error) {
      console.error('Error saving UOM:', error);
      toast.error(`Failed to ${editMode ? 'update' : 'create'} UOM`);
    }
  };

  const handleDelete = async () => {
    if (!selectedUOM) return;

    try {
      const response = await fetch(`/api/insw/uom/${selectedUOM.id}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        toast.success('UOM deleted successfully');
        setDeleteDialogOpen(false);
        setSelectedUOM(null);
        fetchData();
      } else {
        toast.error(result.error || 'Failed to delete UOM');
      }
    } catch (error) {
      console.error('Error deleting UOM:', error);
      toast.error('Failed to delete UOM');
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
        <Box>
          <Typography variant="h5" fontWeight="bold" color="primary">
            INSW UOM Reference
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Manage Unit of Measure reference data from INSW
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Add New">
            <IconButton onClick={handleAdd} color="primary">
              <Add />
            </IconButton>
          </Tooltip>
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} color="primary">
              <Refresh />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3, boxShadow: 1 }}>
        <CardContent>
          <TextField
            label="Search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by code or description..."
            size="small"
            fullWidth
            sx={{ maxWidth: 400 }}
          />
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        searchable={false}
      />

      <Dialog open={dialogOpen} onClose={handleCloseDialog} maxWidth="sm" fullWidth>
        <DialogTitle>
          {editMode ? 'Edit UOM' : 'Add New UOM'}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Kode"
              value={formData.kode}
              onChange={(e) => setFormData({ ...formData, kode: e.target.value })}
              fullWidth
              required
              disabled={editMode}
              helperText={editMode ? 'Code cannot be changed' : ''}
            />
            <TextField
              label="Uraian"
              value={formData.uraian}
              onChange={(e) => setFormData({ ...formData, uraian: e.target.value })}
              fullWidth
              required
              multiline
              rows={2}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                />
              }
              label="Active"
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button onClick={handleSave} variant="contained">
            {editMode ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete UOM <strong>{selectedUOM?.kode}</strong>?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button onClick={handleDelete} variant="contained" color="error">
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
