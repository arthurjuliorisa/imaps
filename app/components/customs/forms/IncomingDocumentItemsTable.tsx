'use client';

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Chip,
  alpha,
  useTheme,
  Stack,
} from '@mui/material';
import { Add, Edit, Delete } from '@mui/icons-material';
import { IncomingDocumentItem } from './IncomingDocumentForm';
import { IncomingDocumentItemDialog } from './IncomingDocumentItemDialog';
import { useToast } from '@/app/components/ToastProvider';

interface IncomingDocumentItemsTableProps {
  items: IncomingDocumentItem[];
  onChange: (items: IncomingDocumentItem[]) => void;
}

export function IncomingDocumentItemsTable({ items, onChange }: IncomingDocumentItemsTableProps) {
  const theme = useTheme();
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<IncomingDocumentItem | null>(null);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');

  const handleAddItem = () => {
    setDialogMode('add');
    setEditingItem(null);
    setDialogOpen(true);
  };

  const handleEditItem = (item: IncomingDocumentItem) => {
    setDialogMode('edit');
    setEditingItem(item);
    setDialogOpen(true);
  };

  const handleDeleteItem = (itemId: string) => {
    const updatedItems = items.filter((item) => item.id !== itemId);
    onChange(updatedItems);
    toast.success('Item removed successfully');
  };

  const handleSaveItem = (item: IncomingDocumentItem) => {
    if (dialogMode === 'add') {
      // Check for duplicate item
      const isDuplicate = items.some((existingItem) => existingItem.itemId === item.itemId);
      if (isDuplicate) {
        toast.warning('This item has already been added. Please select a different item or edit the existing one.');
        return;
      }
      onChange([...items, item]);
      toast.success('Item added successfully');
    } else {
      const updatedItems = items.map((existingItem) =>
        existingItem.id === item.id ? item : existingItem
      );
      onChange(updatedItems);
      toast.success('Item updated successfully');
    }
  };

  const getTotalAmount = () => {
    // Group by currency and sum amounts
    const totalsByCurrency: { [key: string]: number } = {};
    items.forEach((item) => {
      if (!totalsByCurrency[item.currencyCode]) {
        totalsByCurrency[item.currencyCode] = 0;
      }
      totalsByCurrency[item.currencyCode] += item.amount;
    });
    return totalsByCurrency;
  };

  const totals = getTotalAmount();

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h6" gutterBottom fontWeight={600} color="primary">
            Item Details
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Add items included in this incoming document
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleAddItem}
          sx={{
            textTransform: 'none',
            borderRadius: 2,
          }}
        >
          Add Item
        </Button>
      </Box>

      {items.length === 0 ? (
        <Box
          sx={{
            p: 6,
            textAlign: 'center',
            bgcolor: alpha(theme.palette.grey[500], 0.05),
            borderRadius: 2,
            border: `2px dashed ${alpha(theme.palette.grey[500], 0.3)}`,
          }}
        >
          <Typography variant="body1" color="text.secondary" gutterBottom>
            No items added yet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Click "Add Item" button to start adding items
          </Typography>
          <Button
            variant="outlined"
            startIcon={<Add />}
            onClick={handleAddItem}
            sx={{ textTransform: 'none' }}
          >
            Add First Item
          </Button>
        </Box>
      ) : (
        <>
          <TableContainer
            sx={{
              border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
              borderRadius: 2,
            }}
          >
            <Table>
              <TableHead>
                <TableRow
                  sx={{
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                  }}
                >
                  <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>UOM</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Quantity</TableCell>
                  <TableCell sx={{ fontWeight: 600 }}>Currency</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="right">Amount</TableCell>
                  <TableCell sx={{ fontWeight: 600 }} align="center">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow
                    key={item.id}
                    sx={{
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                      },
                    }}
                  >
                    <TableCell>{index + 1}</TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {item.itemCode}
                      </Typography>
                    </TableCell>
                    <TableCell>{item.itemName}</TableCell>
                    <TableCell>
                      <Chip
                        label={item.itemType}
                        size="small"
                        color={
                          item.itemType === 'RAW_MATERIAL'
                            ? 'primary'
                            : item.itemType === 'FINISH_GOOD'
                            ? 'success'
                            : 'secondary'
                        }
                        variant="outlined"
                      />
                    </TableCell>
                    <TableCell>
                      <Chip label={item.uomCode} size="small" />
                    </TableCell>
                    <TableCell align="right">
                      {item.quantity.toLocaleString('id-ID', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </TableCell>
                    <TableCell>{item.currencyCode}</TableCell>
                    <TableCell align="right">
                      <Typography variant="body2" fontWeight={600}>
                        {item.amount.toLocaleString('id-ID', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </Typography>
                    </TableCell>
                    <TableCell align="center">
                      <Stack direction="row" spacing={0.5} justifyContent="center">
                        <IconButton
                          size="small"
                          onClick={() => handleEditItem(item)}
                          sx={{
                            color: theme.palette.primary.main,
                            '&:hover': {
                              bgcolor: alpha(theme.palette.primary.main, 0.1),
                            },
                          }}
                        >
                          <Edit fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteItem(item.id)}
                          sx={{
                            color: theme.palette.error.main,
                            '&:hover': {
                              bgcolor: alpha(theme.palette.error.main, 0.1),
                            },
                          }}
                        >
                          <Delete fontSize="small" />
                        </IconButton>
                      </Stack>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Summary */}
          <Box
            sx={{
              mt: 3,
              p: 3,
              bgcolor: alpha(theme.palette.primary.main, 0.04),
              borderRadius: 2,
              border: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
            }}
          >
            <Typography variant="subtitle1" fontWeight={600} gutterBottom>
              Summary
            </Typography>
            <Stack direction="row" spacing={4} sx={{ mt: 2 }}>
              <Box>
                <Typography variant="body2" color="text.secondary">
                  Total Items
                </Typography>
                <Typography variant="h6" fontWeight={600} color="primary">
                  {items.length}
                </Typography>
              </Box>
              <Box>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  Total Amount
                </Typography>
                {Object.entries(totals).map(([currency, amount]) => (
                  <Typography key={currency} variant="body1" fontWeight={600}>
                    {currency} {amount.toLocaleString('id-ID', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </Typography>
                ))}
              </Box>
            </Stack>
          </Box>
        </>
      )}

      <IncomingDocumentItemDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onSave={handleSaveItem}
        initialData={editingItem}
        mode={dialogMode}
      />
    </Box>
  );
}
