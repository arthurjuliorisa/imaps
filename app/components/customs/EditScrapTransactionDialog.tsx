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
  CircularProgress,
  Stack,
  MenuItem,
  Alert,
} from '@mui/material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { Save, Close } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';
import type { ScrapTransaction } from '@/types/transaction';

interface FormData {
  date: Dayjs | null;
  qty: number;
  currency: string;
  amount: number;
  recipientName: string;
  remarks: string;
  ppkekNumber: string;
  registrationDate: Dayjs | null;
  documentType: string;
}

interface EditScrapTransactionDialogProps {
  open: boolean;
  transaction: ScrapTransaction | null;
  onClose: () => void;
  onSuccess: () => void;
}

const CURRENCIES = ['USD', 'IDR', 'CNY', 'EUR', 'JPY'];
const DOCUMENT_TYPES = ['', 'BC25', 'BC27', 'BC41'];

export function EditScrapTransactionDialog({
  open,
  transaction,
  onClose,
  onSuccess,
}: EditScrapTransactionDialogProps) {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    date: null,
    qty: 0,
    currency: 'USD',
    amount: 0,
    recipientName: '',
    remarks: '',
    ppkekNumber: '',
    registrationDate: null,
    documentType: '',
  });

  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>({});

  // Populate form when transaction changes
  useEffect(() => {
    if (transaction && open) {
      setFormData({
        date: transaction.docDate ? dayjs(transaction.docDate) : null,
        qty: transaction.transactionType === 'IN' ? transaction.inQty : transaction.outQty,
        currency: transaction.currency || 'USD',
        amount: transaction.valueAmount || 0,
        recipientName: transaction.recipientName || '',
        remarks: transaction.remarks || '',
        ppkekNumber: transaction.ppkekNumber || '',
        registrationDate: transaction.regDate ? dayjs(transaction.regDate) : null,
        documentType: transaction.docType || '',
      });
      setErrors({});
    }
  }, [transaction, open]);

  const validateForm = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {};

    if (!formData.date) {
      newErrors.date = 'Date is required';
    } else if (formData.date.startOf('day').isAfter(dayjs().startOf('day'))) {
      newErrors.date = 'Date cannot be in the future';
    }

    if (formData.qty <= 0) {
      newErrors.qty = 'Quantity must be greater than 0';
    }

    if (!formData.currency) {
      newErrors.currency = 'Currency is required';
    }

    if (formData.amount < 0) {
      newErrors.amount = 'Amount cannot be negative';
    }

    if (transaction?.transactionType === 'OUT' && !formData.recipientName.trim()) {
      newErrors.recipientName = 'Recipient name is required for outgoing transactions';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm() || !transaction) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/customs/scrap-transactions/${transaction.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          docDate: formData.date?.toISOString(),
          qty: formData.qty,
          currency: formData.currency,
          amount: formData.amount,
          recipientName: formData.recipientName,
          remarks: formData.remarks,
          ppkekNumber: formData.ppkekNumber,
          registrationDate: formData.registrationDate?.toISOString(),
          documentType: formData.documentType || null,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to update transaction');
      }

      toast.success('Transaction updated successfully');
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error updating transaction:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to update transaction');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      onClose();
    }
  };

  if (!transaction) {
    return null;
  }

  // Check if this is from outgoing_goods table
  const isOutgoingGoodsRecord = transaction.id.startsWith('OUTGOING_');

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
        <DialogTitle>
          Edit Scrap Transaction
        </DialogTitle>
        <DialogContent>
          {isOutgoingGoodsRecord && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              This transaction is from the outgoing goods record. Some fields cannot be edited here.
              Please edit from the Outgoing Goods page for full control.
            </Alert>
          )}

          <Stack spacing={2} sx={{ mt: 2 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                label="Transaction Type"
                value={transaction.transactionType}
                disabled
                fullWidth
              />
              <TextField
                label="Item Code"
                value={transaction.itemCode}
                disabled
                fullWidth
              />
            </Box>

            <TextField
              label="Item Name"
              value={transaction.itemName}
              disabled
              fullWidth
            />

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <DatePicker
                label="Transaction Date *"
                value={formData.date}
                onChange={(newValue) => setFormData({ ...formData, date: newValue })}
                disabled
                slotProps={{
                  textField: {
                    fullWidth: true,
                    error: !!errors.date,
                    helperText: errors.date || "Cannot be changed (part of record key)",
                    disabled: true,
                  },
                }}
              />
              <TextField
                label="Quantity *"
                type="number"
                value={formData.qty}
                onChange={(e) => setFormData({ ...formData, qty: parseFloat(e.target.value) || 0 })}
                error={!!errors.qty}
                helperText={errors.qty}
                disabled={loading}
                fullWidth
                InputProps={{ inputProps: { min: 0, step: 0.001 } }}
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                label="Currency *"
                select
                value={formData.currency}
                onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                error={!!errors.currency}
                helperText={errors.currency}
                disabled={loading}
                fullWidth
              >
                {CURRENCIES.map((currency) => (
                  <MenuItem key={currency} value={currency}>
                    {currency}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Amount *"
                type="number"
                value={formData.amount}
                onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                error={!!errors.amount}
                helperText={errors.amount}
                disabled={loading}
                fullWidth
                InputProps={{ inputProps: { min: 0, step: 0.01 } }}
              />
            </Box>

            {transaction.transactionType === 'OUT' && (
              <TextField
                label="Recipient Name *"
                value={formData.recipientName}
                onChange={(e) => setFormData({ ...formData, recipientName: e.target.value })}
                error={!!errors.recipientName}
                helperText={errors.recipientName}
                disabled={loading}
                fullWidth
              />
            )}

            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
              <TextField
                label="PPKEK Number"
                value={formData.ppkekNumber}
                onChange={(e) => setFormData({ ...formData, ppkekNumber: e.target.value })}
                disabled={loading}
                fullWidth
              />
              <TextField
                label="Document Type"
                select
                value={formData.documentType}
                onChange={(e) => setFormData({ ...formData, documentType: e.target.value })}
                disabled={loading}
                fullWidth
              >
                {DOCUMENT_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type || '(None)'}
                  </MenuItem>
                ))}
              </TextField>
            </Box>

            <DatePicker
              label="Registration Date"
              value={formData.registrationDate}
              onChange={(newValue) => setFormData({ ...formData, registrationDate: newValue })}
              slotProps={{
                textField: {
                  fullWidth: true,
                  disabled: loading,
                },
              }}
            />

            <TextField
              label="Remarks"
              value={formData.remarks}
              onChange={(e) => setFormData({ ...formData, remarks: e.target.value })}
              disabled={loading}
              multiline
              rows={3}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} disabled={loading} startIcon={<Close />}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={loading}
            startIcon={loading ? <CircularProgress size={20} /> : <Save />}
          >
            {loading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogActions>
      </Dialog>
    </LocalizationProvider>
  );
}
