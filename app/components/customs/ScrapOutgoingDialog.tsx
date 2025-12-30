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
  MenuItem,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { Save, Close, Info as InfoIcon, Warning as WarningIcon } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface FormData {
  date: Dayjs | null;
  scrapItemId: string;
  scrapCode: string;
  scrapName: string;
  recipientName: string;
  qty: number;
  currency: string;
  amount: number;
  remarks: string;
}

interface ScrapOutgoingDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => Promise<void>;
}

interface ScrapItem {
  id: string;
  scrapCode: string;
  scrapName: string;
  uom: string;
}

interface StockCheckResult {
  available: boolean;
  currentStock: number;
  requestedQty: number;
  shortfall?: number;
  message: string;
}

const CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];

export function ScrapOutgoingDialog({ open, onClose, onSubmit }: ScrapOutgoingDialogProps) {
  const theme = useTheme();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [scrapItems, setScrapItems] = useState<ScrapItem[]>([]);
  const [loadingScrapItems, setLoadingScrapItems] = useState(false);
  const [stockCheckLoading, setStockCheckLoading] = useState(false);
  const [stockCheckResult, setStockCheckResult] = useState<StockCheckResult | null>(null);
  const [formData, setFormData] = useState<FormData>({
    date: dayjs(),
    scrapItemId: '',
    scrapCode: '',
    scrapName: '',
    recipientName: '',
    qty: 0,
    currency: 'USD',
    amount: 0,
    remarks: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      fetchScrapItems();
      setErrors({});
      setStockCheckResult(null);
    }
  }, [open]);

  /**
   * Trigger stock check when qty or date changes
   * Add delay to avoid too many requests while user is typing
   */
  useEffect(() => {
    const timer = setTimeout(() => {
      checkStockAvailability();
    }, 500); // 500ms delay after user stops typing

    return () => clearTimeout(timer);
  }, [formData.qty, formData.date?.format('YYYY-MM-DD'), formData.scrapCode]);

  const fetchScrapItems = async () => {
    setLoadingScrapItems(true);
    try {
      const response = await fetch('/api/master/scrap-items');
      if (response.ok) {
        const data = await response.json();
        setScrapItems(data);
      }
    } catch (error) {
      console.error('Error fetching scrap items:', error);
    } finally {
      setLoadingScrapItems(false);
    }
  };

  /**
   * Pre-check stock availability when qty or date changes
   */
  const checkStockAvailability = async () => {
    // Only check if we have required data
    if (!formData.scrapCode || !formData.qty || !formData.date) {
      setStockCheckResult(null);
      return;
    }

    setStockCheckLoading(true);
    try {
      // Format date correctly: use local date components to avoid timezone issues
      const dateObj = formData.date.toDate(); // Convert dayjs to JS Date
      const year = dateObj.getFullYear();
      const month = String(dateObj.getMonth() + 1).padStart(2, '0');
      const day = String(dateObj.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;

      const selectedDateFormatted = formData.date.format('YYYY-MM-DD');

      console.log('[Stock Check] Sending request:', {
        itemCode: formData.scrapCode,
        itemType: 'SCRAP',
        qtyRequested: formData.qty,
        dateStr: dateStr,
        selectedDateFormatted: selectedDateFormatted,
      });

      const response = await fetch('/api/customs/stock/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            {
              itemCode: formData.scrapCode,
              itemType: 'SCRAP',
              qtyRequested: formData.qty,
            }
          ],
          date: dateStr,
        }),
      });

      if (response.ok) {
        const result = await response.json();
        // Extract single item result from batch response
        const itemResult = result.results[0];
        setStockCheckResult({
          available: itemResult.available,
          currentStock: itemResult.currentStock,
          requestedQty: itemResult.qtyRequested,
          shortfall: itemResult.shortfall,
          message: itemResult.available 
            ? `Stock available: ${itemResult.currentStock} units`
            : `Stock tidak cukup. Tersedia: ${itemResult.currentStock}, Diminta: ${itemResult.qtyRequested}, Kurang: ${itemResult.shortfall}`,
        });
        
        console.log('[Stock Check] Result:', itemResult);
        
        // Show warning toast if stock not available
        if (!itemResult.available) {
          console.warn('[Stock Check] Insufficient stock:', itemResult.message);
        }
      } else {
        console.error('[Stock Check] API returned error:', response.status);
        setStockCheckResult(null);
      }
    } catch (error) {
      console.error('[Stock Check] Error:', error);
      setStockCheckResult(null);
    } finally {
      setStockCheckLoading(false);
    }
  };

  const handleScrapItemSelect = (scrapItem: ScrapItem | null) => {
    if (scrapItem) {
      setFormData((prev) => ({
        ...prev,
        scrapItemId: scrapItem.id,
        scrapCode: scrapItem.scrapCode,
        scrapName: scrapItem.scrapName,
      }));
      setErrors((prev) => ({ ...prev, scrapItemId: '' }));
    } else {
      setFormData((prev) => ({
        ...prev,
        scrapItemId: '',
        scrapCode: '',
        scrapName: '',
      }));
    }
  };

  const handleNumberChange = (field: keyof FormData, value: string) => {
    const numValue = value === '' ? 0 : parseFloat(value);
    if (!isNaN(numValue)) {
      setFormData((prev) => ({
        ...prev,
        [field]: numValue,
      }));
      setErrors((prev) => ({ ...prev, [field]: '' }));
    }
  };

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.date) {
      newErrors.date = 'Date is required';
    } else if (formData.date.isAfter(dayjs(), 'day')) {
      newErrors.date = 'Date cannot be in the future';
    }

    if (!formData.scrapItemId) {
      newErrors.scrapItemId = 'Scrap item is required';
    }

    if (!formData.recipientName.trim()) {
      newErrors.recipientName = 'Recipient name is required';
    }

    if (!formData.qty || formData.qty <= 0) {
      newErrors.qty = 'Quantity must be greater than 0';
    }

    if (!formData.currency) {
      newErrors.currency = 'Currency is required';
    }

    if (formData.amount < 0) {
      newErrors.amount = 'Amount must be non-negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    try {
      await onSubmit(formData);
      setFormData({
        date: dayjs(),
        scrapItemId: '',
        scrapCode: '',
        scrapName: '',
        recipientName: '',
        qty: 0,
        currency: 'USD',
        amount: 0,
        remarks: '',
      });
      setErrors({});
      onClose();
    } catch (error) {
      console.error('Error submitting form:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setFormData({
      date: dayjs(),
      scrapItemId: '',
      scrapCode: '',
      scrapName: '',
      recipientName: '',
      qty: 0,
      currency: 'USD',
      amount: 0,
      remarks: '',
    });
    setErrors({});
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
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
          bgcolor: alpha(theme.palette.warning.main, 0.08),
          borderBottom: `1px solid ${alpha(theme.palette.warning.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography component="div" fontWeight="bold" color="warning.main" sx={{ fontSize: '1.25rem' }}>
            Add Outgoing Scrap
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Record outgoing scrap transaction
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 3 }}>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Stack spacing={3}>
            <DatePicker
              label="Date"
              value={formData.date}
              onChange={(newValue) => {
                console.log('[DatePicker] Date changed:', {
                  newValue: newValue?.format('YYYY-MM-DD'),
                  newValueISO: newValue?.toISOString(),
                });
                setFormData((prev) => ({ ...prev, date: newValue }));
                setErrors((prev) => ({ ...prev, date: '' }));
              }}
              maxDate={dayjs()}
              slotProps={{
                textField: {
                  fullWidth: true,
                  required: true,
                  error: !!errors.date,
                  helperText: errors.date,
                },
              }}
            />

            <Autocomplete
              options={scrapItems}
              loading={loadingScrapItems}
              getOptionLabel={(option) => `${option.scrapCode} - ${option.scrapName}`}
              onChange={(_event, newValue) => handleScrapItemSelect(newValue)}
              value={scrapItems.find((item) => item.id === formData.scrapItemId) || null}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Scrap Item"
                  placeholder="Search scrap item..."
                  required
                  error={!!errors.scrapItemId}
                  helperText={errors.scrapItemId}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {loadingScrapItems ? <CircularProgress color="inherit" size={20} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                />
              )}
            />

            <TextField
              fullWidth
              label="Recipient Name"
              value={formData.recipientName}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, recipientName: e.target.value }));
                setErrors((prev) => ({ ...prev, recipientName: '' }));
              }}
              required
              error={!!errors.recipientName}
              helperText={errors.recipientName || 'Enter the name of the recipient'}
            />

            <TextField
              fullWidth
              label="Quantity"
              type="number"
              value={formData.qty || ''}
              onChange={(e) => handleNumberChange('qty', e.target.value)}
              inputProps={{ min: 0.01, step: 0.01 }}
              required
              error={!!errors.qty}
              helperText={errors.qty || 'Enter quantity (must be greater than 0)'}
            />

            {/* Stock Check Result Display */}
            {stockCheckLoading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">
                  Checking stock...
                </Typography>
              </Box>
            )}

            {stockCheckResult && !stockCheckLoading && (
              <Box
                sx={{
                  p: 2,
                  borderRadius: 1,
                  border: `1px solid ${stockCheckResult.available ? alpha(theme.palette.success.main, 0.3) : alpha(theme.palette.error.main, 0.3)}`,
                  bgcolor: stockCheckResult.available ? alpha(theme.palette.success.main, 0.08) : alpha(theme.palette.error.main, 0.08),
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                  {stockCheckResult.available ? (
                    <InfoIcon sx={{ color: 'success.main', mt: 0.5, flexShrink: 0 }} />
                  ) : (
                    <WarningIcon sx={{ color: 'error.main', mt: 0.5, flexShrink: 0 }} />
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography
                      variant="subtitle2"
                      fontWeight="bold"
                      color={stockCheckResult.available ? 'success.main' : 'error.main'}
                      gutterBottom
                    >
                      {stockCheckResult.available ? 'Stock Available' : 'Stock Insufficient'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {stockCheckResult.message}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Date: {formData.date?.format('DD/MM/YYYY') || '-'}
                    </Typography>
                  </Box>
                </Box>
              </Box>
            )}

            <TextField
              fullWidth
              select
              label="Currency"
              value={formData.currency}
              onChange={(e) => {
                setFormData((prev) => ({ ...prev, currency: e.target.value }));
                setErrors((prev) => ({ ...prev, currency: '' }));
              }}
              required
              error={!!errors.currency}
              helperText={errors.currency}
            >
              {CURRENCIES.map((currency) => (
                <MenuItem key={currency} value={currency}>
                  {currency}
                </MenuItem>
              ))}
            </TextField>

            <TextField
              fullWidth
              label="Amount"
              type="number"
              value={formData.amount || ''}
              onChange={(e) => handleNumberChange('amount', e.target.value)}
              inputProps={{ min: 0, step: 0.01 }}
              required
              error={!!errors.amount}
              helperText={errors.amount || 'Enter transaction amount'}
            />

            <TextField
              fullWidth
              label="Remarks"
              multiline
              rows={3}
              value={formData.remarks}
              onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
              placeholder="Enter any additional notes (optional)"
            />

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
                This transaction will be recorded as outgoing scrap and will reduce the stock balance.
              </Typography>
            </Box>
          </Stack>
        </LocalizationProvider>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={handleClose}
          startIcon={<Close />}
          disabled={loading}
          sx={{ textTransform: 'none' }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          color="warning"
          startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <Save />}
          disabled={loading}
          sx={{
            textTransform: 'none',
            borderRadius: 2,
            px: 3,
          }}
        >
          {loading ? 'Saving...' : 'Save Entry'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
