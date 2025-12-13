'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Autocomplete,
  CircularProgress,
  alpha,
  useTheme,
  Stack,
  Grid,
} from '@mui/material';
import { Save, Close } from '@mui/icons-material';
import { IncomingDocumentItem } from './IncomingDocumentForm';

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

interface Currency {
  id: string;
  code: string;
  name: string;
}

interface UOM {
  id: string;
  code: string;
  name: string;
}

interface IncomingDocumentItemDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (item: IncomingDocumentItem) => void;
  initialData?: IncomingDocumentItem | null;
  mode: 'add' | 'edit';
}

export function IncomingDocumentItemDialog({
  open,
  onClose,
  onSave,
  initialData = null,
  mode = 'add',
}: IncomingDocumentItemDialogProps) {
  const theme = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [currencies, setCurrencies] = useState<Currency[]>([]);
  const [uoms, setUoms] = useState<UOM[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [loadingCurrencies, setLoadingCurrencies] = useState(false);

  const [formData, setFormData] = useState<IncomingDocumentItem>({
    id: '',
    itemId: '',
    itemCode: '',
    itemName: '',
    itemType: '',
    uomId: '',
    uomCode: '',
    quantity: 0,
    currencyId: '',
    currencyCode: '',
    amount: 0,
  });

  // Reset form when dialog opens or initialData changes
  useEffect(() => {
    if (open) {
      const loadData = async () => {
        await Promise.all([fetchItems(), fetchCurrencies(), fetchUOMs()]);

        if (initialData && mode === 'edit') {
          setFormData(initialData);
        } else {
          setFormData({
            id: `temp-${Date.now()}`,
            itemId: '',
            itemCode: '',
            itemName: '',
            itemType: '',
            uomId: '',
            uomCode: '',
            quantity: 0,
            currencyId: '',
            currencyCode: '',
            amount: 0,
          });
        }
      };
      loadData();
    }
  }, [open, initialData, mode]);

  const fetchItems = async () => {
    setLoadingItems(true);
    try {
      const response = await fetch('/api/master/item');
      if (response.ok) {
        const data = await response.json();
        setItems(data);
      }
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const fetchCurrencies = async () => {
    setLoadingCurrencies(true);
    try {
      const response = await fetch('/api/master/currency');
      if (response.ok) {
        const data = await response.json();
        setCurrencies(data);
      }
    } catch (error) {
      console.error('Error fetching currencies:', error);
    } finally {
      setLoadingCurrencies(false);
    }
  };

  const fetchUOMs = async () => {
    try {
      const response = await fetch('/api/master/uom');
      if (response.ok) {
        const data = await response.json();
        setUoms(data);
      }
    } catch (error) {
      console.error('Error fetching UOMs:', error);
    }
  };

  const handleItemSelect = (item: Item | null) => {
    if (item) {
      setFormData((prev) => ({
        ...prev,
        itemId: item.id,
        itemCode: item.code,
        itemName: item.name,
        itemType: item.type,
        uomId: item.uom?.id || '',
        uomCode: item.uom?.code || '',
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        itemId: '',
        itemCode: '',
        itemName: '',
        itemType: '',
        uomId: '',
        uomCode: '',
      }));
    }
  };

  const handleCurrencySelect = (currency: Currency | null) => {
    if (currency) {
      setFormData((prev) => ({
        ...prev,
        currencyId: currency.id,
        currencyCode: currency.code,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        currencyId: '',
        currencyCode: '',
      }));
    }
  };

  const handleNumberChange = (field: 'quantity' | 'amount', value: string) => {
    if (value === '') {
      setFormData((prev) => ({
        ...prev,
        [field]: 0,
      }));
      return;
    }

    const numValue = parseFloat(value);
    if (!isNaN(numValue) && numValue >= 0) {
      setFormData((prev) => ({
        ...prev,
        [field]: numValue,
      }));
    }
  };

  const handleSave = () => {
    if (isFormValid()) {
      onSave(formData);
      onClose();
    }
  };

  const isFormValid = () => {
    return (
      formData.itemId !== '' &&
      formData.uomId !== '' &&
      formData.quantity > 0 &&
      formData.currencyId !== '' &&
      formData.amount > 0
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
        },
      }}
    >
      <DialogTitle
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography component="div" fontWeight="bold" color="primary" sx={{ fontSize: '1.25rem' }}>
            {mode === 'add' ? 'Add' : 'Edit'} Item
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {mode === 'add' ? 'Add' : 'Update'} item details for incoming document
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 3 }}>
        <Stack spacing={3}>
          {/* Item Selection */}
          <Autocomplete
            options={items}
            loading={loadingItems}
            getOptionLabel={(option) => `${option.code} - ${option.name}`}
            onChange={(_event, newValue) => handleItemSelect(newValue)}
            value={items.find((item) => item.id === formData.itemId) || null}
            groupBy={(option) => option.type}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Item"
                placeholder="Search item..."
                required
                InputProps={{
                  ...params.InputProps,
                  endAdornment: (
                    <>
                      {loadingItems ? <CircularProgress color="inherit" size={20} /> : null}
                      {params.InputProps.endAdornment}
                    </>
                  ),
                }}
                helperText="Select the item to add"
              />
            )}
          />

          {/* UOM - Auto-filled from selected item */}
          <Autocomplete
            options={uoms}
            value={uoms.find((u) => u.id === formData.uomId) || null}
            onChange={(_event, newValue) =>
              setFormData((prev) => ({
                ...prev,
                uomId: newValue?.id || '',
                uomCode: newValue?.code || '',
              }))
            }
            getOptionLabel={(option) => `${option.code} - ${option.name}`}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Unit of Measure (UOM)"
                required
                helperText="Auto-filled from selected item"
              />
            )}
            disabled={true}
          />

          <Grid container spacing={2}>
            {/* Quantity */}
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="Quantity"
                type="number"
                value={formData.quantity}
                onChange={(e) => handleNumberChange('quantity', e.target.value)}
                inputProps={{ min: 0.01, step: 0.01 }}
                required
                helperText="Enter the quantity (must be greater than 0)"
              />
            </Grid>

            {/* Currency */}
            <Grid size={{ xs: 12, md: 6 }}>
              <Autocomplete
                options={currencies}
                loading={loadingCurrencies}
                getOptionLabel={(option) => `${option.code} - ${option.name}`}
                onChange={(_event, newValue) => handleCurrencySelect(newValue)}
                value={currencies.find((c) => c.id === formData.currencyId) || null}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Currency"
                    placeholder="Select currency..."
                    required
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loadingCurrencies ? <CircularProgress color="inherit" size={20} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
              />
            </Grid>
          </Grid>

          {/* Amount */}
          <TextField
            fullWidth
            label="Amount"
            type="number"
            value={formData.amount}
            onChange={(e) => handleNumberChange('amount', e.target.value)}
            inputProps={{ min: 0.01, step: 0.01 }}
            required
            helperText="Enter the total amount (must be greater than 0)"
          />

          {/* Info Box */}
          <Box
            sx={{
              p: 2,
              bgcolor: alpha(theme.palette.info.main, 0.08),
              borderRadius: 1,
              border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
            }}
          >
            <Typography variant="subtitle2" fontWeight="bold" color="info.main" gutterBottom>
              Note
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Ensure the item information matches the customs document. The UOM is automatically set based on the selected item.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={onClose}
          startIcon={<Close />}
          sx={{ textTransform: 'none' }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSave}
          variant="contained"
          startIcon={<Save />}
          disabled={!isFormValid()}
          sx={{
            textTransform: 'none',
            borderRadius: 2,
            px: 3,
          }}
        >
          {mode === 'add' ? 'Add Item' : 'Update Item'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
