'use client';

import React, { useState, useEffect } from 'react';
import {
  Paper,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Button,
  IconButton,
  TextField,
  Autocomplete,
  Box,
  CircularProgress,
  Stack,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import { Add, Delete, Link as LinkIcon } from '@mui/icons-material';
import { WorkOrder } from '@/types/material-usage';

interface WorkOrderLink {
  workOrderNumber: string;
  productCode: string;
  productName: string;
  allocatedQuantity: number;
}

interface WorkOrderLinkingTableProps {
  itemIndex: number;
  linkedWorkOrders: string[];
  onWorkOrdersChange: (workOrders: string[]) => void;
  disabled?: boolean;
}

export function WorkOrderLinkingTable({
  itemIndex,
  linkedWorkOrders,
  onWorkOrdersChange,
  disabled = false,
}: WorkOrderLinkingTableProps) {
  const [open, setOpen] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedWorkOrder, setSelectedWorkOrder] = useState<WorkOrder | null>(null);
  const [allocatedQty, setAllocatedQty] = useState<number>(0);
  const [links, setLinks] = useState<WorkOrderLink[]>([]);

  useEffect(() => {
    if (open) {
      fetchWorkOrders();
    }
  }, [open]);

  useEffect(() => {
    onWorkOrdersChange(links.map((link) => link.workOrderNumber));
  }, [links]);

  const fetchWorkOrders = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/wms/work-orders?status=IN_PROGRESS');
      if (response.ok) {
        const data = await response.json();
        setWorkOrders(data);
      }
    } catch (error) {
      console.error('Error fetching work orders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddLink = () => {
    if (selectedWorkOrder && allocatedQty > 0) {
      const newLink: WorkOrderLink = {
        workOrderNumber: selectedWorkOrder.workOrderNumber,
        productCode: selectedWorkOrder.productCode,
        productName: selectedWorkOrder.productName,
        allocatedQuantity: allocatedQty,
      };
      setLinks([...links, newLink]);
      setSelectedWorkOrder(null);
      setAllocatedQty(0);
    }
  };

  const handleRemoveLink = (index: number) => {
    const newLinks = links.filter((_, i) => i !== index);
    setLinks(newLinks);
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<LinkIcon />}
        onClick={() => setOpen(true)}
        disabled={disabled}
        sx={{ textTransform: 'none' }}
      >
        Link Work Orders ({links.length})
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          <Typography variant="h6" fontWeight="bold">
            Link Work Orders - Item {itemIndex + 1}
          </Typography>
        </DialogTitle>

        <DialogContent>
          <Stack spacing={3} sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
              <Autocomplete
                options={workOrders.filter(
                  (wo) => !links.some((link) => link.workOrderNumber === wo.workOrderNumber)
                )}
                loading={loading}
                value={selectedWorkOrder}
                onChange={(_event, newValue) => setSelectedWorkOrder(newValue)}
                getOptionLabel={(option) => `${option.workOrderNumber} - ${option.productName}`}
                renderOption={(props, option) => {
                  const { key, ...restProps } = props;
                  return (
                    <Box component="li" key={key} {...restProps}>
                      <Stack spacing={0.5}>
                        <Typography variant="body2" fontWeight="medium">
                          {option.workOrderNumber}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {option.productCode} - {option.productName}
                        </Typography>
                      </Stack>
                    </Box>
                  );
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Work Order"
                    placeholder="Select work order..."
                    InputProps={{
                      ...params.InputProps,
                      endAdornment: (
                        <>
                          {loading ? <CircularProgress color="inherit" size={20} /> : null}
                          {params.InputProps.endAdornment}
                        </>
                      ),
                    }}
                  />
                )}
                sx={{ flex: 1 }}
              />

              <TextField
                label="Allocated Quantity"
                type="number"
                value={allocatedQty}
                onChange={(e) => setAllocatedQty(parseFloat(e.target.value) || 0)}
                inputProps={{ min: 0.01, step: 0.01 }}
                sx={{ width: 180 }}
              />

              <Button
                variant="contained"
                startIcon={<Add />}
                onClick={handleAddLink}
                disabled={!selectedWorkOrder || allocatedQty <= 0}
                sx={{ textTransform: 'none', minWidth: 100 }}
              >
                Add
              </Button>
            </Box>

            <TableContainer component={Paper} variant="outlined">
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Work Order</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Product</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: 150 }}>Allocated Qty</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', width: 80, textAlign: 'center' }}>
                      Action
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {links.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} align="center" sx={{ py: 3 }}>
                        <Typography variant="body2" color="text.secondary">
                          No work orders linked yet
                        </Typography>
                      </TableCell>
                    </TableRow>
                  ) : (
                    links.map((link, index) => (
                      <TableRow key={index}>
                        <TableCell>{link.workOrderNumber}</TableCell>
                        <TableCell>
                          {link.productCode} - {link.productName}
                        </TableCell>
                        <TableCell>{link.allocatedQuantity.toLocaleString()}</TableCell>
                        <TableCell align="center">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemoveLink(index)}
                          >
                            <Delete fontSize="small" />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>

            {links.length > 0 && (
              <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                <Typography variant="body2" fontWeight="medium">
                  Total Linked: {links.length} work order(s) | Total Allocated: {links.reduce((sum, link) => sum + link.allocatedQuantity, 0).toLocaleString()}
                </Typography>
              </Box>
            )}
          </Stack>
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => setOpen(false)} sx={{ textTransform: 'none' }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
