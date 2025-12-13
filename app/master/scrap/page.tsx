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
  CircularProgress,
  Fade,
  Chip,
  IconButton,
  Autocomplete,
  Paper,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
} from '@mui/material';
import { Add, Save, Close, Delete as DeleteIcon } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';

interface Item {
  id: string;
  code: string;
  name: string;
}

interface ScrapMaster {
  id: string;
  code: string;
  name: string;
  description?: string;
  items?: Item[];
  itemCount?: number;
}

const columns: Column[] = [
  { id: 'code', label: 'Code', minWidth: 120 },
  { id: 'name', label: 'Name', minWidth: 200 },
  { id: 'description', label: 'Description', minWidth: 200 },
  {
    id: 'items',
    label: 'Items',
    minWidth: 250,
    format: (value: Item[]) => {
      if (!value || value.length === 0) return '-';
      const itemCodes = value.map(item => item.code).join(', ');
      return value.length > 3
        ? `${value.slice(0, 3).map(item => item.code).join(', ')} +${value.length - 3} more`
        : itemCodes;
    }
  },
];

export default function ScrapMasterPage() {
  const theme = useTheme();
  const toast = useToast();
  const [scraps, setScraps] = useState<ScrapMaster[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [currentScrap, setCurrentScrap] = useState<Partial<ScrapMaster>>({});
  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [scrapToDelete, setScrapToDelete] = useState<ScrapMaster | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const fetchScraps = useCallback(async () => {
    try {
      const response = await fetch('/api/master/scrap');
      if (response.ok) {
        const data = await response.json();
        setScraps(data);
      }
    } catch (err) {
      console.error('Error fetching scraps:', err);
    }
  }, []);

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

  useEffect(() => {
    const loadData = async () => {
      setDataLoading(true);
      try {
        await Promise.all([fetchScraps(), fetchItems()]);
      } finally {
        setDataLoading(false);
      }
    };
    loadData();
  }, [fetchScraps, fetchItems]);

  const handleOpen = () => {
    setEditMode(false);
    setCurrentScrap({});
    setSelectedItems([]);
    setError('');
    setOpen(true);
  };

  const handleEdit = (scrap: ScrapMaster) => {
    setEditMode(true);
    setCurrentScrap(scrap);
    setSelectedItems(scrap.items || []);
    setError('');
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    setCurrentScrap({});
    setSelectedItems([]);
    setError('');
  };

  const handleRemoveItem = (itemId: string) => {
    setSelectedItems(selectedItems.filter(item => item.id !== itemId));
  };

  const handleSave = async () => {
    if (!currentScrap.code || !currentScrap.name) {
      setError('Code and Name are required');
      return;
    }

    if (selectedItems.length === 0) {
      setError('Please add at least one item');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const url = editMode ? `/api/master/scrap/${currentScrap.id}` : '/api/master/scrap';
      const method = editMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...currentScrap,
          itemIds: selectedItems.map(item => item.id),
        }),
      });

      if (response.ok) {
        await fetchScraps();
        handleClose();
        toast.success(editMode ? 'Scrap master updated successfully!' : 'Scrap master created successfully!');
      } else {
        const data = await response.json();
        const errorMessage = data.message || 'Failed to save scrap master';
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

  const handleDelete = (scrap: ScrapMaster) => {
    setScrapToDelete(scrap);
    setConfirmDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!scrapToDelete) return;

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/master/scrap/${scrapToDelete.id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        await fetchScraps();
        toast.success(`Scrap master "${scrapToDelete.name}" deleted successfully!`);
        setConfirmDialogOpen(false);
        setScrapToDelete(null);
      } else {
        const data = await response.json();
        const errorMessage = data.message || 'Failed to delete scrap master';
        if (errorMessage.toLowerCase().includes('related') ||
            errorMessage.toLowerCase().includes('cannot delete') ||
            errorMessage.toLowerCase().includes('foreign key') ||
            errorMessage.toLowerCase().includes('constraint')) {
          toast.error('Cannot delete: This scrap master is referenced in other records');
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
    setScrapToDelete(null);
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" fontWeight="bold" gutterBottom>
            Scrap Master
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Manage scrap collections and their associated items
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
          Add Scrap Master
        </Button>
      </Box>

      <DataTable
        columns={columns}
        data={scraps}
        onEdit={handleEdit}
        onDelete={handleDelete}
        searchPlaceholder="Search scrap masters..."
        loading={dataLoading}
        emptyMessage="No scrap masters found"
      />

      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="md"
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
            {editMode ? 'Edit Scrap Master' : 'Add New Scrap Master'}
          </Box>
          <Box component="span" sx={{ fontSize: '0.875rem', color: 'text.secondary', display: 'block', mt: 0.5 }}>
            {editMode ? 'Update the scrap master details below' : 'Fill in the details to create a new scrap master'}
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
              label="Scrap Code"
              value={currentScrap.code || ''}
              onChange={(e) => setCurrentScrap({ ...currentScrap, code: e.target.value })}
              required
              placeholder="e.g., SCRAP-001"
              helperText="Unique identifier for the scrap master"
            />
            <TextField
              fullWidth
              label="Scrap Name"
              value={currentScrap.name || ''}
              onChange={(e) => setCurrentScrap({ ...currentScrap, name: e.target.value })}
              required
              placeholder="e.g., Metal Scrap Collection"
              helperText="Descriptive name of the scrap master"
            />
            <TextField
              fullWidth
              label="Description"
              value={currentScrap.description || ''}
              onChange={(e) => setCurrentScrap({ ...currentScrap, description: e.target.value })}
              multiline
              rows={2}
              placeholder="Optional description"
              helperText="Additional details about this scrap master"
            />

            <Box>
              <Typography variant="subtitle2" fontWeight={600} gutterBottom sx={{ mb: 1 }}>
                Items
              </Typography>
              <Autocomplete
                options={items.filter(item => !selectedItems.find(si => si.id === item.id))}
                getOptionLabel={(option) => `${option.code} - ${option.name}`}
                onChange={(_event, newValue) => {
                  if (newValue) {
                    setSelectedItems([...selectedItems, newValue]);
                  }
                }}
                loading={itemsLoading}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Add Item"
                    placeholder="Search and select items..."
                    helperText="Select items that belong to this scrap master"
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {itemsLoading ? <CircularProgress color="inherit" size={20} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />

              {selectedItems.length > 0 && (
                <Paper
                  variant="outlined"
                  sx={{
                    mt: 2,
                    maxHeight: 300,
                    overflow: 'auto',
                  }}
                >
                  <List dense>
                    {selectedItems.map((item) => (
                      <ListItem
                        key={item.id}
                        sx={{
                          borderBottom: `1px solid ${theme.palette.divider}`,
                          '&:last-child': {
                            borderBottom: 'none',
                          },
                        }}
                      >
                        <ListItemText
                          primary={
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Chip
                                label={item.code}
                                size="small"
                                color="primary"
                                variant="outlined"
                                sx={{ fontWeight: 600 }}
                              />
                              <Typography variant="body2">{item.name}</Typography>
                            </Box>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            size="small"
                            onClick={() => handleRemoveItem(item.id)}
                            sx={{
                              color: 'error.main',
                              '&:hover': {
                                bgcolor: alpha(theme.palette.error.main, 0.1),
                              },
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </Paper>
              )}

              {selectedItems.length === 0 && (
                <Alert severity="info" sx={{ mt: 2 }}>
                  No items added yet. Please add at least one item.
                </Alert>
              )}
            </Box>
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
        title="Delete Scrap Master"
        message={`Are you sure you want to delete "${scrapToDelete?.name}"? This action cannot be undone.`}
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
