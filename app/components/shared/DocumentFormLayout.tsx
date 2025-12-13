'use client';

import React, { useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Button,
  Stack,
  Divider,
  Alert,
  Collapse,
} from '@mui/material';
import {
  Save as SaveIcon,
  Send as SendIcon,
  ArrowBack as ArrowBackIcon,
  Cancel as CancelIcon,
} from '@mui/icons-material';
import { ValidationResult } from '@/types/stock-calculation';

/**
 * Document Form Layout Props
 */
export interface DocumentFormLayoutProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;

  // Actions
  onSave?: () => void | Promise<void>;
  onSubmit?: () => void | Promise<void>;
  onCancel?: () => void;
  onBack?: () => void;

  // State
  isLoading?: boolean;
  isSaving?: boolean;
  isSubmitting?: boolean;

  // Validation
  validationResult?: ValidationResult;
  showValidation?: boolean;

  // Customization
  saveLabel?: string;
  submitLabel?: string;
  cancelLabel?: string;
  backLabel?: string;

  // Permissions
  canSave?: boolean;
  canSubmit?: boolean;
  canCancel?: boolean;

  // Layout
  maxWidth?: number | string;
  elevation?: number;
}

/**
 * DocumentFormLayout Component
 *
 * A reusable layout wrapper for document forms that provides:
 * - Consistent header with title and subtitle
 * - Form content area
 * - Action buttons (Save, Submit, Cancel, Back)
 * - Validation summary display
 * - Loading states
 * - Responsive design
 *
 * Usage:
 * ```tsx
 * <DocumentFormLayout
 *   title="Create BC23 - Import Declaration"
 *   subtitle="Enter import details and items"
 *   onSave={handleSave}
 *   onSubmit={handleSubmit}
 *   onCancel={handleCancel}
 *   validationResult={validation}
 * >
 *   <YourFormContent />
 * </DocumentFormLayout>
 * ```
 */
