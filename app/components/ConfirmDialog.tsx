'use client';

import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
  Box,
  alpha,
  useTheme,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import DeleteIcon from '@mui/icons-material/Delete';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  severity?: 'warning' | 'error' | 'info';
  loading?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  severity = 'warning',
  loading = false,
}) => {
  const theme = useTheme();

  const getColor = () => {
    switch (severity) {
      case 'error':
        return theme.palette.error.main;
      case 'warning':
        return theme.palette.warning.main;
      case 'info':
        return theme.palette.info.main;
      default:
        return theme.palette.warning.main;
    }
  };

  const color = getColor();

  return (
    <Dialog
      open={open}
      onClose={(event, reason) => {
        // Prevent accidental dismissal during loading
        if (loading) return;
        // Prevent closing on backdrop click or escape key for better UX
        if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
          return;
        }
        onCancel();
      }}
      maxWidth="xs"
      fullWidth
      PaperProps={{
        elevation: 8,
        sx: {
          borderRadius: 3,
        },
      }}
    >
      <DialogTitle
        sx={{
          pb: 2,
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          background: alpha(color, 0.08),
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 40,
            height: 40,
            borderRadius: '50%',
            bgcolor: alpha(color, 0.15),
            color: color,
          }}
        >
          {severity === 'error' ? (
            <DeleteIcon fontSize="small" />
          ) : (
            <WarningAmberIcon fontSize="small" />
          )}
        </Box>
        <Box sx={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
          {title}
        </Box>
      </DialogTitle>
      <DialogContent sx={{ mt: 2, px: 3 }}>
        <DialogContentText sx={{ fontSize: '0.95rem', color: 'text.primary' }}>
          {message}
        </DialogContentText>
      </DialogContent>
      <DialogActions
        sx={{
          px: 3,
          py: 2,
          gap: 1,
          borderTop: `1px solid ${theme.palette.divider}`,
          bgcolor: alpha(theme.palette.background.default, 0.5),
        }}
      >
        <Button
          onClick={onCancel}
          disabled={loading}
          variant="outlined"
          sx={{ px: 3 }}
        >
          {cancelText}
        </Button>
        <Button
          onClick={onConfirm}
          disabled={loading}
          variant="contained"
          color={severity === 'error' ? 'error' : 'warning'}
          sx={{ px: 3 }}
        >
          {loading ? 'Processing...' : confirmText}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
