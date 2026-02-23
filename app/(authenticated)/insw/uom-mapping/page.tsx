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

interface INSWUOMMapping {
  id: number;
  wms_uom: string;
  insw_uom: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function INSWUOMMappingPage() {
  const theme = useTheme();
  const toast = useToast();
  const [data, setData] = useState<INSWUOMMapping[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedMapping, setSelectedMapping] = useState<INSWUOMMapping | null>(null);
  const [formData, setFormData] = useState({
    wms_uom: '',
    insw_uom: '',
    description: '',
    is_active: true,
  });

  const columns: Column[] = [
    {
      id: 'wms_uom',
      label: 'WMS UOM',
      minWidth: 120,
    },
    {
      id: 'insw_uom',
      label: 'INSW UOM',
      minWidth: 120,
    },
    {
      id: 'description',
      label: 'Deskripsi',
      minWidth: 250,
      format: (value: string | null) => value ?? '-',
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
              onClick={() => handleEdit(row as INSWUOMMapping)}
            >
              <Edit fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Delete">
            <IconButton
              size="small"
              color="error"
              onClick={() => handleDeleteClick(row as INSWUOMMapping)}
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

      const response = await fetch(`/api/insw/uom-mapping?${params}`);
      const result = await response.json();

      if (result.success) {
        setData(result.data);
        setError(null);
      } else {
        setData([]);
        setError(result.error || 'Failed to fetch data');
      }
    } catch (err) {
      console.error('Error fetching INSW UOM Mapping:', err);
      setData([]);
      setError('Failed to fetch INSW UOM Mapping data');
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
    setSelectedMapping(null);
    setFormData({
      wms_uom: '',
      insw_uom: '',
      description: '',
      is_active: true,
    });
    setDialogOpen(true);
  };

  const handleEdit = (mapping: INSWUOMMapping) => {
    setEditMode(true);
    setSelectedMapping(mapping);
    setFormData({
      wms_uom: mapping.wms_uom,
      insw_uom: mapping.insw_uom,
      description: mapping.description ?? '',
      is_active: mapping.is_active,
    });
    setDialogOpen(true);
  };

  const handleDeleteClick = (mapping: INSWUOMMapping) => {
    setSelectedMapping(mapping);
    setDeleteDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setSelectedMapping(null);
    setFormData({
      wms_uom: '',
      insw_uom: '',
      description: '',
      is_active: true,
    });
  };

  const handleSave = async () => {
    if (!formData.wms_uom || !formData.insw_uom) {
      toast.error('WMS UOM and INSW UOM are required');
      return;
    }

    try {
      const url = editMode && selectedMapping
        ? `/api/insw/uom-mapping/${selectedMapping.id}`
        : '/api/insw/uom-mapping';

      const method = editMode ? 'PUT' : 'POST';

      const payload = {
        wms_uom: formData.wms_uom,
        insw_uom: formData.insw_uom,
        description: formData.description || null,
        is_active: formData.is_active,
      };

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json();

      if (result.success) {
        toast.success(`UOM Mapping ${editMode ? 'updated' : 'created'} successfully`);
        handleCloseDialog();
        fetchData();
      } else {
        toast.error(result.error || `Failed to ${editMode ? 'update' : 'create'} UOM Mapping`);
      }
    } catch (error) {
      console.error('Error saving UOM Mapping:', error);
      toast.error(`Failed to ${editMode ? 'update' : 'create'} UOM Mapping`);
    }
  };

  const handleDelete = async () => {
    if (!selectedMapping) return;

    try {
      const response = await fetch(`/api/insw/uom-mapping/${selectedMapping.id}`, {
        method: 'DELETE',
      });

      const result = await response.json();

      if (result.success) {
        toast.success('UOM Mapping deleted successfully');
        setDeleteDialogOpen(false);
        setSelectedMapping(null);
        fetchData();
      } else {
        toast.error(result.error || 'Failed to delete UOM Mapping');
      }
    } catch (error) {
      console.error('Error deleting UOM Mapping:', error);
      toast.error('Failed to delete UOM Mapping');
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
            INSW UOM Mapping
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Kelola mapping satuan ukuran WMS ke kode INSW
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
            placeholder="Search by WMS UOM, INSW UOM, or description..."
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
          {editMode ? 'Edit UOM Mapping' : 'Add New UOM Mapping'}
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="WMS UOM"
              value={formData.wms_uom}
              onChange={(e) =>
                setFormData({ ...formData, wms_uom: e.target.value.toUpperCase() })
              }
              fullWidth
              required
              disabled={editMode}
              helperText={editMode ? 'WMS UOM cannot be changed' : ''}
            />
            <TextField
              label="INSW UOM"
              value={formData.insw_uom}
              onChange={(e) =>
                setFormData({ ...formData, insw_uom: e.target.value.toUpperCase() })
              }
              fullWidth
              required
            />
            <TextField
              label="Deskripsi"
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              fullWidth
              multiline
              rows={2}
            />
            <FormControlLabel
              control={
                <Switch
                  checked={formData.is_active}
                  onChange={(e) =>
                    setFormData({ ...formData, is_active: e.target.checked })
                  }
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
            Are you sure you want to delete UOM Mapping{' '}
            <strong>{selectedMapping?.wms_uom}</strong>{' '}
            &rarr;{' '}
            <strong>{selectedMapping?.insw_uom}</strong>?
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
