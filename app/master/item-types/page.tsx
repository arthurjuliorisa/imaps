'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Typography,
  CircularProgress,
  Chip,
} from '@mui/material';
import { Category } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface ItemType {
  item_type_code: string;
  item_type_name: string;
  item_type_name_local?: string;
  is_active: boolean;
  is_inventory_item: boolean;
  is_capital_goods: boolean;
}

export default function ItemTypesPage() {
  const toast = useToast();
  const [itemTypes, setItemTypes] = useState<ItemType[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItemTypes();
  }, []);

  const fetchItemTypes = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/master/item-types');
      const result = await response.json();

      if (result.success) {
        setItemTypes(result.data || []);
      } else {
        toast.error('Failed to load item types');
      }
    } catch (error) {
      console.error('Error fetching item types:', error);
      toast.error('Failed to load item types');
    } finally {
      setLoading(false);
    }
  };

  const getCategoryColor = (code: string) => {
    if (code.startsWith('ROH')) return 'primary';
    if (code.startsWith('HALB')) return 'warning';
    if (code.startsWith('FERT')) return 'success';
    if (code.startsWith('HIBE')) return 'info';
    if (code.startsWith('SCRAP')) return 'error';
    return 'default';
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Category sx={{ fontSize: 40, mr: 2, color: 'primary.main' }} />
        <Box>
          <Typography variant="h4" fontWeight="bold">
            Master Item Type
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Daftar tipe item yang digunakan dalam sistem
          </Typography>
        </Box>
      </Box>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : (
        <TableContainer component={Paper}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Item Type Code</TableCell>
                <TableCell>Item Type Name</TableCell>
                <TableCell>Local Name</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {itemTypes.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    <Typography variant="body2" color="text.secondary" py={4}>
                      No item types found
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                itemTypes.map((itemType) => (
                  <TableRow key={itemType.item_type_code} hover>
                    <TableCell>
                      <Chip
                        label={itemType.item_type_code}
                        color={getCategoryColor(itemType.item_type_code)}
                        size="small"
                      />
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>
                        {itemType.item_type_name}
                      </Typography>
                    </TableCell>
                    <TableCell>{itemType.item_type_name_local || '-'}</TableCell>
                    <TableCell>
                      {itemType.is_capital_goods ? (
                        <Chip label="Capital Goods" color="info" size="small" />
                      ) : itemType.is_inventory_item ? (
                        <Chip label="Inventory" color="primary" size="small" />
                      ) : (
                        <Chip label="Non-Inventory" color="default" size="small" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={itemType.is_active ? 'Active' : 'Inactive'}
                        color={itemType.is_active ? 'success' : 'default'}
                        size="small"
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  );
}
