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
  Chip,
  Stack,
} from '@mui/material';
import { Add, Delete } from '@mui/icons-material';
import { useFieldArray, Control, Controller } from 'react-hook-form';
import { MaterialUsageFormData } from '@/types/material-usage';

interface MaterialUsageItemsTableProps {
  control: Control<MaterialUsageFormData>;
}

export function MaterialUsageItemsTable({ control }: MaterialUsageItemsTableProps) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  // Items are entered manually in the new schema design
  // No need to fetch from master data

  const addNewItem = () => {
    append({
      id: `temp-${Date.now()}`,
      item_code: '',
      item_name: '',
      item_type: 'ROH',
      uom: '',
      qty: 0,
      ppkek_number: '',
    });
  };

  return (
    <Paper elevation={2} sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" fontWeight="bold" color="primary">
            Material Items
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Add materials used (ROH and HALB only)
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
              <TableCell sx={{ fontWeight: 'bold', width: '25%' }}>Material Item</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '10%' }}>Type</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '10%' }}>UOM</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '12%' }}>Quantity</TableCell>
              <TableCell sx={{ fontWeight: 'bold', width: '20%' }}>PPKEK Number</TableCell>
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
                      name={`items.${index}.item_code`}
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
                      name={`items.${index}.item_type`}
                      control={control}
                      render={({ field: controllerField }) => (
                        <Chip
                          label={String(controllerField.value)}
                          size="small"
                          color={controllerField.value === 'ROH' ? 'primary' : 'secondary'}
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
                      name={`items.${index}.qty`}
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
                      name={`items.${index}.ppkek_number`}
                      control={control}
                      render={({ field: controllerField, fieldState: { error } }) => (
                        <TextField
                          {...controllerField}
                          size="small"
                          fullWidth
                          error={!!error}
                          helperText={error?.message}
                          placeholder="Enter PPKEK number (optional)"
                        />
                      )}
                    />
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
