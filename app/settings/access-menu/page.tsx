'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Paper,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Button,
  Alert,
  Stack,
  alpha,
  useTheme,
  Divider,
  Autocomplete,
  TextField,
} from '@mui/material';
import { Save } from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';

interface MenuItem {
  id: string;
  label: string;
  children?: MenuItem[];
}

interface UserOption {
  id: string;
  label: string;
}

interface Permission {
  menuId: string;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

export default function AccessMenuPage() {
  const theme = useTheme();
  const toast = useToast();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserOption | null>(null);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [menusLoading, setMenusLoading] = useState(true);
  const [usersLoading, setUsersLoading] = useState(true);

  useEffect(() => {
    fetchMenus();
    fetchUsers();
  }, []);

  useEffect(() => {
    if (selectedUser) {
      fetchUserPermissions(selectedUser.id);
    } else {
      setPermissions({});
    }
  }, [selectedUser]);

  const fetchMenus = async () => {
    setMenusLoading(true);
    try {
      const response = await fetch('/api/settings/access-menu');
      if (!response.ok) throw new Error('Failed to fetch menus');
      const data = await response.json();
      setMenuItems(data);
    } catch (err) {
      console.error('Error fetching menus:', err);
      toast.error('Failed to load menu structure');
    } finally {
      setMenusLoading(false);
    }
  };

  const fetchUsers = async () => {
    setUsersLoading(true);
    try {
      const response = await fetch('/api/settings/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();
      const userOptions = (data.users || data).map((user: any) => ({
        id: user.id,
        label: user.username,
      }));
      setUsers(userOptions);
    } catch (err) {
      console.error('Error fetching users:', err);
      toast.error('Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  };

  const fetchUserPermissions = async (userId: string) => {
    try {
      const response = await fetch(`/api/settings/access-menu/user-permissions?userId=${userId}`);
      if (!response.ok) throw new Error('Failed to fetch user permissions');
      const data = await response.json();

      // Convert array of permissions to a map
      const permissionsMap: Record<string, boolean> = {};
      data.forEach((perm: Permission) => {
        permissionsMap[perm.menuId] = perm.canView;
      });
      setPermissions(permissionsMap);
    } catch (err) {
      console.error('Error fetching user permissions:', err);
      toast.error('Failed to load user permissions');
      setPermissions({});
    }
  };

  const handleTogglePermission = (menuId: string) => {
    setPermissions((prev) => ({
      ...prev,
      [menuId]: !prev[menuId],
    }));
  };

  const handleSave = async () => {
    if (!selectedUser) {
      toast.error('Please select a user first');
      return;
    }

    setLoading(true);
    try {
      // Build permissions array from the map
      const permissionsArray: Permission[] = Object.keys(permissions).map((menuId) => ({
        menuId,
        canView: permissions[menuId],
        canCreate: permissions[menuId],
        canEdit: permissions[menuId],
        canDelete: permissions[menuId],
      }));

      const response = await fetch('/api/settings/access-menu/user-permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          permissions: permissionsArray,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Failed to save permissions');
      }

      toast.success(`Permissions updated successfully for ${selectedUser.label}!`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to save permissions';
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box>
      <Box
        sx={{
          mb: 3,
          pb: 2,
          borderBottom: `2px solid ${alpha(theme.palette.primary.main, 0.1)}`,
        }}
      >
        <Typography variant="h5" fontWeight="bold" color="primary">
          Access Menu Management
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Configure which menu items users can access
        </Typography>
      </Box>

      <Paper sx={{ p: 3 }}>
        <Stack spacing={3}>
          <Autocomplete
            fullWidth
            options={users}
            value={selectedUser}
            onChange={(event, newValue) => setSelectedUser(newValue)}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            loading={usersLoading}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select User"
                placeholder="Search users..."
              />
            )}
          />

          {selectedUser && (
            <>
              <Divider />
              <Typography variant="h6" fontWeight={600}>
                Menu Permissions
              </Typography>

              {menuItems.map((item) => (
                <Box key={item.id}>
                  <FormControlLabel
                    control={
                      <Checkbox
                        checked={permissions[item.id] || false}
                        onChange={() => handleTogglePermission(item.id)}
                      />
                    }
                    label={<Typography fontWeight={600}>{item.label}</Typography>}
                  />
                  {item.children && (
                    <Box sx={{ pl: 4 }}>
                      <FormGroup>
                        {item.children.map((child) => (
                          <FormControlLabel
                            key={child.id}
                            control={
                              <Checkbox
                                checked={permissions[child.id] || false}
                                onChange={() => handleTogglePermission(child.id)}
                                disabled={!permissions[item.id]}
                              />
                            }
                            label={child.label}
                          />
                        ))}
                      </FormGroup>
                    </Box>
                  )}
                </Box>
              ))}

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 3 }}>
                <Button
                  variant="contained"
                  startIcon={<Save />}
                  onClick={handleSave}
                  disabled={!selectedUser || loading || menusLoading}
                  sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    px: 4,
                  }}
                >
                  {loading ? 'Saving...' : 'Save Permissions'}
                </Button>
              </Box>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
