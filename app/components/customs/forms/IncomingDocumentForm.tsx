'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Paper,
  Stepper,
  Step,
  StepLabel,
  Button,
  Typography,
  alpha,
  useTheme,
  Stack,
  CircularProgress,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { Save, NavigateNext, NavigateBefore, Description, Inventory, CheckCircle } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';
import { formatQty, formatAmount } from '@/lib/utils/format';
import { IncomingDocumentHeader } from './IncomingDocumentHeader';
import { IncomingDocumentItemsTable } from './IncomingDocumentItemsTable';

export interface IncomingDocumentHeaderData {
  docCode: string;
  registerNumber: string;
  registerDate: Date | null;
  docNumber: string;
  docDate: Date | null;
  shipperId: string;
  shipperName: string;
}

export interface IncomingDocumentItem {
  id: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  itemType: string;
  uomId: string;
  uomCode: string;
  quantity: number;
  currencyId: string;
  currencyCode: string;
  amount: number;
}

export interface IncomingDocumentFormData {
  header: IncomingDocumentHeaderData;
  items: IncomingDocumentItem[];
}

const steps = [
  { label: 'Document Header', icon: <Description /> },
  { label: 'Item Details', icon: <Inventory /> },
  { label: 'Review & Submit', icon: <CheckCircle /> },
];

const DRAFT_KEY = 'incomingDocumentDraft';

