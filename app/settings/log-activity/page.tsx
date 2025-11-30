'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Alert,
  alpha,
  useTheme,
  Chip,
  TextField,
  MenuItem,
  Stack,
  Card,
  CardContent,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Refresh, Download } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import dayjs from 'dayjs';

interface ActivityLog {
  id: string;
  userId: string;
  action: string;
  description: string;
  status: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  user: {
    username: string;
    email: string;
  };
}

const columns: Column[] = [
  {
    id: 'createdAt',
    label: 'Date & Time',
    minWidth: 180,
    format: (value: any) => dayjs(value).format('DD/MM/YYYY HH:mm:ss'),
  },
  {
    id: 'user',
    label: 'User',
    minWidth: 150,
    format: (value: any) => value?.username || 'Unknown',
  },
  {
    id: 'action',
    label: 'Action',
    minWidth: 200,
  },
  {
    id: 'description',
    label: 'Description',
    minWidth: 250,
  },
  {
    id: 'status',
    label: 'Status',
    minWidth: 120,
    format: (value: string) => {
      let color: 'success' | 'error' | 'warning' | 'info' = 'info';
      if (value === 'SUCCESS') color = 'success';
      else if (value === 'FAILED') color = 'error';
      else if (value === 'WARNING') color = 'warning';

      return (
        <Chip
          label={value}
          color={color}
          size="small"
          sx={{ fontWeight: 'bold' }}
        />
      );
    },
  },
  {
    id: 'ipAddress',
    label: 'IP Address',
    minWidth: 130,
    format: (value: any) => value || '-',
  },
];

export default function LogActivityPage() {
  const theme = useTheme();
  const toast = useToast();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    fetchLogs();
  }, [page, searchQuery, statusFilter]);

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...(searchQuery && { search: searchQuery }),
        ...(statusFilter !== 'ALL' && { status: statusFilter }),
      });

      const response = await fetch(`/api/settings/activity-logs?${params}`);
      if (!response.ok) throw new Error('Failed to fetch activity logs');

      const data = await response.json();
      setLogs(Array.isArray(data) ? data : (data.data || data.logs || []));
      setTotalCount(data.total || data.count || 0);
      setError(null);
    } catch (err) {
      console.error('Error fetching activity logs:', err);
      setError('Failed to load activity logs');
      toast.error('Failed to load activity logs');
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    fetchLogs();
    toast.success('Activity logs refreshed');
  };

  const handleExport = async () => {
    try {
      const params = new URLSearchParams({
        ...(searchQuery && { search: searchQuery }),
        ...(statusFilter !== 'ALL' && { status: statusFilter }),
        export: 'true',
      });

      const response = await fetch(`/api/settings/activity-logs?${params}`);
      if (!response.ok) throw new Error('Failed to export activity logs');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `activity-logs-${dayjs().format('YYYY-MM-DD')}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success('Activity logs exported successfully');
    } catch (err) {
      console.error('Error exporting activity logs:', err);
      toast.error('Failed to export activity logs');
    }
  };

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 3,
          pb: 2,
          borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Box>
          <Typography variant="h5" fontWeight="bold" color="primary">
            Log Activity
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Monitor system activities and user actions
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Tooltip title="Refresh">
            <IconButton onClick={handleRefresh} color="primary">
              <Refresh />
            </IconButton>
          </Tooltip>
          <Tooltip title="Export to CSV">
            <IconButton onClick={handleExport} color="primary">
              <Download />
            </IconButton>
          </Tooltip>
        </Stack>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card sx={{ mb: 3, boxShadow: 1 }}>
        <CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              label="Search"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search by action, description, or user..."
              size="small"
              fullWidth
              sx={{ maxWidth: { sm: 400 } }}
            />
            <TextField
              select
              label="Status"
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              size="small"
              sx={{ minWidth: 150 }}
            >
              <MenuItem value="ALL">All Status</MenuItem>
              <MenuItem value="SUCCESS">Success</MenuItem>
              <MenuItem value="FAILED">Failed</MenuItem>
              <MenuItem value="WARNING">Warning</MenuItem>
              <MenuItem value="INFO">Info</MenuItem>
            </TextField>
          </Stack>
        </CardContent>
      </Card>

      <DataTable
        columns={columns}
        data={logs}
        loading={loading}
        page={page}
        pageSize={pageSize}
        totalCount={totalCount}
        onPageChange={setPage}
        showActions={false}
      />
    </Box>
  );
}
