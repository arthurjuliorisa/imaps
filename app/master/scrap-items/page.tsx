'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Typography,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  CircularProgress,
  Stack,
  FormControlLabel,
  Switch,
  Tooltip,
  Alert,
} from '@mui/material';
import {
  Add as AddIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Visibility as ViewIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface ScrapComponent {
  id?: number;
  componentCode: string;
  componentName: string;
  componentType: string;
  uom: string;
  quantity: number;
  percentage?: number;
  remarks?: string;
}

interface ScrapItem {
  id: number;
  scrapCode: string;
  scrapName: string;
  scrapDescription?: string;
  uom: string;
  isActive: boolean;
  components: ScrapComponent[];
  createdAt: string;
  updatedAt: string;
}

interface FormData {
  scrapCode: string;
  scrapName: string;
  scrapDescription: string;
  uom: string;
  components: ScrapComponent[];
}

const initialFormData: FormData = {
  scrapCode: '',
  scrapName: '',
  scrapDescription: '',
  uom: 'KG',
  components: [],
};

const initialComponent: ScrapComponent = {
  componentCode: '',
  componentName: '',
  componentType: 'ROH',
  uom: 'KG',
  quantity: 0,
  percentage: undefined,
  remarks: '',
};

export default function ScrapMasterPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [scrapItems, setScrapItems] = useState<ScrapItem[]>([]);
  const [openDialog, setOpenDialog] = useState(false);
  const [openViewDialog, setOpenViewDialog] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ScrapItem | null>(null);
  const [formData, setFormData] = useState<FormData>(initialFormData);
  const [includeInactive, setIncludeInactive] = useState(false);

  const fetchScrapItems = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/master/scrap-items?includeInactive=${includeInactive}`);
      if (!response.ok) throw new Error('Failed to fetch scrap items');
      const data = await response.json();
      setScrapItems(data);
    } catch (error) {
      console.error('Error fetching scrap items:', error);
      toast.error('Failed to load scrap items');
    } finally {
      setLoading(false);
    }
  }, [includeInactive, toast]);

  useEffect(() => {
    fetchScrapItems();
  }, [fetchScrapItems]);

  const handleOpenDialog = (item?: ScrapItem) => {
    if (item) {
      setEditMode(true);
      setSelectedItem(item);
      setFormData({
        scrapCode: item.scrapCode,
        scrapName: item.scrapName,
        scrapDescription: item.scrapDescription || '',
        uom: item.uom,
        components: item.components,
      });
    } else {
      setEditMode(false);
      setSelectedItem(null);
      setFormData(initialFormData);
    }
    setOpenDialog(true);
  };

  const handleCloseDialog = () => {
    setOpenDialog(false);
    setEditMode(false);
    setSelectedItem(null);
    setFormData(initialFormData);
  };

  const handleViewItem = (item: ScrapItem) => {
    setSelectedItem(item);
    setOpenViewDialog(true);
  };

  const handleAddComponent = () => {
    setFormData({
      ...formData,
      components: [...formData.components, { ...initialComponent }],
    });
  };

  const handleUpdateComponent = (index: number, field: keyof ScrapComponent, value: any) => {
    const updatedComponents = [...formData.components];
    updatedComponents[index] = {
      ...updatedComponents[index],
      [field]: value,
    };
    setFormData({ ...formData, components: updatedComponents });
  };

  const handleRemoveComponent = (index: number) => {
    const updatedComponents = formData.components.filter((_, i) => i !== index);
    setFormData({ ...formData, components: updatedComponents });
  };

  const handleSubmit = async () => {
    // Validation
    if (!formData.scrapCode || !formData.scrapName || !formData.uom) {
      toast.error('Please fill in all required fields');
      return;
    }

    if (formData.components.length === 0) {
      toast.error('Please add at least one component');
      return;
    }

    // Validate all components
    for (const comp of formData.components) {
      if (!comp.componentCode || !comp.componentName || !comp.uom || comp.quantity <= 0) {
        toast.error('All component fields are required');
        return;
      }
    }

    setLoading(true);
    try {
      const url = editMode ? `/api/master/scrap-items/${selectedItem?.id}` : '/api/master/scrap-items';
      const method = editMode ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to save scrap item');
      }

      toast.success(editMode ? 'Scrap item updated successfully' : 'Scrap item created successfully');
      handleCloseDialog();
      fetchScrapItems();
    } catch (error: any) {
      console.error('Error saving scrap item:', error);
      toast.error(error.message || 'Failed to save scrap item');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this scrap item?')) return;

    setLoading(true);
    try {
      const response = await fetch(`/api/master/scrap-items/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete scrap item');

      toast.success('Scrap item deleted successfully');
      fetchScrapItems();
    } catch (error) {
      console.error('Error deleting scrap item:', error);
      toast.error('Failed to delete scrap item');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box sx={{ p: 3 }}>
      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
            <Box>
              <Typography variant="h5" fontWeight={600}>
                Scrap Master Management
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Manage composite scrap items and their components
              </Typography>
            </Box>
            <Stack direction="row" spacing={2}>
              <FormControlLabel
                control={
                  <Switch
                    checked={includeInactive}
                    onChange={(e) => setIncludeInactive(e.target.checked)}
                  />
                }
                label="Include Inactive"
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={() => handleOpenDialog()}
                disabled={loading}
              >
                Add New Scrap Item
              </Button>
            </Stack>
          </Box>

          {loading && scrapItems.length === 0 ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
              <CircularProgress />
            </Box>
          ) : (
            <TableContainer component={Paper} variant="outlined">
              <Table>
                <TableHead>
                  <TableRow sx={{ bgcolor: 'grey.100' }}>
                    <TableCell sx={{ fontWeight: 600 }}>Scrap Code</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Scrap Name</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>UOM</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Components</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>Status</TableCell>
                    <TableCell sx={{ fontWeight: 600 }} align="center">Actions</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {scrapItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} align="center" sx={{ py: 8 }}>
                        <Typography variant="body2" color="text.secondary">
                          No scrap items found. Click "Add New Scrap Item" to create one.
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    scrapItems.map((item) => (
                      <TableRow key={item.id} hover>
                        <TableCell>
                          <Typography variant="body2" fontWeight={600}>
                            {item.scrapCode}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2">{item.scrapName}</Typography>
                          {item.scrapDescription && (
                            <Typography variant="caption" color="text.secondary" display="block">
                              {item.scrapDescription}
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <Chip label={item.uom} size="small" />
                        </TableCell>
                        <TableCell>
                          <Chip label={`${item.components.length} components`} size="small" color="info" />
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={item.isActive ? 'Active' : 'Inactive'}
                            size="small"
                            color={item.isActive ? 'success' : 'default'}
                          />
                        </TableCell>
                        <TableCell align="center">
                          <Tooltip title="View Details">
                            <IconButton size="small" onClick={() => handleViewItem(item)} color="info">
                              <ViewIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Edit">
                            <IconButton size="small" onClick={() => handleOpenDialog(item)} color="primary">
                              <EditIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                          <Tooltip title="Delete">
                            <IconButton size="small" onClick={() => handleDelete(item.id)} color="error">
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={openDialog} onClose={handleCloseDialog} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {editMode ? 'Edit Scrap Item' : 'Create New Scrap Item'}
            <IconButton onClick={handleCloseDialog} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Stack spacing={3}>
            <Alert severity="info">
              A scrap item is a composite item made up of multiple components. Define the scrap code and its component breakdown below.
            </Alert>

            <Typography variant="subtitle2" fontWeight={600} sx={{ mt: 2 }}>
              Scrap Item Details
            </Typography>

            <Stack direction="row" spacing={2}>
              <TextField
                label="Scrap Code"
                value={formData.scrapCode}
                onChange={(e) => setFormData({ ...formData, scrapCode: e.target.value })}
                disabled={editMode}
                required
                fullWidth
              />
              <TextField
                label="Scrap Name"
                value={formData.scrapName}
                onChange={(e) => setFormData({ ...formData, scrapName: e.target.value })}
                required
                fullWidth
              />
            </Stack>

            <TextField
              label="Description"
              value={formData.scrapDescription}
              onChange={(e) => setFormData({ ...formData, scrapDescription: e.target.value })}
              multiline
              rows={2}
              fullWidth
            />

            <TextField
              label="UOM"
              value={formData.uom}
              onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
              required
              sx={{ width: 200 }}
            />

            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 3 }}>
              <Typography variant="subtitle2" fontWeight={600}>
                Components ({formData.components.length})
              </Typography>
              <Button
                variant="outlined"
                size="small"
                startIcon={<AddIcon />}
                onClick={handleAddComponent}
              >
                Add Component
              </Button>
            </Box>

            {formData.components.map((comp, index) => (
              <Paper key={index} sx={{ p: 2, bgcolor: 'grey.50' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
                  <Typography variant="subtitle2">Component #{index + 1}</Typography>
                  <IconButton size="small" onClick={() => handleRemoveComponent(index)} color="error">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
                <Stack spacing={2}>
                  <Stack direction="row" spacing={2}>
                    <TextField
                      label="Component Code"
                      value={comp.componentCode}
                      onChange={(e) => handleUpdateComponent(index, 'componentCode', e.target.value)}
                      required
                      size="small"
                      fullWidth
                    />
                    <TextField
                      label="Component Name"
                      value={comp.componentName}
                      onChange={(e) => handleUpdateComponent(index, 'componentName', e.target.value)}
                      required
                      size="small"
                      fullWidth
                    />
                  </Stack>
                  <Stack direction="row" spacing={2}>
                    <TextField
                      label="Component Type"
                      value={comp.componentType}
                      onChange={(e) => handleUpdateComponent(index, 'componentType', e.target.value)}
                      required
                      size="small"
                      sx={{ width: 150 }}
                    />
                    <TextField
                      label="UOM"
                      value={comp.uom}
                      onChange={(e) => handleUpdateComponent(index, 'uom', e.target.value)}
                      required
                      size="small"
                      sx={{ width: 100 }}
                    />
                    <TextField
                      label="Quantity"
                      type="number"
                      value={comp.quantity}
                      onChange={(e) => handleUpdateComponent(index, 'quantity', parseFloat(e.target.value) || 0)}
                      required
                      size="small"
                      sx={{ width: 150 }}
                      inputProps={{ step: 0.001 }}
                    />
                    <TextField
                      label="Percentage (%)"
                      type="number"
                      value={comp.percentage || ''}
                      onChange={(e) => handleUpdateComponent(index, 'percentage', parseFloat(e.target.value) || undefined)}
                      size="small"
                      sx={{ width: 150 }}
                      inputProps={{ min: 0, max: 100, step: 0.01 }}
                    />
                  </Stack>
                  <TextField
                    label="Remarks"
                    value={comp.remarks || ''}
                    onChange={(e) => handleUpdateComponent(index, 'remarks', e.target.value)}
                    size="small"
                    fullWidth
                  />
                </Stack>
              </Paper>
            ))}

            {formData.components.length === 0 && (
              <Alert severity="warning">
                No components added. Please add at least one component.
              </Alert>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleCloseDialog}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSubmit}
            disabled={loading || formData.components.length === 0}
          >
            {loading ? <CircularProgress size={24} /> : editMode ? 'Update' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={openViewDialog} onClose={() => setOpenViewDialog(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            Scrap Item Details
            <IconButton onClick={() => setOpenViewDialog(false)} size="small">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {selectedItem && (
            <Stack spacing={3}>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Scrap Code</Typography>
                <Typography variant="body1" fontWeight={600}>{selectedItem.scrapCode}</Typography>
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary">Scrap Name</Typography>
                <Typography variant="body1">{selectedItem.scrapName}</Typography>
              </Box>
              {selectedItem.scrapDescription && (
                <Box>
                  <Typography variant="subtitle2" color="text.secondary">Description</Typography>
                  <Typography variant="body2">{selectedItem.scrapDescription}</Typography>
                </Box>
              )}
              <Box>
                <Typography variant="subtitle2" color="text.secondary">UOM</Typography>
                <Chip label={selectedItem.uom} size="small" />
              </Box>
              <Box>
                <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2 }}>
                  Components ({selectedItem.components.length})
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: 'grey.100' }}>
                        <TableCell sx={{ fontWeight: 600 }}>Code</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Name</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>Quantity</TableCell>
                        <TableCell sx={{ fontWeight: 600 }}>%</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {selectedItem.components.map((comp, index) => (
                        <TableRow key={index}>
                          <TableCell>{comp.componentCode}</TableCell>
                          <TableCell>{comp.componentName}</TableCell>
                          <TableCell>
                            <Chip label={comp.componentType} size="small" />
                          </TableCell>
                          <TableCell>{comp.quantity} {comp.uom}</TableCell>
                          <TableCell>{comp.percentage ? `${comp.percentage}%` : '-'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenViewDialog(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
