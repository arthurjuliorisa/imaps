'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Alert,
  Stack,
  alpha,
  useTheme,
  Chip,
  Autocomplete,
} from '@mui/material';
import { Add, Save, Close, VpnKey } from '@mui/icons-material';
import { DataTable, Column, ExtraAction } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';
import { useRouter } from 'next/navigation';

interface User {
  id: string;
  username: string;
  full_name: string;
  email: string;
  role: string;
  company_code?: number | null;
}

interface Company {
  id: number;
  code: number;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
}

const columns: Column[] = [
  { id: 'username', label: 'Username', minWidth: 150 },
  { id: 'email', label: 'Email', minWidth: 200 },
  {
    id: 'role',
    label: 'Role',
    minWidth: 120,
  },
];

export default function UsersPage() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    full_name: '',
    email: '',
    password: '',
    role: 'User',
    company_code: '',
  });
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companiesLoading, setCompaniesLoading] = useState(false);
  const [companyError, setCompanyError] = useState(false);

  useEffect(() => {
    fetchUsers();
    fetchCompanies();
  }, [page, searchQuery]);

  const fetchCompanies = async () => {
    setCompaniesLoading(true);
    try {
      const response = await fetch('/api/master/companies');
      if (!response.ok) throw new Error('Failed to fetch companies');
      const data = await response.json();
      setCompanies(data.success ? data.data : []);
    } catch (err) {
      console.error('Error fetching companies:', err);
      toast.error('Failed to load companies');
    } finally {
      setCompaniesLoading(false);
    }
  };

  const fetchUsers = async () => {
    setDataLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString(),
        ...(searchQuery && { search: searchQuery }),
      });

      const response = await fetch(`/api/settings/users?${params}`);
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      setUsers(Array.isArray(data) ? data : (data.data || data.users || []));
    } catch (err) {
      console.error('Error fetching users:', err);
      toast.error('Failed to load users');
    } finally {
      setDataLoading(false);
    }
  };

  const handleAdd = () => {
    setEditingUser(null);
    setFormData({ username: '', full_name: '', email: '', password: '', role: 'User', company_code: '' });
    setCompanyError(false);
    setDialogOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      password: '',
      role: user.role,
      company_code: user.company_code ? user.company_code.toString() : ''
    });
    setCompanyError(false);
    setDialogOpen(true);
  };

  const handleDelete = (user: User) => {
    setUserToDelete(user);
    setConfirmDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;

    setDeleteLoading(true);
    try {
      const response = await fetch(`/api/settings/users/${userToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to delete user');
      }

      await fetchUsers();
      toast.success(`User "${userToDelete.username}" deleted successfully!`);
      setConfirmDialogOpen(false);
      setUserToDelete(null);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to delete user';
      toast.error(errorMessage);
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleCancelDelete = () => {
    setConfirmDialogOpen(false);
    setUserToDelete(null);
  };
  const handleManageAccess = (user: User) => {
    router.push(`/settings/access-menu?userId=${user.id}&username=${encodeURIComponent(user.username)}`);
  };



  const extraActions: ExtraAction[] = [
    {
      icon: <VpnKey fontSize="small" />,
      label: 'Manage Access Menu',
      onClick: handleManageAccess,
      color: 'info',
    },
  ];

  const handleSave = async () => {
    // Validation
    if (!formData.username || !formData.full_name || !formData.email) {
      toast.error('Please fill in username, full name, and email');
      return;
    }

    // Company is required
    if (!formData.company_code) {
      setCompanyError(true);
      toast.error('Please select a company');
      return;
    }

    // For new users, password is required
    if (!editingUser && !formData.password) {
      toast.error('Password is required for new users');
      return;
    }

    setLoading(true);
    setError(null);
    setCompanyError(false);

    try {
      const url = editingUser
        ? `/api/settings/users/${editingUser.id}`
        : '/api/settings/users';

      // Build request body
      // When updating, only send password if it's not empty (user wants to change it)
      const body: any = {
        username: formData.username,
        full_name: formData.full_name,
        email: formData.email,
        role: formData.role,
        company_code: formData.company_code,
      };

      // Only include password if it's provided
      if (formData.password) {
        body.password = formData.password;
      }

      const response = await fetch(url, {
        method: editingUser ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to save user');
      }

      await fetchUsers();
      setDialogOpen(false);
      toast.success(editingUser ? 'User updated successfully!' : 'User created successfully!');
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save user';
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setLoading(false);
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
        <Typography variant="h5" fontWeight="bold" color="primary">
          User Management
        </Typography>
        <Button
          variant="contained"
          startIcon={<Add />}
          onClick={handleAdd}
          sx={{
            borderRadius: 2,
            textTransform: 'none',
            px: 3,
            boxShadow: 2,
          }}
        >
          Add User
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 3 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={users}
        loading={dataLoading}
        extraActions={extraActions}
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <Dialog
        open={dialogOpen}
        onClose={(_event, reason) => {
          if (loading) return;
          if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
          setDialogOpen(false);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editingUser ? 'Edit User' : 'Add New User'}
        </DialogTitle>
        <DialogContent>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
              {error}
            </Alert>
          )}
          <Stack spacing={2} sx={{ mt: 2 }}>
            <TextField
              label="Username"
              value={formData.username}
              onChange={(e) => setFormData({ ...formData, username: e.target.value })}
              required
              fullWidth
              disabled={loading}
            />
            <TextField
              label="Full Name"
              value={formData.full_name}
              onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
              required
              fullWidth
              disabled={loading}
            />
            <TextField
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              fullWidth
              disabled={loading}
            />
            <Autocomplete
              options={companies}
              getOptionLabel={(option) => `${option.code} - ${option.name}`}
              value={companies.find(c => c.code.toString() === formData.company_code) || null}
              onChange={(event, newValue) => {
                setFormData({ ...formData, company_code: newValue?.code.toString() || '' });
                setCompanyError(false);
              }}
              loading={companiesLoading}
              disabled={loading}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Company"
                  required
                  error={companyError}
                  helperText={companyError ? 'Please select a company' : ''}
                />
              )}
              isOptionEqualToValue={(option, value) => option.code === value.code}
            />
            <TextField
              label="Password"
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              required={!editingUser}
              fullWidth
              disabled={loading}
              placeholder={editingUser ? 'Enter new password (optional)' : 'Enter password'}
              helperText={editingUser ? 'Leave blank to keep current password. Password is hashed with bcrypt on the server.' : 'Password is hashed with bcrypt on the server.'}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} startIcon={<Close />} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} variant="contained" startIcon={<Save />} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDialogOpen}
        title="Delete User"
        message={`Are you sure you want to delete user "${userToDelete?.username}"? This action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        severity="error"
        loading={deleteLoading}
      />
    </Box>
  );
}
