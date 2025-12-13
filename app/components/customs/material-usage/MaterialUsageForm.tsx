'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import {
  Box,
  Container,
  Paper,
  Typography,
  Button,
  Stack,
  Alert,
  CircularProgress,
  Snackbar,
} from '@mui/material';
import { Save, Cancel } from '@mui/icons-material';
import { MaterialUsageFormData } from '@/types/material-usage';
import { MaterialUsageHeader } from './MaterialUsageHeader';
import { MaterialUsageItemsTable } from './MaterialUsageItemsTable';

export function MaterialUsageForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<MaterialUsageFormData>({
    defaultValues: {
      header: {
        usageDate: new Date(),
        workOrderNumber: '',
        remarks: '',
      },
      items: [],
    },
  });

  const onSubmit = async (data: MaterialUsageFormData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/wms/material-usage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          trxDate: data.header.usageDate.toISOString().split('T')[0],
          workOrderNumber: data.header.workOrderNumber,
          remarks: data.header.remarks || null,
          items: data.items.map((item) => ({
            itemCode: item.itemCode,
            itemName: item.itemName,
            itemTypeCode: item.itemType,
            uom: item.uom,
            qty: item.quantity,
            ppkekNumber: item.ppkekNumber,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit material usage');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/customs/material-usage');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/customs/material-usage');
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Paper elevation={0} sx={{ p: 3, mb: 3, bgcolor: 'primary.main', color: 'white' }}>
        <Typography variant="h4" fontWeight="bold" gutterBottom>
          New Material Usage
        </Typography>
        <Typography variant="body1">
          Record material consumption for work orders with PPKEK traceability
        </Typography>
      </Paper>

      <form onSubmit={handleSubmit(onSubmit)}>
        <Stack spacing={3}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <MaterialUsageHeader control={control} />
          <MaterialUsageItemsTable control={control} />

          <Paper elevation={2} sx={{ p: 3 }}>
            <Stack direction="row" spacing={2} justifyContent="flex-end">
              <Button
                variant="outlined"
                startIcon={<Cancel />}
                onClick={handleCancel}
                disabled={loading}
                sx={{ textTransform: 'none', minWidth: 120 }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="contained"
                startIcon={loading ? <CircularProgress size={20} /> : <Save />}
                disabled={loading}
                sx={{ textTransform: 'none', minWidth: 120 }}
              >
                {loading ? 'Submitting...' : 'Submit'}
              </Button>
            </Stack>
          </Paper>
        </Stack>
      </form>

      <Snackbar
        open={success}
        autoHideDuration={6000}
        onClose={() => setSuccess(false)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Material usage submitted successfully!
        </Alert>
      </Snackbar>
    </Container>
  );
}
