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
} from '@mui/material';
import { Add, Save, Close } from '@mui/icons-material';
import { DataTable, Column } from '@/app/components/DataTable';
import { useToast } from '@/app/components/ToastProvider';
import { ConfirmDialog } from '@/app/components/ConfirmDialog';

interface User {
  id: string;
  username: string;
  email: string;
  role: string;
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
  const toast = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    role: 'User',
  });
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(10);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchUsers();
  }, [page, searchQuery]);

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
    setFormData({ username: '', email: '', password: '', role: 'User' });
    setDialogOpen(true);
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData({ username: user.username, email: user.email, password: '', role: user.role });
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

  const handleSave = async () => {
    // Validation
    if (!formData.username || !formData.email) {
      toast.error('Please fill in username and email');
      return;
    }

    // For new users, password is required
    if (!editingUser && !formData.password) {
      toast.error('Password is required for new users');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const url = editingUser
        ? `/api/settings/users/${editingUser.id}`
        : '/api/settings/users';

      // Build request body
      // When updating, only send password if it's not empty (user wants to change it)
      const body: any = {
        username: formData.username,
        email: formData.email,
        role: formData.role,
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
        onEdit={handleEdit}
        onDelete={handleDelete}
      />

      <Dialog open={dialogOpen} onClose={() => !loading && setDialogOpen(false)} maxWidth="sm" fullWidth>
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
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              required
              fullWidth
              disabled={loading}
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
