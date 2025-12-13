'use client';

import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Checkbox,
  FormControlLabel,
  CircularProgress,
  Alert,
  Chip,
  Stack,
  TextField,
  alpha,
  useTheme,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material';
import { Close, Check, Search } from '@mui/icons-material';

interface ProductionBatch {
  id: string;
  batchNumber: string;
  productionDate: string;
  quantity: number;
  availableQuantity: number;
  uom: string;
  status: string;
}

interface ProductionBatchSelectorProps {
  open: boolean;
  onClose: () => void;
  itemId: string;
  itemCode: string;
  itemName: string;
  selectedBatchIds: string[];
  onConfirm: (batchIds: string[]) => void;
  requiredQuantity: number;
}

export function ProductionBatchSelector({
  open,
  onClose,
  itemId,
  itemCode,
  itemName,
  selectedBatchIds,
  onConfirm,
  requiredQuantity,
}: ProductionBatchSelectorProps) {
  const theme = useTheme();
  const [batches, setBatches] = useState<ProductionBatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>(selectedBatchIds);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (open && itemId) {
      fetchProductionBatches();
    }
  }, [open, itemId]);

  useEffect(() => {
    setSelected(selectedBatchIds);
  }, [selectedBatchIds]);

  const fetchProductionBatches = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/wms/production-batches?itemId=${itemId}&status=AVAILABLE`);
      if (response.ok) {
        const data = await response.json();
        setBatches(data);
      } else {
        setBatches([]);
      }
    } catch (error) {
      console.error('Error fetching production batches:', error);
      setBatches([]);
    } finally {
      setLoading(false);
    }
  };

  const handleToggle = (batchId: string) => {
    setSelected((prev) => {
      if (prev.includes(batchId)) {
        return prev.filter((id) => id !== batchId);
      } else {
        return [...prev, batchId];
      }
    });
  };

  const handleSelectAll = () => {
    const filteredBatchIds = filteredBatches.map((b) => b.id);
    setSelected(filteredBatchIds);
  };

  const handleDeselectAll = () => {
    setSelected([]);
  };

  const handleConfirm = () => {
    onConfirm(selected);
    onClose();
  };

  const filteredBatches = batches.filter(
    (batch) =>
      batch.batchNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      batch.status.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedBatches = batches.filter((b) => selected.includes(b.id));
  const totalSelectedQuantity = selectedBatches.reduce((sum, b) => sum + b.availableQuantity, 0);
  const isSufficientQuantity = totalSelectedQuantity >= requiredQuantity;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle
        sx={{
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          borderBottom: `1px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography component="div" fontWeight="bold" color="primary" sx={{ fontSize: '1.25rem' }}>
            Select Production Batches
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {itemCode} - {itemName}
          </Typography>
        </Box>
      </DialogTitle>

      <DialogContent sx={{ mt: 2 }}>
        <Stack spacing={2}>
          <Box
            sx={{
              p: 2,
              bgcolor: alpha(theme.palette.info.main, 0.08),
              borderRadius: 1,
              border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
            }}
          >
            <Typography variant="subtitle2" fontWeight="bold" color="info.main">
              Production Traceability
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Select production batches to link with this outgoing item for traceability. Required quantity: <strong>{requiredQuantity.toLocaleString('id-ID')}</strong>
            </Typography>
          </Box>

          {selected.length > 0 && (
            <Alert
              severity={isSufficientQuantity ? 'success' : 'warning'}
              sx={{ alignItems: 'center' }}
            >
              <Box>
                <Typography variant="body2" fontWeight={600}>
                  Selected: {selected.length} batch(es) - Total Quantity: {totalSelectedQuantity.toLocaleString('id-ID')}
                </Typography>
                {!isSufficientQuantity && (
                  <Typography variant="caption" color="warning.main">
                    Warning: Selected quantity is less than required quantity
                  </Typography>
                )}
              </Box>
            </Alert>
          )}

          <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Search by batch number..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              InputProps={{
                startAdornment: <Search sx={{ mr: 1, color: 'text.secondary' }} />,
              }}
            />
            <Button
              size="small"
              onClick={handleSelectAll}
              disabled={filteredBatches.length === 0}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              Select All
            </Button>
            <Button
              size="small"
              onClick={handleDeselectAll}
              disabled={selected.length === 0}
              sx={{ textTransform: 'none', whiteSpace: 'nowrap' }}
            >
              Deselect All
            </Button>
          </Box>

          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          ) : filteredBatches.length === 0 ? (
            <Box
              sx={{
                p: 4,
                textAlign: 'center',
                bgcolor: alpha(theme.palette.background.default, 0.5),
                borderRadius: 1,
              }}
            >
              <Typography variant="body1" color="text.secondary">
                {searchQuery ? 'No batches found matching your search' : 'No production batches available for this item'}
              </Typography>
            </Box>
          ) : (
            <TableContainer sx={{ maxHeight: 400, border: `1px solid ${theme.palette.divider}`, borderRadius: 1 }}>
              <Table stickyHeader size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      Select
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      Batch Number
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      Production Date
                    </TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      Available Qty
                    </TableCell>
                    <TableCell sx={{ fontWeight: 600, bgcolor: alpha(theme.palette.primary.main, 0.08) }}>
                      Status
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filteredBatches.map((batch) => (
                    <TableRow
                      key={batch.id}
                      hover
                      onClick={() => handleToggle(batch.id)}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: selected.includes(batch.id)
                          ? alpha(theme.palette.primary.main, 0.08)
                          : 'inherit',
                      }}
                    >
                      <TableCell padding="checkbox">
                        <Checkbox
                          checked={selected.includes(batch.id)}
                          onChange={() => handleToggle(batch.id)}
                        />
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>
                          {batch.batchNumber}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography variant="body2">
                          {new Date(batch.productionDate).toLocaleDateString('id-ID')}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2">
                          {batch.availableQuantity.toLocaleString('id-ID')} {batch.uom}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Chip
                          label={batch.status}
                          size="small"
                          color={batch.status === 'AVAILABLE' ? 'success' : 'default'}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button
          onClick={onClose}
          startIcon={<Close />}
          sx={{ textTransform: 'none' }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          startIcon={<Check />}
          disabled={selected.length === 0}
          sx={{
            textTransform: 'none',
            borderRadius: 2,
            px: 3,
          }}
        >
          Confirm Selection ({selected.length})
        </Button>
      </DialogActions>
    </Dialog>
  );
}
