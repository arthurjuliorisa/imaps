'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  IconButton,
  Button,
  TextField,
  Autocomplete,
  CircularProgress,
  Typography,
  Paper,
  Chip,
  alpha,
  useTheme,
  Tooltip,
  Alert,
} from '@mui/material';
import {
  Add,
  Delete,
  Inventory,
  Warning,
  CheckCircle,
} from '@mui/icons-material';
import { OutgoingItemData } from './OutgoingDocumentForm';
import { ProductionBatchSelector } from './ProductionBatchSelector';

interface Item {
  id: string;
  code: string;
  name: string;
  type: string;
  uom?: {
    id: string;
    code: string;
    name: string;
  };
}

interface StockInfo {
  itemId: string;
  availableQuantity: number;
  uom: string;
}

interface OutgoingDocumentItemsTableProps {
  items: OutgoingItemData[];
  currencyCode: string;
  onChange: (items: OutgoingItemData[]) => void;
}

export function OutgoingDocumentItemsTable({
  items,
  currencyCode,
  onChange,
}: OutgoingDocumentItemsTableProps) {
  const theme = useTheme();
  const [allItems, setAllItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [stockInfo, setStockInfo] = useState<Map<string, StockInfo>>(new Map());
  const [batchSelectorOpen, setBatchSelectorOpen] = useState(false);
  const [selectedItemForBatch, setSelectedItemForBatch] = useState<OutgoingItemData | null>(null);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    setLoadingItems(true);
    try {
      const response = await fetch('/api/master/item');
      if (response.ok) {
        const data = await response.json();
        setAllItems(data);
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const fetchStockInfo = async (itemId: string) => {
    try {
      const response = await fetch(`/api/wms/stock?itemId=${itemId}`);
      if (response.ok) {
        const data = await response.json();
        setStockInfo((prev) => new Map(prev).set(itemId, data));
      }
    } catch (error) {
      console.error('Error fetching stock info:', error);
    }
  };

  const handleAddRow = () => {
    const newItem: OutgoingItemData = {
      id: `temp-${Date.now()}-${Math.random()}`,
      itemId: '',
      itemCode: '',
      itemName: '',
      itemType: '',
      uomId: '',
      uomCode: '',
      quantity: 0,
      amount: 0,
      productionBatchIds: [],
      remarks: '',
    };
    onChange([...items, newItem]);
  };

  const handleRemoveRow = (id: string) => {
    onChange(items.filter((item) => item.id !== id));
  };

  const handleItemSelect = (index: number, item: Item | null) => {
    const updatedItems = [...items];
    if (item) {
      updatedItems[index] = {
        ...updatedItems[index],
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        itemType: item.type,
        uomId: item.uom?.id || '',
        uomCode: item.uom?.code || '',
      };
      fetchStockInfo(item.id);
    } else {
      updatedItems[index] = {
        ...updatedItems[index],
        itemId: '',
        itemCode: '',
        itemName: '',
        itemType: '',
        uomId: '',
        uomCode: '',
      };
    }
    onChange(updatedItems);
  };

  const handleFieldChange = (index: number, field: keyof OutgoingItemData, value: any) => {
    const updatedItems = [...items];
    updatedItems[index] = {
      ...updatedItems[index],
      [field]: value,
    };
    onChange(updatedItems);
  };

  const handleOpenBatchSelector = (item: OutgoingItemData) => {
    setSelectedItemForBatch(item);
    setBatchSelectorOpen(true);
  };

  const handleBatchSelectionConfirm = (batchIds: string[]) => {
    if (selectedItemForBatch) {
      const index = items.findIndex((i) => i.id === selectedItemForBatch.id);
      if (index !== -1) {
        handleFieldChange(index, 'productionBatchIds', batchIds);
      }
    }
  };

  const getStockAvailability = (itemId: string, quantity: number) => {
    const stock = stockInfo.get(itemId);
    if (!stock) return null;

    const isAvailable = stock.availableQuantity >= quantity;
    return {
      available: stock.availableQuantity,
      isAvailable,
      uom: stock.uom,
    };
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, color: 'primary.main' }}>
          Items Details
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleAddRow}
          sx={{
            textTransform: 'none',
            borderRadius: 2,
          }}
        >
          Add Item
        </Button>
      </Box>

      {items.length === 0 ? (
        <Paper
          sx={{
            p: 8,
            textAlign: 'center',
            bgcolor: alpha(theme.palette.background.default, 0.5),
          }}
        >
          <Typography variant="body1" color="text.secondary" gutterBottom>
            No items added yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Click "Add Item" button to start adding items to this document
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper}>
          <Table sx={{ minWidth: 650 }}>
            <TableHead>
              <TableRow sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
                <TableCell sx={{ fontWeight: 600, minWidth: 300 }}>Item</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Type</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>UOM</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Quantity</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Stock</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="right">Amount ({currencyCode})</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Production Batch</TableCell>
                <TableCell sx={{ fontWeight: 600 }}>Remarks</TableCell>
                <TableCell sx={{ fontWeight: 600 }} align="center">Action</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {items.map((item, index) => {
                const stockAvailability = item.itemId && item.quantity > 0
                  ? getStockAvailability(item.itemId, item.quantity)
                  : null;

                return (
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
                      <Autocomplete
                        size="small"
                        options={allItems}
                        loading={loadingItems}
                        getOptionLabel={(option) => `${option.code} - ${option.name}`}
                        onChange={(_event, newValue) => handleItemSelect(index, newValue)}
                        value={allItems.find((i) => i.id === item.itemId) || null}
                        renderInput={(params) => (
                          <TextField
                            {...params}
                            placeholder="Search item..."
                            error={!item.itemId && items.length > 0}
                            InputProps={{
                              ...params.InputProps,
                              endAdornment: (
                                <>
                                  {loadingItems ? <CircularProgress color="inherit" size={20} /> : null}
                                  {params.InputProps.endAdornment}
                                </>
                              ),
                            }}
                          />
                        )}
                        sx={{ minWidth: 300 }}
                      />
                    </TableCell>
                    <TableCell>
                      {item.itemType && (
                        <Chip
                          label={item.itemType}
                          size="small"
                          color={item.itemType === 'FINISH_GOOD' ? 'primary' : 'default'}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2">
                        {item.uomCode}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={item.quantity || ''}
                        onChange={(e) => handleFieldChange(index, 'quantity', parseFloat(e.target.value) || 0)}
                        inputProps={{ min: 0, step: 0.01 }}
                        error={item.quantity <= 0}
                        sx={{ width: 120 }}
                      />
                    </TableCell>
                    <TableCell>
                      {stockAvailability ? (
                        <Tooltip
                          title={`Available: ${stockAvailability.available.toLocaleString('id-ID')} ${stockAvailability.uom}`}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            {stockAvailability.isAvailable ? (
                              <CheckCircle color="success" fontSize="small" />
                            ) : (
                              <Warning color="warning" fontSize="small" />
                            )}
                            <Typography
                              variant="caption"
                              color={stockAvailability.isAvailable ? 'success.main' : 'warning.main'}
                            >
                              {stockAvailability.available.toLocaleString('id-ID')}
                            </Typography>
                          </Box>
                        </Tooltip>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          -
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        type="number"
                        value={item.amount || ''}
                        onChange={(e) => handleFieldChange(index, 'amount', parseFloat(e.target.value) || 0)}
                        inputProps={{ min: 0, step: 0.01 }}
                        error={item.amount <= 0}
                        sx={{ width: 120 }}
                      />
                    </TableCell>
                    <TableCell>
                      {item.itemType === 'FINISH_GOOD' ? (
                        <Box>
                          <Button
                            size="small"
                            variant={item.productionBatchIds && item.productionBatchIds.length > 0 ? 'contained' : 'outlined'}
                            startIcon={<Inventory />}
                            onClick={() => handleOpenBatchSelector(item)}
                            disabled={!item.itemId}
                            sx={{ textTransform: 'none' }}
                          >
                            {item.productionBatchIds && item.productionBatchIds.length > 0
                              ? `${item.productionBatchIds.length} Selected`
                              : 'Select Batch'}
                          </Button>
                          {item.itemId && (!item.productionBatchIds || item.productionBatchIds.length === 0) && (
                            <Typography variant="caption" color="error" display="block" sx={{ mt: 0.5 }}>
                              Required
                            </Typography>
                          )}
                        </Box>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          N/A
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <TextField
                        size="small"
                        value={item.remarks}
                        onChange={(e) => handleFieldChange(index, 'remarks', e.target.value)}
                        placeholder="Optional"
                        sx={{ width: 150 }}
                      />
                    </TableCell>
                    <TableCell align="center">
                      <IconButton
                        color="error"
                        onClick={() => handleRemoveRow(item.id)}
                        size="small"
                      >
                        <Delete />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {items.length > 0 && (
        <Alert severity="info" sx={{ mt: 2 }}>
          <Typography variant="body2" fontWeight={600} gutterBottom>
            Stock Availability Check
          </Typography>
          <Typography variant="body2">
            Green checkmark indicates sufficient stock. Yellow warning indicates insufficient stock for the requested quantity.
          </Typography>
        </Alert>
      )}

      {selectedItemForBatch && (
        <ProductionBatchSelector
          open={batchSelectorOpen}
          onClose={() => setBatchSelectorOpen(false)}
          itemId={selectedItemForBatch.itemId}
          itemCode={selectedItemForBatch.itemCode}
          itemName={selectedItemForBatch.itemName}
          selectedBatchIds={selectedItemForBatch.productionBatchIds || []}
          onConfirm={handleBatchSelectionConfirm}
          requiredQuantity={selectedItemForBatch.quantity}
        />
      )}
    </Box>
  );
}
