'use client';

import React, { useState } from 'react';
import {
  Box,
  Stepper,
  Step,
  StepLabel,
  Button,
  Paper,
  Typography,
  Alert,
  CircularProgress,
  alpha,
  useTheme,
} from '@mui/material';
import { ArrowBack, ArrowForward, Save, Close } from '@mui/icons-material';
import { OutgoingDocumentHeader } from './OutgoingDocumentHeader';
import { OutgoingDocumentItemsTable } from './OutgoingDocumentItemsTable';
import { useToast } from '@/app/components/ToastProvider';
import { formatQty, formatAmount } from '@/lib/utils/format';
import dayjs, { Dayjs } from 'dayjs';

const steps = ['Document Information', 'Items Details', 'Review & Submit'];

export interface OutgoingHeaderData {
  docCode: string;
  registerNumber: string;
  registerDate: Dayjs | null;
  docNumber: string;
  docDate: Dayjs | null;
  recipientId: string;
  recipientCode: string;
  recipientName: string;
  currencyId: string;
  currencyCode: string;
  companyCode: string;
  remarks: string;
}

export interface OutgoingItemData {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  uomId: string;
  uomCode: string;
  quantity: number;
  amount: number;
  productionBatchIds?: string[];
  remarks: string;
}

interface OutgoingDocumentFormProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function OutgoingDocumentForm({ onClose, onSuccess }: OutgoingDocumentFormProps) {
  const theme = useTheme();
  const toast = useToast();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const [headerData, setHeaderData] = useState<OutgoingHeaderData>({
    docCode: '',
    registerNumber: '',
    registerDate: dayjs(),
    docNumber: '',
    docDate: dayjs(),
    recipientId: '',
    recipientCode: '',
    recipientName: '',
    currencyId: '',
    currencyCode: '',
    companyCode: 'DEFAULT',
    remarks: '',
  });

  const [itemsData, setItemsData] = useState<OutgoingItemData[]>([]);

  const handleNext = () => {
    setValidationError(null);

    if (activeStep === 0) {
      const errors = validateHeaderStep();
      if (errors) {
        setValidationError(errors);
        return;
      }
    } else if (activeStep === 1) {
      const errors = validateItemsStep();
      if (errors) {
        setValidationError(errors);
        return;
      }
    }

    setActiveStep((prevActiveStep) => prevActiveStep + 1);
  };

  const handleBack = () => {
    setValidationError(null);
    setActiveStep((prevActiveStep) => prevActiveStep - 1);
  };

  const validateHeaderStep = (): string | null => {
    if (!headerData.docCode.trim()) {
      return 'Document code is required';
    }
    if (!headerData.registerNumber.trim()) {
      return 'Register number is required';
    }
    if (!headerData.registerDate) {
      return 'Register date is required';
    }
    if (!headerData.docNumber.trim()) {
      return 'Document number is required';
    }
    if (!headerData.docDate) {
      return 'Document date is required';
    }
    if (!headerData.recipientId) {
      return 'Recipient is required';
    }
    if (!headerData.currencyId) {
      return 'Currency is required';
    }

    if (headerData.registerDate.isAfter(dayjs())) {
      return 'Register date cannot be in the future';
    }
    if (headerData.docDate.isAfter(dayjs())) {
      return 'Document date cannot be in the future';
    }

    return null;
  };

  const validateItemsStep = (): string | null => {
    if (itemsData.length === 0) {
      return 'At least one item is required';
    }

    for (let i = 0; i < itemsData.length; i++) {
      const item = itemsData[i];
      if (!item.itemId) {
        return `Item ${i + 1}: Item is required`;
      }
      if (!item.uomId) {
        return `Item ${i + 1}: UOM is required`;
      }
      if (item.quantity <= 0) {
        return `Item ${i + 1}: Quantity must be greater than 0`;
      }
      if (item.amount <= 0) {
        return `Item ${i + 1}: Amount must be greater than 0`;
      }

      if (item.itemType === 'FINISH_GOOD' && (!item.productionBatchIds || item.productionBatchIds.length === 0)) {
        return `Item ${i + 1}: Production batch is required for finished goods`;
      }
    }

    return null;
  };

  const handleSubmit = async () => {
    setLoading(true);
    setValidationError(null);

    try {
      const requestBody = {
        header: {
          docCode: headerData.docCode,
          registerNumber: headerData.registerNumber,
          registerDate: headerData.registerDate?.toISOString(),
          docNumber: headerData.docNumber,
          docDate: headerData.docDate?.toISOString(),
          recipientId: headerData.recipientId,
          currencyId: headerData.currencyId,
          companyCode: headerData.companyCode,
          remarks: headerData.remarks || null,
        },
        details: itemsData.map((item) => ({
          itemId: item.itemId,
          uomId: item.uomId,
          quantity: item.quantity,
          amount: item.amount,
          productionBatchIds: item.productionBatchIds || [],
          remarks: item.remarks || null,
        })),
      };

      const response = await fetch('/api/wms/outgoing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.message || 'Failed to create outgoing document');
      }

      const result = await response.json();
      toast.success(`Outgoing document created successfully (${result.count} items)`);
      onSuccess();
    } catch (error) {
      console.error('Error creating outgoing document:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create outgoing document';
      toast.error(errorMessage);
      setValidationError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const renderStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <OutgoingDocumentHeader
            data={headerData}
            onChange={setHeaderData}
          />
        );
      case 1:
        return (
          <OutgoingDocumentItemsTable
            items={itemsData}
            currencyCode={headerData.currencyCode}
            onChange={setItemsData}
          />
        );
      case 2:
        return renderReviewStep();
      default:
        return null;
    }
  };

