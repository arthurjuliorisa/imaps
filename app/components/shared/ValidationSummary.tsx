'use client';

import React, { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Collapse,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Paper,
  Typography,
  Divider,
} from '@mui/material';
import {
  Error as ErrorIcon,
  Warning as WarningIcon,
  Info as InfoIcon,
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  Close as CloseIcon,
} from '@mui/icons-material';
import { ValidationResult } from '@/types/stock-calculation';

/**
 * Validation Summary Props
 */
export interface ValidationSummaryProps {
  validationResult: ValidationResult;
  show?: boolean;
  onClose?: () => void;
  elevation?: number;
  variant?: 'outlined' | 'elevation';
  collapsible?: boolean;
  defaultExpanded?: boolean;
  showErrorCount?: boolean;
  showWarningCount?: boolean;
}

/**
 * Validation Item Props
 */
interface ValidationItemProps {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * ValidationSummary Component
 *
 * A comprehensive validation summary component that displays:
 * - Validation errors with field names
 * - Warnings
 * - Information messages
 * - Collapsible sections
 * - Error/warning counts
 * - Dismissible alerts
 *
 * Usage:
 * ```tsx
 * <ValidationSummary
 *   validationResult={validation}
 *   show={showValidation}
 *   onClose={handleClose}
 *   collapsible
 * />
 * ```
 */
export default function ValidationSummary({
  validationResult,
  show = true,
  onClose,
  elevation = 1,
  variant = 'outlined',
  collapsible = false,
  defaultExpanded = true,
  showErrorCount = true,
  showWarningCount = true,
}: ValidationSummaryProps) {
  const [errorsExpanded, setErrorsExpanded] = useState(defaultExpanded);
  const [warningsExpanded, setWarningsExpanded] = useState(defaultExpanded);

  if (!show) return null;

  const errors = Object.entries(validationResult.errors || {});
  const warnings = Object.entries(validationResult.warnings || {});
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  if (!hasErrors && !hasWarnings) return null;

  return (
    <Box sx={{ width: '100%' }}>
      {/* Errors Section */}
      {hasErrors && (
        <Paper
          elevation={elevation}
          variant={variant}
          sx={{
            mb: hasWarnings ? 2 : 0,
            border: '1px solid',
            borderColor: 'error.main',
            bgcolor: 'error.lighter',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              p: 2,
              bgcolor: 'error.main',
              color: 'error.contrastText',
            }}
          >
            <ErrorIcon sx={{ mr: 1.5 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                Validation Errors
                {showErrorCount && ` (${errors.length})`}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                Please correct the following errors before proceeding
              </Typography>
            </Box>
            {collapsible && (
              <IconButton
                size="small"
                onClick={() => setErrorsExpanded(!errorsExpanded)}
                sx={{ color: 'inherit' }}
              >
                {errorsExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            )}
            {onClose && !collapsible && (
              <IconButton
                size="small"
                onClick={onClose}
                sx={{ color: 'inherit' }}
              >
                <CloseIcon />
              </IconButton>
            )}
          </Box>

          <Collapse in={collapsible ? errorsExpanded : true}>
            <List sx={{ py: 0 }}>
              {errors.map(([field, message], index) => (
                <React.Fragment key={field}>
                  {index > 0 && <Divider />}
                  <ListItem sx={{ py: 1.5, px: 2 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <ErrorIcon color="error" fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="body2" fontWeight={500}>
                          {formatFieldName(field)}
                        </Typography>
                      }
                      secondary={
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                        >
                          {message}
                        </Typography>
                      }
                    />
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          </Collapse>
        </Paper>
      )}

      {/* Warnings Section */}
      {hasWarnings && (
        <Paper
          elevation={elevation}
          variant={variant}
          sx={{
            border: '1px solid',
            borderColor: 'warning.main',
            bgcolor: 'warning.lighter',
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              p: 2,
              bgcolor: 'warning.main',
              color: 'warning.contrastText',
            }}
          >
            <WarningIcon sx={{ mr: 1.5 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle1" fontWeight={600}>
                Warnings
                {showWarningCount && ` (${warnings.length})`}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                Please review the following warnings
              </Typography>
            </Box>
            {collapsible && (
              <IconButton
                size="small"
                onClick={() => setWarningsExpanded(!warningsExpanded)}
                sx={{ color: 'inherit' }}
              >
                {warningsExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              </IconButton>
            )}
            {onClose && !collapsible && (
              <IconButton
                size="small"
                onClick={onClose}
                sx={{ color: 'inherit' }}
              >
                <CloseIcon />
              </IconButton>
            )}
          </Box>

          <Collapse in={collapsible ? warningsExpanded : true}>
            <List sx={{ py: 0 }}>
              {warnings.map(([field, message], index) => (
                <React.Fragment key={field}>
                  {index > 0 && <Divider />}
                  <ListItem sx={{ py: 1.5, px: 2 }}>
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <WarningIcon color="warning" fontSize="small" />
                    </ListItemIcon>
                    <ListItemText
                      primary={
                        <Typography variant="body2" fontWeight={500}>
                          {formatFieldName(field)}
                        </Typography>
                      }
                      secondary={
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ mt: 0.5 }}
                        >
                          {message}
                        </Typography>
                      }
                    />
                  </ListItem>
                </React.Fragment>
              ))}
            </List>
          </Collapse>
        </Paper>
      )}
    </Box>
  );
}

/**
 * Simple Validation Alert
 * A simpler, more compact version using Alert component
 */
export function ValidationAlert({
  validationResult,
  show = true,
  onClose,
  showDetails = true,
}: {
  validationResult: ValidationResult;
  show?: boolean;
  onClose?: () => void;
  showDetails?: boolean;
}) {
  if (!show) return null;

  const errors = Object.entries(validationResult.errors || {});
  const warnings = Object.entries(validationResult.warnings || {});
  const hasErrors = errors.length > 0;
  const hasWarnings = warnings.length > 0;

  if (!hasErrors && !hasWarnings) return null;

  return (
    <Box sx={{ width: '100%' }}>
      {/* Errors */}
      {hasErrors && (
        <Alert severity="error" onClose={onClose} sx={{ mb: hasWarnings ? 2 : 0 }}>
          <AlertTitle>
            <strong>Validation Errors ({errors.length})</strong>
          </AlertTitle>
          {showDetails && (
            <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
              {errors.map(([field, message]) => (
                <li key={field}>
                  <Typography variant="body2">
                    <strong>{formatFieldName(field)}:</strong> {message}
                  </Typography>
                </li>
              ))}
            </Box>
          )}
        </Alert>
      )}

      {/* Warnings */}
      {hasWarnings && (
        <Alert severity="warning" onClose={onClose}>
          <AlertTitle>
            <strong>Warnings ({warnings.length})</strong>
          </AlertTitle>
          {showDetails && (
            <Box component="ul" sx={{ mt: 1, mb: 0, pl: 2 }}>
              {warnings.map(([field, message]) => (
                <li key={field}>
                  <Typography variant="body2">
                    <strong>{formatFieldName(field)}:</strong> {message}
                  </Typography>
                </li>
              ))}
            </Box>
          )}
        </Alert>
      )}
    </Box>
  );
}

/**
 * Format field name for display
 * Converts camelCase or snake_case to Title Case
 */
function formatFieldName(field: string): string {
  return field
    .replace(/([A-Z])/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/^./, (str) => str.toUpperCase())
    .trim();
}

/**
 * Inline Field Error
 * A small error message for inline display next to form fields
 */
export function InlineFieldError({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        mt: 0.5,
      }}
    >
      <ErrorIcon sx={{ fontSize: 14, color: 'error.main' }} />
      <Typography variant="caption" color="error">
        {message}
      </Typography>
    </Box>
  );
}

/**
 * Inline Field Warning
 * A small warning message for inline display next to form fields
 */
export function InlineFieldWarning({ message }: { message?: string }) {
  if (!message) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        mt: 0.5,
      }}
    >
      <WarningIcon sx={{ fontSize: 14, color: 'warning.main' }} />
      <Typography variant="caption" color="warning.main">
        {message}
      </Typography>
    </Box>
  );
}
