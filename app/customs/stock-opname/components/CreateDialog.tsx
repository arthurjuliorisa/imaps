'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  Box,
} from '@mui/material';
import { useToast } from '@/app/components/ToastProvider';
import { useRouter } from 'next/navigation';

interface CreateDialogProps {
  open: boolean;
  onClose: () => void;
}

export function CreateDialog({ open, onClose }: CreateDialogProps) {
  const toast = useToast();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const now = new Date();
  const nowDate = now.toISOString().split('T')[0];
  const nowTime = now.toTimeString().slice(0, 5);

  const [formData, setFormData] = useState({
    sto_date: nowDate,
    sto_time: nowTime,
    pic_name: '',
  });

  const [errors, setErrors] = useState({
    sto_date: '',
    sto_time: '',
  });

  const validateDateTime = () => {
    const newErrors = { sto_date: '', sto_time: '' };
    let isValid = true;

    // Compare dates without time component
    const selectedDateStr = formData.sto_date; // YYYY-MM-DD format
    const todayStr = nowDate; // YYYY-MM-DD format

    if (selectedDateStr > todayStr) {
      newErrors.sto_date = 'Cannot select future date';
      isValid = false;
    }

    // Only validate time if selected date is today
    if (selectedDateStr === todayStr) {
      const [hours, minutes] = formData.sto_time.split(':').map(Number);
      const [nowHours, nowMinutes] = nowTime.split(':').map(Number);

      const selectedTimeInMinutes = hours * 60 + minutes;
      const nowTimeInMinutes = nowHours * 60 + nowMinutes;

      if (selectedTimeInMinutes > nowTimeInMinutes) {
        newErrors.sto_time = 'Cannot select future time for today';
        isValid = false;
      }
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleSubmit = async () => {
    if (!validateDateTime()) {
      return;
    }

    setLoading(true);
    try {
      const stoDateTime = new Date(`${formData.sto_date}T${formData.sto_time}:00`);

      const response = await fetch('/api/customs/stock-opname', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sto_date: stoDateTime.toISOString(),
          pic_name: formData.pic_name.trim() || null,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to create stock opname');
      }

      const result = await response.json();
      toast.success('Stock opname registered successfully');
      onClose();
      router.push(`/customs/stock-opname/${result.id}`);
    } catch (error) {
      console.error('Error creating stock opname:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to create stock opname');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setFormData({
        sto_date: nowDate,
        sto_time: nowTime,
        pic_name: '',
      });
      setErrors({ sto_date: '', sto_time: '' });
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>Register Stock Opname</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ mt: 2 }}>
          <TextField
            label="STO Date"
            type="date"
            value={formData.sto_date}
            onChange={(e) => {
              setFormData({ ...formData, sto_date: e.target.value });
              setErrors({ ...errors, sto_date: '' });
            }}
            InputLabelProps={{ shrink: true }}
            error={!!errors.sto_date}
            helperText={errors.sto_date}
            required
            fullWidth
          />

          <TextField
            label="STO Time"
            type="time"
            value={formData.sto_time}
            onChange={(e) => {
              setFormData({ ...formData, sto_time: e.target.value });
              setErrors({ ...errors, sto_time: '' });
            }}
            InputLabelProps={{ shrink: true }}
            error={!!errors.sto_time}
            helperText={errors.sto_time}
            required
            fullWidth
          />

          <TextField
            label="PIC Name"
            value={formData.pic_name}
            onChange={(e) => setFormData({ ...formData, pic_name: e.target.value })}
            inputProps={{ maxLength: 100 }}
            helperText={`${formData.pic_name.length}/100 characters`}
            fullWidth
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} variant="contained" disabled={loading}>
          {loading ? 'Registering...' : 'Register'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
