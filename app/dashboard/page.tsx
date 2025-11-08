'use client';

import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  CardActionArea,
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
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Inventory,
  People,
  Assessment,
  ArrowUpward,
  ArrowDownward,
  Add,
  LocalShipping,
  Description,
  Circle,
} from '@mui/icons-material';
import Link from 'next/link';

interface StatCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  gradient: string;
  trend?: {
    value: string;
    isPositive: boolean;
  };
}

function StatCard({ title, value, icon, gradient, trend }: StatCardProps) {
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
          {trend && (
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
        <Typography variant="h3" fontWeight="bold" gutterBottom>
          {value}
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.9 }}>
          {title}
        </Typography>
      </CardContent>
    </Card>
  );
}

interface QuickActionProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  color: string;
}

function QuickActionCard({ title, description, icon, href, color }: QuickActionProps) {
  const theme = useTheme();
  return (
    <Card elevation={1} sx={{ height: '100%' }}>
      <CardActionArea component={Link} href={href} sx={{ height: '100%', p: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ bgcolor: alpha(color, 0.1), borderRadius: 1, p: 1, color: color }}>
            {icon}
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight="bold" gutterBottom>
              {title}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {description}
            </Typography>
          </Box>
        </Box>
      </CardActionArea>
    </Card>
  );
}

interface ActivityItem {
  id: string;
  type: 'item' | 'customer' | 'supplier' | 'report';
  title: string;
  description: string;
  time: string;
  color: string;
}

const recentActivities: ActivityItem[] = [
  {
    id: '1',
    type: 'item',
    title: 'New Item Added',
    description: 'Raw material "Steel Sheet" has been added to inventory',
    time: '2 hours ago',
    color: '#6366f1',
  },
  {
    id: '2',
    type: 'customer',
    title: 'Customer Updated',
    description: 'PT Maju Jaya information has been updated',
    time: '5 hours ago',
    color: '#10b981',
  },
  {
    id: '3',
    type: 'report',
    title: 'Report Generated',
    description: 'Monthly inventory report has been generated',
    time: '1 day ago',
    color: '#06b6d4',
  },
  {
    id: '4',
    type: 'supplier',
    title: 'Supplier Added',
    description: 'New supplier "Global Parts Inc" has been registered',
    time: '2 days ago',
    color: '#f59e0b',
  },
];

const inventoryProgress = [
  { name: 'Raw Materials', value: 65, color: '#6366f1' },
  { name: 'Finished Goods', value: 45, color: '#10b981' },
  { name: 'Work In Progress', value: 30, color: '#f59e0b' },
];

export default function DashboardPage() {
  const theme = useTheme();

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
            value="1,248"
            icon={<Inventory sx={{ fontSize: 28 }} />}
            gradient="linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)"
            trend={{ value: '+12%', isPositive: true }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Customers"
            value="348"
            icon={<People sx={{ fontSize: 28 }} />}
            gradient="linear-gradient(135deg, #10b981 0%, #14b8a6 100%)"
            trend={{ value: '+8%', isPositive: true }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Suppliers"
            value="127"
            icon={<LocalShipping sx={{ fontSize: 28 }} />}
            gradient="linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"
            trend={{ value: '+5%', isPositive: true }}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="Reports"
            value="89"
            icon={<Assessment sx={{ fontSize: 28 }} />}
            gradient="linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)"
            trend={{ value: '+15%', isPositive: true }}
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
                href="/dashboard/master/item"
              >
                View All
              </Button>
            </Box>

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

            <Divider sx={{ my: 3 }} />

            <Grid container spacing={2}>
              <Grid size={{ xs: 4 }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" fontWeight="bold" color="primary.main">
                    856
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    In Stock
                  </Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 4 }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" fontWeight="bold" color="warning.main">
                    234
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Low Stock
                  </Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 4 }}>
                <Box sx={{ textAlign: 'center' }}>
                  <Typography variant="h5" fontWeight="bold" color="error.main">
                    158
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    Out of Stock
                  </Typography>
                </Box>
              </Grid>
            </Grid>
          </Paper>
        </Grid>

        {/* Recent Activity */}
        <Grid size={{ xs: 12, md: 4 }}>
          <Paper sx={{ p: 3 }}>
            <Typography variant="h6" fontWeight="bold" gutterBottom>
              Recent Activity
            </Typography>
            <List>
              {recentActivities.map((activity, index) => (
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
                            {activity.time}
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
                  {index < recentActivities.length - 1 && <Divider component="li" />}
                </React.Fragment>
              ))}
            </List>
          </Paper>
        </Grid>

        {/* Quick Actions */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="h6" fontWeight="bold" gutterBottom>
            Quick Actions
          </Typography>
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <QuickActionCard
            title="Add Item"
            description="Register a new item"
            icon={<Add sx={{ fontSize: 24 }} />}
            href="/dashboard/master/item"
            color={theme.palette.primary.main}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <QuickActionCard
            title="New Customer"
            description="Add a customer"
            icon={<People sx={{ fontSize: 24 }} />}
            href="/dashboard/master/customers"
            color={theme.palette.success.main}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <QuickActionCard
            title="Add Supplier"
            description="Register a supplier"
            icon={<LocalShipping sx={{ fontSize: 24 }} />}
            href="/dashboard/master/supplier"
            color={theme.palette.warning.main}
          />
        </Grid>

        <Grid size={{ xs: 12, sm: 6 }}>
          <QuickActionCard
            title="Generate Report"
            description="Create reports"
            icon={<Description sx={{ fontSize: 24 }} />}
            href="/dashboard/customs/incoming"
            color={theme.palette.info.main}
          />
        </Grid>
      </Grid>
    </Box>
  );
}
