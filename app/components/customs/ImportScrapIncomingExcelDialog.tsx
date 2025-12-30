'use client';

import React, { useState, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Paper,
} from '@mui/material';
import {
  CloudUpload as CloudUploadIcon,
  CheckCircle as CheckCircleIcon,
  Download as DownloadIcon,
} from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface ImportScrapIncomingExcelDialogProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportScrapIncomingExcelDialog({
  open,
  onClose,
  onSuccess,
}: ImportScrapIncomingExcelDialogProps) {
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const handleFileSelect = (file: File) => {
    if (!file.name.endsWith('.xlsx')) {
      toast.error('Please select a valid Excel file (.xlsx)');
      return;
    }
    setSelectedFile(file);
    setErrors([]);
  };

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleDownloadTemplate = async () => {
    try {
      const response = await fetch('/api/customs/scrap-transactions/import-incoming/template');

      if (!response.ok) {
        toast.error('Failed to download template');
        return;
      }

      // Get the blob from response
      const blob = await response.blob();

      // Create a download link
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Incoming_Scrap_Template_${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();

      // Cleanup
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Template downloaded successfully');
    } catch (error) {
      console.error('Error downloading template:', error);
      toast.error('Failed to download template');
    }
  };

  const handleImport = async () => {
    if (!selectedFile) {
      toast.error('Please select a file first');
      return;
    }

    setLoading(true);
    setErrors([]);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await fetch('/api/customs/scrap-transactions/import-incoming', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.errors && Array.isArray(result.errors)) {
          setErrors(result.errors.map((e: any) => typeof e === 'string' ? e : e.message || JSON.stringify(e)));
        } else {
          setErrors([result.message || 'Import failed']);
        }
        toast.error(result.message || 'Failed to import incoming scrap transactions');
        return;
      }

      toast.success(result.message || `Successfully imported ${result.data?.importedCount || 0} incoming scrap transaction(s)`);
      handleClose();
      onSuccess();
    } catch (error) {
      console.error('Import error:', error);
      toast.error('An unexpected error occurred during import');
      setErrors(['An unexpected error occurred. Please try again.']);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (!loading) {
      setSelectedFile(null);
      setErrors([]);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      disableEscapeKeyDown={loading}
    >
      <DialogTitle>
        Import Incoming Scrap - Simple Format
      </DialogTitle>

      <DialogContent dividers>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          {errors.length > 0 && (
            <Alert severity="error">
              <Typography variant="body2" fontWeight="bold" gutterBottom>
                Import Errors:
              </Typography>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                {errors.map((error, index) => (
                  <li key={index}>
                    <Typography variant="body2">{error}</Typography>
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <Paper
            variant="outlined"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            sx={{
              p: 4,
              textAlign: 'center',
              border: dragOver ? '2px dashed' : '2px dashed',
              borderColor: dragOver ? 'primary.main' : 'divider',
              bgcolor: dragOver ? 'action.hover' : 'background.paper',
              cursor: 'pointer',
              transition: 'all 0.2s',
              '&:hover': {
                bgcolor: 'action.hover',
                borderColor: 'primary.main',
              },
            }}
            onClick={handleUploadClick}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              style={{ display: 'none' }}
              onChange={handleFileInputChange}
            />

            {selectedFile ? (
              <>
                <CheckCircleIcon sx={{ fontSize: 48, color: 'success.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  {selectedFile.name}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </Typography>
                <Typography variant="body2" color="primary" sx={{ mt: 1 }}>
                  Click to select a different file
                </Typography>
              </>
            ) : (
              <>
                <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                <Typography variant="body1" gutterBottom>
                  Drag and drop your Excel file here
                </Typography>
                <Typography variant="body2" color="text.secondary" gutterBottom>
                  or click to browse
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Supported format: .xlsx
                </Typography>
              </>
            )}
          </Paper>

          <Alert severity="info">
            <Typography variant="body2" fontWeight="bold" gutterBottom>
              Excel Format Requirements:
            </Typography>
            <Typography variant="body2" component="div">
              Required columns:
              <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                <li><strong>Date</strong> - Transaction date (e.g., 2025-12-27 or 27/12/2025)</li>
                <li><strong>Scrap Code</strong> - Item code from scrap master</li>
                <li><strong>Scrap Name</strong> - Item name</li>
                <li><strong>UOM</strong> - Unit of measure (e.g., KG, PCS)</li>
                <li><strong>Quantity</strong> - Quantity (must be &gt; 0)</li>
                <li><strong>Currency</strong> - USD, IDR, CNY, EUR, or JPY</li>
                <li><strong>Amount</strong> - Transaction amount (must be ≥ 0)</li>
                <li><strong>Remarks</strong> - Optional notes</li>
              </ul>
            </Typography>
            <Typography variant="body2" component="div" sx={{ mt: 1 }}>
              <strong>Note:</strong> Data harus dimulai dari baris ke-3 (Row 3). Baris 1 adalah header, baris 2 adalah format hint.
            </Typography>
          </Alert>
        </Box>
      </DialogContent>

      <DialogActions>
        <Button
          onClick={handleDownloadTemplate}
          disabled={loading}
          startIcon={<DownloadIcon />}
          sx={{ mr: 'auto' }}
        >
          Download Template
        </Button>
        <Button onClick={handleClose} disabled={loading}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleImport}
          disabled={!selectedFile || loading}
          startIcon={loading ? <CircularProgress size={20} /> : <CloudUploadIcon />}
        >
          {loading ? 'Importing...' : 'Import'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