  const renderReviewStep = () => {
    return (
      <Box>
        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
          Document Information
        </Typography>
        <Paper sx={{ p: 3, mb: 3, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 2 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Document Code
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {headerData.docCode}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Register Number
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {headerData.registerNumber}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Register Date
              </Typography>
              <Typography variant="body1">
                {headerData.registerDate?.format('DD MMM YYYY')}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Document Number
              </Typography>
              <Typography variant="body1" fontWeight={600}>
                {headerData.docNumber}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Document Date
              </Typography>
              <Typography variant="body1">
                {headerData.docDate?.format('DD MMM YYYY')}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Recipient
              </Typography>
              <Typography variant="body1">
                {headerData.recipientCode} - {headerData.recipientName}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Currency
              </Typography>
              <Typography variant="body1">
                {headerData.currencyCode}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Company Code
              </Typography>
              <Typography variant="body1">
                {headerData.companyCode}
              </Typography>
            </Box>
            {headerData.remarks && (
              <Box sx={{ gridColumn: 'span 2' }}>
                <Typography variant="caption" color="text.secondary">
                  Remarks
                </Typography>
                <Typography variant="body1">
                  {headerData.remarks}
                </Typography>
              </Box>
            )}
          </Box>
        </Paper>

        <Typography variant="h6" gutterBottom sx={{ fontWeight: 600, color: 'primary.main' }}>
          Items Details ({itemsData.length})
        </Typography>
        <Paper sx={{ p: 3, bgcolor: alpha(theme.palette.primary.main, 0.04) }}>
          {itemsData.map((item, index) => (
            <Box
              key={item.id}
              sx={{
                mb: 2,
                pb: 2,
                borderBottom: index < itemsData.length - 1 ? `1px solid ${alpha(theme.palette.divider, 0.1)}` : 'none',
              }}
            >
              <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                {index + 1}. {item.itemCode} - {item.itemName}
              </Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1, mt: 1 }}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Quantity
                  </Typography>
                  <Typography variant="body2">
                    {formatQty(item.quantity)} {item.uomCode}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Amount
                  </Typography>
                  <Typography variant="body2">
                    {headerData.currencyCode} {formatAmount(item.amount)}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    Type
                  </Typography>
                  <Typography variant="body2">
                    {item.itemType}
                  </Typography>
                </Box>
              </Box>
              {item.productionBatchIds && item.productionBatchIds.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Production Batches
                  </Typography>
                  <Typography variant="body2">
                    {item.productionBatchIds.length} batch(es) selected
                  </Typography>
                </Box>
              )}
              {item.remarks && (
                <Box sx={{ mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    Remarks
                  </Typography>
                  <Typography variant="body2">
                    {item.remarks}
                  </Typography>
                </Box>
              )}
            </Box>
          ))}
        </Paper>

        <Alert severity="info" sx={{ mt: 3 }}>
          Please review all information carefully before submitting. Once submitted, this document will be processed and stock will be adjusted accordingly.
        </Alert>
      </Box>
    );
  };

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Stepper activeStep={activeStep}>
          {steps.map((label) => (
            <Step key={label}>
              <StepLabel>{label}</StepLabel>
            </Step>
          ))}
        </Stepper>
      </Box>

      {validationError && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setValidationError(null)}>
          {validationError}
        </Alert>
      )}

      <Box sx={{ minHeight: 400 }}>
        {renderStepContent(activeStep)}
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 3, mt: 3, borderTop: `1px solid ${theme.palette.divider}` }}>
        <Button
          onClick={onClose}
          startIcon={<Close />}
          disabled={loading}
          sx={{ textTransform: 'none' }}
        >
          Cancel
        </Button>

        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            disabled={activeStep === 0 || loading}
            onClick={handleBack}
            startIcon={<ArrowBack />}
            sx={{ textTransform: 'none' }}
          >
            Back
          </Button>

          {activeStep === steps.length - 1 ? (
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={20} /> : <Save />}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                px: 3,
              }}
            >
              {loading ? 'Submitting...' : 'Submit Document'}
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={handleNext}
              endIcon={<ArrowForward />}
              sx={{
                textTransform: 'none',
                borderRadius: 2,
                px: 3,
              }}
            >
              Next
            </Button>
          )}
        </Box>
      </Box>
    </Box>
  );
}
