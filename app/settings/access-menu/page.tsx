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
    let isMounted = true;

    const fetchData = async () => {
      await Promise.all([
        fetchMenus(isMounted),
        fetchUsers(isMounted)
      ]);
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (selectedUser) {
      fetchUserPermissions(selectedUser.id);
    } else {
      setPermissions({});
    }
  }, [selectedUser]);

  // Transform API response to MenuItem format with safety checks
  const mapMenuItems = (items: any[], depth = 0, visitedIds = new Set<string>()): MenuItem[] => {
    // Guard against non-array inputs
    if (!Array.isArray(items)) {
      console.warn('mapMenuItems received non-array input:', items);
      return [];
    }

    // Prevent stack overflow with max depth check
    if (depth > 10) {
      console.warn('Menu hierarchy exceeded maximum depth of 10');
      return [];
    }

    return items
      .filter((item) => {
        // Validate item structure
        if (!item || typeof item !== 'object') {
          console.warn('Skipping invalid menu item:', item);
          return false;
        }

        // Require id and name
        if (typeof item.id !== 'string' || !item.id) {
          console.warn('Skipping menu item with invalid id:', item);
          return false;
        }

        if (typeof item.name !== 'string' || !item.name) {
          console.warn('Skipping menu item with invalid name:', item);
          return false;
        }

        // Detect circular references
        if (visitedIds.has(item.id)) {
          console.warn(`Circular reference detected for menu id: ${item.id}`);
          return false;
        }

        return true;
      })
      .map((item) => {
        // Track visited IDs for circular reference detection
        const newVisited = new Set(visitedIds);
        newVisited.add(item.id);

        return {
          id: item.id,
          label: item.name,
          children: item.children && Array.isArray(item.children) && item.children.length > 0
            ? mapMenuItems(item.children, depth + 1, newVisited)
            : undefined,
        };
      });
  };

  const fetchMenus = async (isMounted: boolean = true) => {
    setMenusLoading(true);
    try {
      const response = await fetch('/api/settings/access-menu');

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: Failed to fetch menus`);
      }

      const data = await response.json();

      // Validate response
      if (!data) {
        throw new Error('Received null/undefined response from menu API');
      }

      // Handle wrapped or direct array responses
      const menuData = Array.isArray(data) ? data : (data.menus || data.data || []);

      if (!Array.isArray(menuData)) {
        console.error('Invalid menu API response format:', data);
        throw new Error('Menu API returned invalid data format');
      }

      // Transform with safety checks
      const transformedMenus = mapMenuItems(menuData);

      if (isMounted) {
        setMenuItems(transformedMenus);
      }
    } catch (err) {
      console.error('Error fetching menus:', err);
      if (isMounted) {
        toast.error(err instanceof Error ? err.message : 'Failed to load menu structure');
        setMenuItems([]);
      }
    } finally {
      if (isMounted) {
        setMenusLoading(false);
      }
    }
  };

  const fetchUsers = async (isMounted: boolean = true) => {
    setUsersLoading(true);
    try {
      const response = await fetch('/api/settings/users');
      if (!response.ok) throw new Error('Failed to fetch users');
      const data = await response.json();

      // Handle multiple API response formats: direct array, { data: [] }, { users: [] }
      const usersArray = Array.isArray(data) ? data : (data.data || data.users || []);
      const userOptions = usersArray.map((user: any) => ({
        id: user.id,
        label: user.username,
      }));

      if (isMounted) {
        setUsers(userOptions);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      if (isMounted) {
        toast.error('Failed to load users');
      }
    } finally {
      if (isMounted) {
        setUsersLoading(false);
      }
    }
  };

  const fetchUserPermissions = async (userId: string) => {
    try {
      const response = await fetch(`/api/settings/access-menu/user-permissions?userId=${userId}`);
      if (!response.ok) throw new Error('Failed to fetch user permissions');
      const data = await response.json();

      // Convert array of permissions to a map
      const permissionsMap: Record<string, boolean> = {};
      // Handle multiple API response formats: direct array, { data: [] }, { permissions: [] }
      const permissionsArray = Array.isArray(data) ? data : (data.data || data.permissions || []);
      permissionsArray.forEach((perm: Permission) => {
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
            onChange={(_event, newValue) => setSelectedUser(newValue)}
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

              <FormGroup>
                {menuItems.map((item) => (
                  <Box
                    key={item.id}
                    sx={{
                      mb: 2,
                      p: 2,
                      borderRadius: 2,
                      bgcolor: alpha(theme.palette.primary.main, 0.02),
                      border: `1px solid ${alpha(theme.palette.primary.main, 0.08)}`,
                    }}
                  >
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={permissions[item.id] || false}
                          onChange={() => handleTogglePermission(item.id)}
                          sx={{
                            '&.Mui-checked': {
                              color: theme.palette.primary.main,
                            },
                          }}
                        />
                      }
                      label={
                        <Typography
                          fontWeight={700}
                          fontSize="1.05rem"
                          color="primary"
                        >
                          {item.label}
                        </Typography>
                      }
                    />
                    {item.children && item.children.length > 0 && (
                      <Box
                        sx={{
                          pl: 4,
                          mt: 1.5,
                          pt: 1.5,
                          borderTop: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                        }}
                      >
                        <FormGroup>
                          {item.children.map((child) => (
                            <FormControlLabel
                              key={child.id}
                              control={
                                <Checkbox
                                  checked={permissions[child.id] || false}
                                  onChange={() => handleTogglePermission(child.id)}
                                  disabled={!permissions[item.id]}
                                  size="small"
                                  sx={{
                                    '&.Mui-checked': {
                                      color: theme.palette.primary.main,
                                    },
                                  }}
                                />
                              }
                              label={
                                <Typography
                                  fontSize="0.95rem"
                                  color={permissions[item.id] ? 'text.primary' : 'text.disabled'}
                                >
                                  {child.label}
                                </Typography>
                              }
                              sx={{ mb: 0.5 }}
                            />
                          ))}
                        </FormGroup>
                      </Box>
                    )}
                  </Box>
                ))}
              </FormGroup>

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
