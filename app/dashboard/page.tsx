'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  LinearProgress,
  Chip,
  List,
  ListItem,
  ListItemText,
  ListItemAvatar,
  Avatar,
  Divider,
  Button,
  Stack,
  alpha,
  useTheme,
  CircularProgress,
  Skeleton,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Inventory,
  People,
  Assessment,
  ArrowUpward,
  ArrowDownward,
  LocalShipping,
  Circle,
} from '@mui/icons-material';
import Link from 'next/link';
import { useToast } from '@/app/components/ToastProvider';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';

dayjs.extend(relativeTime);

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  gradient: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
  loading?: boolean;
}

function StatCard({ title, value, icon, gradient, trend, loading }: StatCardProps) {
  return (
    <Card
      elevation={1}
      sx={{
        background: gradient,
        color: 'white',
        height: '100%',
      }}
    >
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
          <Box sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)', borderRadius: 1, p: 1 }}>
            {icon}
          </Box>
          {trend && !loading && (
            <Chip
              icon={trend.isPositive ? <ArrowUpward sx={{ fontSize: 16 }} /> : <ArrowDownward sx={{ fontSize: 16 }} />}
              label={trend.value}
              size="small"
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.2)',
                color: 'white',
                fontWeight: 600,
              }}
            />
          )}
        </Box>
        {loading ? (
          <Skeleton variant="text" width="60%" height={48} sx={{ bgcolor: 'rgba(255, 255, 255, 0.2)' }} />
        ) : (
          <Typography variant="h3" fontWeight="bold" gutterBottom>
            {value}
          </Typography>
        )}
        <Typography variant="body2" sx={{ opacity: 0.9 }}>
          {title}
        </Typography>
      </CardContent>
    </Card>
  );
}

interface ActivityItem {
  id: string;
  type: 'item' | 'customer' | 'supplier' | 'report';
  title: string;
  description: string;
  time: string;
  timestamp: string;
  color: string;
}

interface Metrics {
  totalItems: number;
  totalCustomers: number;
  totalSuppliers: number;
  totalReports: number;
  itemsTrend?: string;
  customersTrend?: string;
  suppliersTrend?: string;
  reportsTrend?: string;
  totalScrap?: number;
  totalRawMaterials?: number;
  totalProduction?: number;
  totalCapitalGoods?: number;
  totalUsers?: number;
  incomingDocuments?: number;
  outgoingDocuments?: number;
}

interface InventoryStatus {
  rawMaterials: number;
  finishedGoods: number;
  workInProgress: number;
  inStock: number;
  lowStock: number;
  outOfStock: number;
}

