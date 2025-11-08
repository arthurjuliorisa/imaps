'use client';

import React, { useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Button,
  Alert,
  Stack,
  alpha,
  useTheme,
  Divider,
} from '@mui/material';
import { Save } from '@mui/icons-material';

const menuItems = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'master', label: 'Master Data', children: [
    { id: 'master-item', label: 'Item' },
    { id: 'master-uom', label: 'UOM' },
    { id: 'master-currency', label: 'Currency' },
    { id: 'master-customers', label: 'Customers' },
    { id: 'master-supplier', label: 'Supplier' },
  ]},
  { id: 'customs', label: 'Customs Report', children: [
    { id: 'customs-incoming', label: 'Laporan Pemasukan Barang' },
    { id: 'customs-outgoing', label: 'Laporan Pengeluaran Barang' },
    { id: 'customs-raw-material', label: 'LPJ Mutasi Bahan Baku' },
    { id: 'customs-wip', label: 'LPJ Work In Progress' },
    { id: 'customs-production', label: 'LPJ Mutasi Hasil Produksi' },
    { id: 'customs-scrap', label: 'LPJ Mutasi Barang Scrap' },
    { id: 'customs-capital-goods', label: 'LPJ Mutasi Barang Modal' },
  ]},
  { id: 'settings', label: 'Settings', children: [
    { id: 'settings-users', label: 'User Management' },
    { id: 'settings-access-menu', label: 'Access Menu' },
  ]},
];

export default function AccessMenuPage() {
  const theme = useTheme();
  const [selectedUser, setSelectedUser] = useState('');
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [success, setSuccess] = useState(false);

  const handleTogglePermission = (menuId: string) => {
    setPermissions((prev) => ({
      ...prev,
      [menuId]: !prev[menuId],
    }));
  };

  const handleSave = () => {
    // In a real app, save to API
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
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
          {success && (
            <Alert severity="success" onClose={() => setSuccess(false)}>
              Permissions updated successfully!
            </Alert>
          )}

          <FormControl fullWidth>
            <InputLabel>Select User</InputLabel>
            <Select
              value={selectedUser}
              label="Select User"
              onChange={(e) => setSelectedUser(e.target.value)}
            >
              <MenuItem value="admin">Admin</MenuItem>
              <MenuItem value="user1">User 1</MenuItem>
              <MenuItem value="user2">User 2</MenuItem>
            </Select>
          </FormControl>

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
                  sx={{
                    borderRadius: 2,
                    textTransform: 'none',
                    px: 4,
                  }}
                >
                  Save Permissions
                </Button>
              </Box>
            </>
          )}
        </Stack>
      </Paper>
    </Box>
  );
}
