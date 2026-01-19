'use client';

import React, { useState, useEffect, useCallback, use } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useToast } from '@/app/components/ToastProvider';
import { StockOpname, StockOpnameItem } from '@/types/stock-opname';
import { HeaderSection } from './components/HeaderSection';
import { AddItemSection } from './components/AddItemSection';
import { ItemsTable } from './components/ItemsTable';
import { EditItemDialog } from './components/EditItemDialog';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function StockOpnameDetailPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const toast = useToast();
  const stockOpnameId = parseInt(resolvedParams.id);

  const [loading, setLoading] = useState(true);
  const [stockOpname, setStockOpname] = useState<StockOpname | null>(null);
  const [items, setItems] = useState<StockOpnameItem[]>([]);
  const [editItem, setEditItem] = useState<StockOpnameItem | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const response = await fetch(`/api/customs/stock-opname/${stockOpnameId}`);
      if (!response.ok) throw new Error('Failed to fetch stock opname');

      const data = await response.json();
      setStockOpname(data.stockOpname);
      setItems(data.items || []);
    } catch (error) {
      console.error('Error fetching stock opname:', error);
      toast.error('Failed to load stock opname details');
    } finally {
      setLoading(false);
    }
  }, [stockOpnameId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDeleteItem = async (itemId: bigint | string) => {
    try {
      const response = await fetch(
        `/api/customs/stock-opname/${stockOpnameId}/items/${itemId}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Failed to delete item');
      }

      toast.success('Item deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting item:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to delete item');
    }
  };

  const totals = items.reduce(
    (acc, item) => ({
      totalItems: acc.totalItems + 1,
      totalStoQty: acc.totalStoQty + Number(item.sto_qty || 0),
      totalVariant: acc.totalVariant + Number(item.variant || 0),
    }),
    { totalItems: 0, totalStoQty: 0, totalVariant: 0 }
  );

  if (loading) {
    return (
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '400px',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (!stockOpname) {
    return (
      <Box sx={{ p: 3 }}>
        <Typography variant="h6" color="error">
          Stock opname not found
        </Typography>
      </Box>
    );
  }

  const canEdit = stockOpname.status !== 'RELEASED';

  return (
    <Box sx={{ p: 3 }}>
      <HeaderSection
        stockOpname={stockOpname}
        totalItems={totals.totalItems}
        totalStoQty={totals.totalStoQty}
        totalVariant={totals.totalVariant}
        onUpdate={fetchData}
      />

      {canEdit && (
        <AddItemSection
          stockOpnameId={stockOpnameId}
          onItemAdded={fetchData}
        />
      )}

      <ItemsTable
        items={items}
        stoDate={stockOpname.sto_datetime}
        canEdit={canEdit}
        onEdit={setEditItem}
        onDelete={handleDeleteItem}
      />

      <EditItemDialog
        open={!!editItem}
        item={editItem}
        stockOpnameId={stockOpnameId}
        onClose={() => setEditItem(null)}
        onUpdate={fetchData}
      />
    </Box>
  );
}