export default function DashboardPage() {
  const theme = useTheme();
  const toast = useToast();

  const [metrics, setMetrics] = useState<Metrics>({
    totalItems: 0,
    totalScrap: 0,
    totalRawMaterials: 0,
    totalProduction: 0,
    totalCapitalGoods: 0,
    totalCustomers: 0,
    totalSuppliers: 0,
    totalUsers: 0,
    incomingDocuments: 0,
    outgoingDocuments: 0,
    totalReports: 0,
  });
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [inventory, setInventory] = useState<InventoryStatus | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(true);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [inventoryLoading, setInventoryLoading] = useState(true);

  const fetchAllData = useCallback(async () => {
    setMetricsLoading(true);
    setActivitiesLoading(true);
    setInventoryLoading(true);

    try {
      const [metricsRes, activitiesRes, inventoryRes] = await Promise.all([
        fetch('/api/dashboard/metrics').catch(err => {
          console.error('Metrics fetch failed:', err);
          return null;
        }),
        fetch('/api/dashboard/activities').catch(err => {
          console.error('Activities fetch failed:', err);
          return null;
        }),
        fetch('/api/dashboard/inventory-status').catch(err => {
          console.error('Inventory fetch failed:', err);
          return null;
        })
      ]);

      if (metricsRes?.ok) {
        try {
          const metricsData = await metricsRes.json();
          setMetrics({
            totalItems: metricsData.totalItems || 0,
            totalScrap: metricsData.totalScrap || 0,
            totalRawMaterials: metricsData.totalRawMaterials || 0,
            totalProduction: metricsData.totalProduction || 0,
            totalCapitalGoods: metricsData.totalCapitalGoods || 0,
            totalCustomers: metricsData.totalCustomers || 0,
            totalSuppliers: metricsData.totalSuppliers || 0,
            totalUsers: metricsData.totalUsers || 0,
            incomingDocuments: metricsData.incomingDocuments || 0,
            outgoingDocuments: metricsData.outgoingDocuments || 0,
            totalReports: metricsData.totalReports || 0,
            itemsTrend: metricsData.itemsTrend,
            customersTrend: metricsData.customersTrend,
            suppliersTrend: metricsData.suppliersTrend,
            reportsTrend: metricsData.reportsTrend,
          });
        } catch (err) {
          console.error('Error parsing metrics data:', err);
        }
      }
      setMetricsLoading(false);

      if (activitiesRes?.ok) {
        try {
          const activitiesData = await activitiesRes.json();
          setActivities(activitiesData.activities || activitiesData || []);
        } catch (err) {
          console.error('Error parsing activities data:', err);
        }
      }
      setActivitiesLoading(false);

      if (inventoryRes?.ok) {
        try {
          const inventoryData = await inventoryRes.json();
          setInventory(inventoryData);
        } catch (err) {
          console.error('Error parsing inventory data:', err);
        }
      }
      setInventoryLoading(false);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      toast.error('Failed to load dashboard data');
      setMetricsLoading(false);
      setActivitiesLoading(false);
      setInventoryLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  const inventoryProgress = inventory ? [
    { name: 'Raw Materials', value: inventory.rawMaterials ?? 0, color: '#6366f1' },
    { name: 'Finished Goods', value: inventory.finishedGoods ?? 0, color: '#10b981' },
    { name: 'Work In Progress', value: inventory.workInProgress ?? 0, color: '#f59e0b' },
  ] : [];

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight="bold" gutterBottom>
          Dashboard
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Overview of your inventory and operations
        </Typography>
      </Box>

      <Grid container spacing={3}>
        {/* Stats Cards */}
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Total Items"
            value={metrics.totalItems.toLocaleString()}
            icon={<Inventory sx={{ fontSize: 28 }} />}
            gradient="linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
            trend={metrics.itemsTrend ? { value: metrics.itemsTrend, isPositive: metrics.itemsTrend.startsWith('+') } : undefined}
            loading={metricsLoading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Customers"
            value={metrics.totalCustomers.toLocaleString()}
            icon={<People sx={{ fontSize: 28 }} />}
            gradient="linear-gradient(135deg, #10b981 0%, #14b8a6 100%)"
            trend={metrics.customersTrend ? { value: metrics.customersTrend, isPositive: metrics.customersTrend.startsWith('+') } : undefined}
            loading={metricsLoading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Suppliers"
            value={metrics.totalSuppliers.toLocaleString()}
            icon={<LocalShipping sx={{ fontSize: 28 }} />}
            gradient="linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"
            trend={metrics.suppliersTrend ? { value: metrics.suppliersTrend, isPositive: metrics.suppliersTrend.startsWith('+') } : undefined}
            loading={metricsLoading}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Reports"
            value={metrics.totalReports.toLocaleString()}
            icon={<Assessment sx={{ fontSize: 28 }} />}
            gradient="linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)"
            trend={metrics.reportsTrend ? { value: metrics.reportsTrend, isPositive: metrics.reportsTrend.startsWith('+') } : undefined}
            loading={metricsLoading}
          />
        </Grid>

        {/* Inventory Overview */}
        <Grid size={{ xs: 12, md: 8 }}>
          <Paper sx={{ p: 3 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
              <Typography variant="h6" fontWeight="bold">
                Inventory Overview
              </Typography>
              <Button
                variant="outlined"
                size="small"
                component={Link}
                href="/master/item"
              >
                View All
              </Button>
            </Box>

            {inventoryLoading ? (
              <Stack spacing={3}>
                <Skeleton variant="rectangular" height={40} />
                <Skeleton variant="rectangular" height={40} />
                <Skeleton variant="rectangular" height={40} />
              </Stack>
            ) : (
              <Stack spacing={3}>
                {inventoryProgress.map((item) => (
                  <Box key={item.name}>
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                      <Typography variant="body2" fontWeight={500}>
                        {item.name}
                      </Typography>
                      <Typography variant="body2" fontWeight={600} sx={{ color: item.color }}>
                        {item.value}%
                      </Typography>
                    </Box>
                    <LinearProgress
                      variant="determinate"
                      value={item.value}
                      sx={{
                        height: 8,
                        borderRadius: 4,
                        bgcolor: alpha(item.color, 0.1),
                        '& .MuiLinearProgress-bar': {
                          bgcolor: item.color,
                          borderRadius: 4,
                        },
                      }}
                    />
                  </Box>
                ))}
              </Stack>
            )}

            <Divider sx={{ my: 3 }} />

            {inventoryLoading ? (
              <Grid container spacing={2}>
                <Grid size={{ xs: 4 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Skeleton variant="text" height={40} />
                    <Skeleton variant="text" height={20} />
                  </Box>
                </Grid>
                <Grid size={{ xs: 4 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Skeleton variant="text" height={40} />
                    <Skeleton variant="text" height={20} />
                  </Box>
                </Grid>
                <Grid size={{ xs: 4 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Skeleton variant="text" height={40} />
                    <Skeleton variant="text" height={20} />
                  </Box>
                </Grid>
              </Grid>
            ) : (
              <Grid container spacing={2}>
                <Grid size={{ xs: 4 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight="bold" color="primary.main">
                      {inventory?.inStock?.toLocaleString() ?? '0'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      In Stock
                    </Typography>
                  </Box>
                </Grid>
                <Grid size={{ xs: 4 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight="bold" color="warning.main">
                      {inventory?.lowStock?.toLocaleString() ?? '0'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Low Stock
                    </Typography>
                  </Box>
                </Grid>
                <Grid size={{ xs: 4 }}>
                  <Box sx={{ textAlign: 'center' }}>
                    <Typography variant="h5" fontWeight="bold" color="error.main">
                      {inventory?.outOfStock?.toLocaleString() ?? '0'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Out of Stock
                    </Typography>
                  </Box>
                </Grid>
              </Grid>
            )}
          </Paper>
        </Grid>

        {/* Recent Activity */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>
              Recent Activity
            </Typography>
            {activitiesLoading ? (
              <Stack spacing={2}>
                {[1, 2, 3, 4].map((i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 2 }}>
                    <Skeleton variant="circular" width={36} height={36} />
                    <Box sx={{ flex: 1 }}>
                      <Skeleton variant="text" height={20} width="60%" />
                      <Skeleton variant="text" height={16} width="100%" />
                      <Skeleton variant="text" height={14} width="40%" />
                    </Box>
                  </Box>
                ))}
              </Stack>
            ) : activities.length === 0 ? (
              <Box sx={{ textAlign: 'center', py: 4 }}>
                <Typography variant="body2" color="text.secondary">
                  No recent activities
                </Typography>
              </Box>
            ) : (
              <List>
                {activities.map((activity, index) => (
                  <React.Fragment key={activity.id}>
                    <ListItem alignItems="flex-start" sx={{ px: 0 }}>
                      <ListItemAvatar>
                        <Avatar
                          sx={{
                            bgcolor: alpha(activity.color, 0.1),
                            color: activity.color,
                            width: 36,
                            height: 36,
                          }}
                        >
                          <Circle sx={{ fontSize: 10 }} />
                        </Avatar>
                      </ListItemAvatar>
                      <ListItemText
                        primary={activity.title}
                        secondary={
                          <Box component="span" sx={{ display: 'block' }}>
                            <Box component="span" sx={{ display: 'block', mb: 0.5 }}>
                              {activity.description}
                            </Box>
                            <Box component="span" sx={{ display: 'block', fontSize: '0.75rem', opacity: 0.7 }}>
                              {activity.timestamp ? dayjs(activity.timestamp).fromNow() : activity.time}
                            </Box>
                          </Box>
                        }
                        primaryTypographyProps={{
                          variant: 'body2',
                          fontWeight: 600,
                        }}
                        secondaryTypographyProps={{
                          component: 'span',
                          variant: 'body2',
                          color: 'text.secondary',
                        }}
                      />
                    </ListItem>
                    {index < activities.length - 1 && <Divider component="li" />}
                  </React.Fragment>
                ))}
              </List>
            )}
          </Paper>
        </Grid>

      </Grid>
    </Box>
  );
}