export default function DocumentFormLayout({
  title,
  subtitle,
  children,
  onSave,
  onSubmit,
  onCancel,
  onBack,
  isLoading = false,
  isSaving = false,
  isSubmitting = false,
  validationResult,
  showValidation = true,
  saveLabel = 'Save Draft',
  submitLabel = 'Submit',
  cancelLabel = 'Cancel',
  backLabel = 'Back',
  canSave = true,
  canSubmit = true,
  canCancel = true,
  maxWidth = 1400,
  elevation = 1,
}: DocumentFormLayoutProps) {
  const [showErrors, setShowErrors] = useState(false);
  const [showWarnings, setShowWarnings] = useState(true);

  // Check if there are validation errors or warnings
  const hasErrors =
    validationResult &&
    !validationResult.isValid &&
    Object.keys(validationResult.errors).length > 0;

  const hasWarnings =
    validationResult?.warnings &&
    Object.keys(validationResult.warnings).length > 0;

  // Handle save action
  const handleSave = useCallback(async () => {
    if (onSave && !isSaving && !isSubmitting) {
      await onSave();
    }
  }, [onSave, isSaving, isSubmitting]);

  // Handle submit action
  const handleSubmit = useCallback(async () => {
    setShowErrors(true);

    if (validationResult && !validationResult.isValid) {
      return;
    }

    if (onSubmit && !isSaving && !isSubmitting) {
      await onSubmit();
    }
  }, [onSubmit, validationResult, isSaving, isSubmitting]);

  // Handle cancel action
  const handleCancel = useCallback(() => {
    if (onCancel && !isSaving && !isSubmitting) {
      onCancel();
    }
  }, [onCancel, isSaving, isSubmitting]);

  // Handle back action
  const handleBack = useCallback(() => {
    if (onBack && !isSaving && !isSubmitting) {
      onBack();
    }
  }, [onBack, isSaving, isSubmitting]);

  const isProcessing = isSaving || isSubmitting || isLoading;

  return (
    <Box
      sx={{
        width: '100%',
        maxWidth,
        mx: 'auto',
        p: { xs: 2, sm: 3 },
      }}
    >
      <Paper
        elevation={elevation}
        sx={{
          overflow: 'hidden',
        }}
      >
        {/* Header Section */}
        <Box
          sx={{
            p: { xs: 2, sm: 3 },
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          <Stack direction="row" alignItems="center" spacing={2}>
            {onBack && (
              <Button
                startIcon={<ArrowBackIcon />}
                onClick={handleBack}
                disabled={isProcessing}
                sx={{
                  color: 'inherit',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.1)',
                  },
                }}
              >
                {backLabel}
              </Button>
            )}
            <Box flex={1}>
              <Typography variant="h5" component="h1" fontWeight={600}>
                {title}
              </Typography>
              {subtitle && (
                <Typography variant="body2" sx={{ mt: 0.5, opacity: 0.9 }}>
                  {subtitle}
                </Typography>
              )}
            </Box>
          </Stack>
        </Box>

        <Divider />

        {/* Validation Summary Section */}
        {showValidation && (hasErrors || hasWarnings) && (
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            {/* Errors */}
            {hasErrors && (
              <Collapse in={showErrors}>
                <Alert
                  severity="error"
                  onClose={() => setShowErrors(false)}
                  sx={{ mb: hasWarnings ? 2 : 0 }}
                >
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                    Please fix the following errors:
                  </Typography>
                  <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                    {Object.entries(validationResult.errors).map(
                      ([field, message]) => (
                        <li key={field}>
                          <Typography variant="body2">{message}</Typography>
                        </li>
                      )
                    )}
                  </Box>
                </Alert>
              </Collapse>
            )}

            {/* Warnings */}
            {hasWarnings && (
              <Collapse in={showWarnings}>
                <Alert
                  severity="warning"
                  onClose={() => setShowWarnings(false)}
                >
                  <Typography variant="subtitle2" fontWeight={600} gutterBottom>
                    Warning:
                  </Typography>
                  <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
                    {Object.entries(validationResult.warnings!).map(
                      ([field, message]) => (
                        <li key={field}>
                          <Typography variant="body2">{message}</Typography>
                        </li>
                      )
                    )}
                  </Box>
                </Alert>
              </Collapse>
            )}
          </Box>
        )}

        {/* Content Section */}
        <Box
          sx={{
            p: { xs: 2, sm: 3 },
            minHeight: 400,
          }}
        >
          {children}
        </Box>

        <Divider />

        {/* Action Buttons Section */}
        <Box
          sx={{
            p: { xs: 2, sm: 3 },
            bgcolor: 'grey.50',
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            gap: 2,
            justifyContent: 'space-between',
          }}
        >
          {/* Left side - Cancel button */}
          <Box>
            {canCancel && onCancel && (
              <Button
                variant="outlined"
                color="inherit"
                startIcon={<CancelIcon />}
                onClick={handleCancel}
                disabled={isProcessing}
                fullWidth={false}
                sx={{ minWidth: { xs: '100%', sm: 120 } }}
              >
                {cancelLabel}
              </Button>
            )}
          </Box>

          {/* Right side - Save and Submit buttons */}
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ width: { xs: '100%', sm: 'auto' } }}
          >
            {canSave && onSave && (
              <Button
                variant="outlined"
                color="primary"
                startIcon={<SaveIcon />}
                onClick={handleSave}
                disabled={isProcessing}
                sx={{ minWidth: { xs: '100%', sm: 140 } }}
              >
                {isSaving ? 'Saving...' : saveLabel}
              </Button>
            )}

            {canSubmit && onSubmit && (
              <Button
                variant="contained"
                color="primary"
                startIcon={<SendIcon />}
                onClick={handleSubmit}
                disabled={isProcessing || (hasErrors && showErrors)}
                sx={{ minWidth: { xs: '100%', sm: 140 } }}
              >
                {isSubmitting ? 'Submitting...' : submitLabel}
              </Button>
            )}
          </Stack>
        </Box>
      </Paper>
    </Box>
  );
}
