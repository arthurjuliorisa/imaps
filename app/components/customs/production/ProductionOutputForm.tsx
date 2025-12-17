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
import { ProductionOutputFormData } from '@/types/production';
import { ProductionOutputHeader } from './ProductionOutputHeader';
import { ProductionOutputItemsTable } from './ProductionOutputItemsTable';

export function ProductionOutputForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const { control, handleSubmit, formState: { errors } } = useForm<ProductionOutputFormData>({
    defaultValues: {
      header: {
        transaction_date: new Date(),
        internal_evidence_number: '',
        reversal: '',
      },
      items: [],
    },
  });

  const onSubmit = async (data: ProductionOutputFormData) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/wms/production', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          transaction_date: data.header.transaction_date.toISOString().split('T')[0],
          internal_evidence_number: data.header.internal_evidence_number,
          reversal: data.header.reversal || null,
          items: data.items.map((item) => ({
            item_code: item.item_code,
            item_name: item.item_name,
            item_type: item.item_type,
            uom: item.uom,
            qty: item.qty,
            work_order_numbers: item.work_order_numbers,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to submit production output');
      }

      setSuccess(true);
      setTimeout(() => {
        router.push('/customs/production');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    router.push('/customs/production');
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Paper elevation={0} sx={{ p: 3, mb: 3, bgcolor: 'primary.main', color: 'white' }}>
        <Typography variant="h4" fontWeight="bold" gutterBottom>
          New Production Output
        </Typography>
        <Typography variant="body1">
          Record finished goods production with quality classification and work order linking
        </Typography>
      </Paper>

      <form onSubmit={handleSubmit(onSubmit)}>
        <Stack spacing={3}>
          {error && (
            <Alert severity="error" onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          <ProductionOutputHeader control={control} />
          <ProductionOutputItemsTable control={control} />

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
          Production output submitted successfully!
        </Alert>
      </Snackbar>
    </Container>
  );
}
