'use client';

import React from 'react';
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
  Box,
  Stack,
  MenuItem,
  Chip,
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import { useFieldArray, Control, Controller } from 'react-hook-form';
import { ProductionOutputFormData } from '@/types/production';
import { WorkOrderLinkingTable } from './WorkOrderLinkingTable';

interface ProductionOutputItemsTableProps {
  control: Control<ProductionOutputFormData>;
}

const qualityGrades = [
  { value: 'A', label: 'Grade A', color: 'success' as const },
  { value: 'B', label: 'Grade B', color: 'info' as const },
  { value: 'C', label: 'Grade C', color: 'warning' as const },
  { value: 'REJECT', label: 'Reject', color: 'error' as const },
];

export function ProductionOutputItemsTable({ control }: ProductionOutputItemsTableProps) {
  const { fields, append, remove, update } = useFieldArray({
    control,
    name: 'items',
  });

  // Items are entered manually in the new schema design
  // No need to fetch from master data

  const addNewItem = () => {
    append({
      id: `temp-${Date.now()}`,
      itemCode: '',
      itemName: '',
      uom: '',
      quantity: 0,
      qualityGrade: 'A',
      workOrderNumbers: [],
    });
  };

  const handleWorkOrdersChange = (index: number, workOrders: string[]) => {
    const currentItem = fields[index];
    update(index, {
      ...currentItem,
      workOrderNumbers: workOrders,
    });
  };

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight="bold" color="primary">
            Finished Goods Output
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Add finished goods produced with quality classification
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={addNewItem}
          sx={{ textTransform: 'none' }}
        >
          Add Item
        </Button>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 'bold', width: '25%' }}>Finished Good Item</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '10%' }}>UOM</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '12%' }}>Quantity</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '15%' }}>Quality Grade</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '20%' }}>Work Orders</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '8%', textAlign: 'center' }}>
                Action
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {fields.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center" sx={{ py: 4 }}>
                  <Typography variant="body2" color="text.secondary">
                    No items added. Click "Add Item" to start.
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              fields.map((field, index) => (
                <TableRow key={field.id}>
                  <TableCell>
                    <Controller
                      name={`items.${index}.itemCode`}
                      control={control}
                      rules={{ required: 'Item code is required' }}
                      render={({ field: controllerField, fieldState: { error } }) => (
                        <TextField
                          {...controllerField}
                          size="small"
                          fullWidth
                          error={!!error}
                          helperText={error?.message}
                          placeholder="Enter item code"
                        />
                      )}
                    />
                  </TableCell>

                  <TableCell>
                    <Controller
                      name={`items.${index}.uom`}
                      control={control}
                      render={({ field: controllerField }) => (
                        <Typography variant="body2">{controllerField.value}</Typography>
                      )}
                    />
                  </TableCell>

                  <TableCell>
                    <Controller
                      name={`items.${index}.quantity`}
                      control={control}
                      rules={{
                        required: 'Quantity is required',
                        min: { value: 0.01, message: 'Must be greater than 0' },
                      }}
                      render={({ field: controllerField, fieldState: { error } }) => (
                        <TextField
                          {...controllerField}
                          type="number"
                          size="small"
                          fullWidth
                          error={!!error}
                          helperText={error?.message}
                          inputProps={{ min: 0.01, step: 0.01 }}
                          onChange={(e) => {
                            const value = parseFloat(e.target.value);
                            controllerField.onChange(isNaN(value) ? 0 : value);
                          }}
                        />
                      )}
                    />
                  </TableCell>

                  <TableCell>
                    <Controller
                      name={`items.${index}.qualityGrade`}
                      control={control}
                      rules={{ required: 'Quality grade is required' }}
                      render={({ field: controllerField, fieldState: { error } }) => (
                        <TextField
                          {...controllerField}
                          select
                          size="small"
                          fullWidth
                          error={!!error}
                          helperText={error?.message}
                        >
                          {qualityGrades.map((grade) => (
                            <MenuItem key={grade.value} value={grade.value}>
                              <Chip
                                label={grade.label}
                                size="small"
                                color={grade.color}
                                sx={{ minWidth: 80 }}
                              />
                            </MenuItem>
                          ))}
                        </TextField>
                      )}
                    />
                  </TableCell>

                  <TableCell>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <WorkOrderLinkingTable
                        itemIndex={index}
                        linkedWorkOrders={field.workOrderNumbers}
                        onWorkOrdersChange={(workOrders) => handleWorkOrdersChange(index, workOrders)}
                      />
                      {field.workOrderNumbers.length > 0 && (
                        <Typography variant="caption" color="text.secondary">
                          {field.workOrderNumbers.length} linked
                        </Typography>
                      )}
                    </Stack>
                  </TableCell>

                  <TableCell align="center">
                    <IconButton
                      size="small"
                      color="error"
                      onClick={() => remove(index)}
                      aria-label="delete item"
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

      {fields.length > 0 && (
        <Box sx={{ mt: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
          <Typography variant="body2" fontWeight="medium">
            Total Items: {fields.length}
          </Typography>
        </Box>
      )}
    </Paper>
  );
}