export function IncomingDocumentForm() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [activeStep, setActiveStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState<IncomingDocumentFormData>({
    header: {
      docCode: '',
      registerNumber: '',
      registerDate: null,
      docNumber: '',
      docDate: null,
      shipperId: '',
      shipperName: '',
    },
    items: [],
  });

  // Load draft from localStorage on mount
  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT_KEY);
      if (draft) {
        const parsedDraft = JSON.parse(draft);
        // Convert date strings back to Date objects
        if (parsedDraft.header.registerDate) {
          parsedDraft.header.registerDate = new Date(parsedDraft.header.registerDate);
        }
        if (parsedDraft.header.docDate) {
          parsedDraft.header.docDate = new Date(parsedDraft.header.docDate);
        }
        setFormData(parsedDraft);
        toast.info('Draft loaded from previous session');
      }
    } catch (error) {
      console.error('Error loading draft:', error);
    }
  }, [toast]);

  // Save draft to localStorage whenever formData changes
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(formData));
    } catch (error) {
      console.error('Error saving draft:', error);
    }
  }, [formData]);

  const handleHeaderChange = (headerData: IncomingDocumentHeaderData) => {
    setFormData((prev) => ({ ...prev, header: headerData }));
  };

  const handleItemsChange = (items: IncomingDocumentItem[]) => {
    setFormData((prev) => ({ ...prev, items }));
  };

  const handleNext = () => {
    // Validate current step before proceeding
    if (activeStep === 0 && !isHeaderValid()) {
      toast.error('Please fill in all required header fields');
      return;
    }
    if (activeStep === 1 && formData.items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }
    setActiveStep((prev) => prev + 1);
  };

  const handleBack = () => {
    setActiveStep((prev) => prev - 1);
  };

  const isHeaderValid = () => {
    const { docCode, registerNumber, registerDate, docNumber, docDate, shipperId } = formData.header;
    return (
      docCode.trim() !== '' &&
      registerNumber.trim() !== '' &&
      registerDate !== null &&
      docNumber.trim() !== '' &&
      docDate !== null &&
      shipperId !== ''
    );
  };

  const handleSubmit = async () => {
    if (!isHeaderValid()) {
      toast.error('Please fill in all required header fields');
      return;
    }

    if (formData.items.length === 0) {
      toast.error('Please add at least one item');
      return;
    }

    setLoading(true);
    try {
      // Submit each item as a separate document (as per API design)
      const promises = formData.items.map((item) =>
        fetch('/api/customs/incoming', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            docCode: formData.header.docCode,
            registerNumber: formData.header.registerNumber,
            registerDate: formData.header.registerDate?.toISOString(),
            docNumber: formData.header.docNumber,
            docDate: formData.header.docDate?.toISOString(),
            shipperId: formData.header.shipperId,
            itemId: item.itemId,
            uomId: item.uomId,
            quantity: item.quantity,
            currencyId: item.currencyId,
            amount: item.amount,
          }),
        })
      );

      const responses = await Promise.all(promises);

      // Check if all requests succeeded
      const allSuccessful = responses.every((res) => res.ok);
      if (!allSuccessful) {
        throw new Error('Some items failed to save');
      }

      toast.success(`Successfully created ${formData.items.length} incoming document(s)`);

      // Clear draft from localStorage
      localStorage.removeItem(DRAFT_KEY);

      // Redirect to incoming documents list
      router.push('/customs/incoming');
    } catch (error) {
      console.error('Error submitting form:', error);
      toast.error('Failed to create incoming documents. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const getStepContent = (step: number) => {
    switch (step) {
      case 0:
        return (
          <IncomingDocumentHeader
            data={formData.header}
            onChange={handleHeaderChange}
          />
        );
      case 1:
        return (
          <IncomingDocumentItemsTable
            items={formData.items}
            onChange={handleItemsChange}
          />
        );
      case 2:
        return (
          <Box>
            <Typography variant="h6" gutterBottom fontWeight={600} color="primary">
              Review Your Submission
            </Typography>
            <Stack spacing={3} sx={{ mt: 3 }}>
              {/* Header Summary */}
              <Paper
                elevation={0}
                sx={{
                  p: 3,
                  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  borderRadius: 2,
                }}
              >
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Document Information
                </Typography>
                <Stack spacing={1.5} sx={{ mt: 2 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Document Code:</Typography>
                    <Typography variant="body2" fontWeight={600}>{formData.header.docCode}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Register Number:</Typography>
                    <Typography variant="body2" fontWeight={600}>{formData.header.registerNumber}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Register Date:</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {formData.header.registerDate?.toLocaleDateString('en-US')}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Document Number:</Typography>
                    <Typography variant="body2" fontWeight={600}>{formData.header.docNumber}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Document Date:</Typography>
                    <Typography variant="body2" fontWeight={600}>
                      {formData.header.docDate?.toLocaleDateString('en-US')}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2" color="text.secondary">Shipper:</Typography>
                    <Typography variant="body2" fontWeight={600}>{formData.header.shipperName}</Typography>
                  </Box>
                </Stack>
              </Paper>

              {/* Items Summary */}
              <Paper
                elevation={0}
                sx={{
                  p: 3,
                  border: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
                  borderRadius: 2,
                }}
              >
                <Typography variant="subtitle1" fontWeight={600} gutterBottom>
                  Items Summary ({formData.items.length} item{formData.items.length !== 1 ? 's' : ''})
                </Typography>
                <Stack spacing={2} sx={{ mt: 2 }}>
                  {formData.items.map((item, index) => (
                    <Box
                      key={item.id}
                      sx={{
                        p: 2,
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                        borderRadius: 1,
                      }}
                    >
                      <Typography variant="body2" fontWeight={600} gutterBottom>
                        {index + 1}. {item.itemCode} - {item.itemName}
                      </Typography>
                      <Stack direction="row" spacing={3} sx={{ mt: 1 }}>
                        <Typography variant="caption" color="text.secondary">
                          Quantity: <strong>{formatQty(item.quantity)} {item.uomCode}</strong>
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Amount: <strong>{item.currencyCode} {formatAmount(item.amount)}</strong>
                        </Typography>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              </Paper>

              {/* Warning Box */}
              <Box
                sx={{
                  p: 2,
                  bgcolor: alpha(theme.palette.warning.main, 0.08),
                  border: `1px solid ${alpha(theme.palette.warning.main, 0.2)}`,
                  borderRadius: 1,
                }}
              >
                <Typography variant="body2" color="warning.dark">
                  <strong>Note:</strong> Please review all information carefully before submitting. This will create {formData.items.length} incoming document record(s).
                </Typography>
              </Box>
            </Stack>
          </Box>
        );
      default:
        return null;
    }
  };

  return (
    <Box sx={{ width: '100%' }}>
      <Paper elevation={0} sx={{ p: 3, borderRadius: 2 }}>
        <Stepper activeStep={activeStep} sx={{ mb: 4 }}>
          {steps.map((step, index) => (
            <Step key={step.label}>
              <StepLabel
                icon={step.icon}
                sx={{
                  '& .MuiStepIcon-root': {
                    fontSize: '2rem',
                  },
                }}
              >
                {step.label}
              </StepLabel>
            </Step>
          ))}
        </Stepper>

        <Box sx={{ mt: 4, mb: 4, minHeight: '400px' }}>
          {getStepContent(activeStep)}
        </Box>

        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            pt: 3,
            borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}`,
          }}
        >
          <Button
            onClick={handleBack}
            disabled={activeStep === 0 || loading}
            startIcon={<NavigateBefore />}
            sx={{ textTransform: 'none' }}
          >
            Back
          </Button>

          <Box sx={{ display: 'flex', gap: 2 }}>
            {activeStep === steps.length - 1 ? (
              <Button
                variant="contained"
                onClick={handleSubmit}
                disabled={loading}
                startIcon={loading ? <CircularProgress size={20} /> : <Save />}
                sx={{
                  textTransform: 'none',
                  px: 4,
                  borderRadius: 2,
                }}
              >
                {loading ? 'Submitting...' : 'Submit Documents'}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
                endIcon={<NavigateNext />}
                sx={{
                  textTransform: 'none',
                  px: 4,
                  borderRadius: 2,
                }}
              >
                Next
              </Button>
            )}
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
