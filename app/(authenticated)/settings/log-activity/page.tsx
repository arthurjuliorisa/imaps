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
  companyCode?: number;
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

interface Company {
  code: number;
  name: string;
}

const columns: Column[] = [
  {
    id: 'createdAt',
    label: 'Date & Time',
    minWidth: 180,
    format: (value: any) => dayjs(value).format('MM/DD/YYYY HH:mm:ss'),
  },
  {
    id: 'companyCode',
    label: 'Company Code',
    minWidth: 120,
    format: (value: any) => value || '-',
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
    minWidth: 350,
    format: (value: string, row: any) => (
      <Box>
        <Typography variant="body2" fontWeight="600" color="text.primary">
          {value}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {row.description}
        </Typography>
      </Box>
    ),
  },
  {
    id: 'status',
    label: 'Status',
    minWidth: 120,
    format: (value: string) => {
      const upperValue = value?.toUpperCase() || '';
      let color: 'success' | 'error' | 'warning' | 'info' = 'info';
      if (upperValue === 'SUCCESS') color = 'success';
      else if (upperValue === 'FAILED') color = 'error';
      else if (upperValue === 'WARNING') color = 'warning';

      return (
        <Chip
          label={upperValue}
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
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [companyCodeFilter, setCompanyCodeFilter] = useState('ALL');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);

  useEffect(() => {
    fetchCompanies();
  }, []);

  useEffect(() => {
    setPage(0);
  }, [searchQuery, statusFilter, companyCodeFilter]);

  useEffect(() => {
    fetchLogs();
  }, [searchQuery, statusFilter, companyCodeFilter, page, rowsPerPage]);

  const fetchCompanies = async () => {
    try {
      const response = await fetch('/api/settings/companies');
      const data = await response.json();
      
      if (Array.isArray(data)) {
        setCompanies(data);
      }
    } catch (err) {
      console.error('Error fetching companies:', err);
    }
  };

  const fetchLogs = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page + 1),
        limit: String(rowsPerPage),
        ...(searchQuery && { search: searchQuery }),
        ...(statusFilter !== 'ALL' && { status: statusFilter }),
        ...(companyCodeFilter !== 'ALL' && { companyCode: companyCodeFilter }),
      });

      const response = await fetch(`/api/settings/activity-logs?${params}`);
      const result = await response.json();

      if (result.success && Array.isArray(result.data)) {
        setLogs(result.data);
        setError(null);
      } else {
        setLogs([]);
        setError(null);
      }
    } catch (err) {
      console.error('Error fetching activity logs:', err);
      setLogs([]);
      setError(null);
    } finally {
      setLoading(false);
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleRowsPerPageChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleRefresh = () => {
    fetchLogs();
    toast.success('Activity logs refreshed');
  };

  const handleExport = async () => {
    try {
      // Build export params
      const params = new URLSearchParams({
        format: 'xlsx', // ✅ New: Use Excel format (can also use 'csv')
        ...(searchQuery && { search: searchQuery }),
        ...(statusFilter !== 'ALL' && { status: statusFilter }),
        ...(companyCodeFilter !== 'ALL' && { companyCode: companyCodeFilter }),
      });

      // ✅ Show info toast
      toast.info('Preparing export... This may take a moment for large datasets.');

      const response = await fetch(`/api/settings/activity-logs/export?${params}`);
      
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || 'Failed to export activity logs');
      }

      // ✅ Get total rows from header for info
      const totalRows = response.headers.get('X-Total-Rows');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `activity-logs-${dayjs().format('YYYY-MM-DD')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      // ✅ Show success toast with row count
      const message = totalRows 
        ? `Activity logs exported successfully (${Number(totalRows).toLocaleString()} rows)`
        : 'Activity logs exported successfully';
      toast.success(message);
    } catch (err) {
      console.error('Error exporting activity logs:', err);
      const message = err instanceof Error ? err.message : 'Failed to export activity logs';
      toast.error(message);
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
          <Tooltip title="Export to Excel">
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
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by action, description, or user..."
              size="small"
              fullWidth
              sx={{ maxWidth: { sm: 400 } }}
            />
            <TextField
              select
              label="Company"
              value={companyCodeFilter}
              onChange={(e) => setCompanyCodeFilter(e.target.value)}
              size="small"
              sx={{ minWidth: 200 }}
            >
              <MenuItem value="ALL">All Companies</MenuItem>
              {companies.map((company) => (
                <MenuItem key={company.code} value={company.code.toString()}>
                  {company.code} - {company.name}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label="Status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
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
        searchable={false}
        pagination={{
          page,
          rowsPerPage,
          onPageChange: handlePageChange,
          onRowsPerPageChange: handleRowsPerPageChange,
          rowsPerPageOptions: [5, 10, 25, 50],
        }}
      />
    </Box>
  );
}
