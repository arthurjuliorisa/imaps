'use client';

import React, { useState } from 'react';
import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  Toolbar,
  Box,
  Typography,
  Divider,
  alpha,
  useTheme,
  Chip,
  IconButton,
  useMediaQuery,
  Tooltip,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  ExpandLess,
  ExpandMore,
  Inventory as InventoryIcon,
  Description as DescriptionIcon,
  Settings as SettingsIcon,
  Category as CategoryIcon,
  People as PeopleIcon,
  Store as StoreIcon,
  LocalShipping as LocalShippingIcon,
  AttachMoney as AttachMoneyIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Menu as MenuIcon,
} from '@mui/icons-material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';

const DRAWER_WIDTH = 280;
const DRAWER_WIDTH_COLLAPSED = 72;

interface MenuItem {
  title: string;
  icon: React.ReactNode;
  path?: string;
  children?: MenuItem[];
}

const menuItems: MenuItem[] = [
  {
    title: 'Dashboard',
    icon: <DashboardIcon />,
    path: '/dashboard',
  },
  {
    title: 'Master',
    icon: <InventoryIcon />,
    children: [
      { title: 'Item', icon: <CategoryIcon />, path: '/master/item' },
      { title: 'UOM', icon: <CategoryIcon />, path: '/master/uom' },
      { title: 'Currency', icon: <AttachMoneyIcon />, path: '/master/currency' },
      { title: 'Customers', icon: <PeopleIcon />, path: '/master/customers' },
      { title: 'Supplier', icon: <LocalShippingIcon />, path: '/master/supplier' },
    ],
  },
  {
    title: 'Customs Report',
    icon: <DescriptionIcon />,
    children: [
      {
        title: 'Laporan Pemasukan Barang',
        icon: <DescriptionIcon />,
        path: '/customs/incoming',
      },
      {
        title: 'Laporan Pengeluaran Barang',
        icon: <DescriptionIcon />,
        path: '/customs/outgoing',
      },
      {
        title: 'LPJ Mutasi Bahan Baku',
        icon: <DescriptionIcon />,
        path: '/customs/raw-material',
      },
      {
        title: 'LPJ Work In Progress',
        icon: <DescriptionIcon />,
        path: '/customs/wip',
      },
      {
        title: 'LPJ Mutasi Hasil Produksi',
        icon: <DescriptionIcon />,
        path: '/customs/production',
      },
      {
        title: 'LPJ Mutasi Barang Scrap',
        icon: <DescriptionIcon />,
        path: '/customs/scrap',
      },
      {
        title: 'LPJ Mutasi Barang Modal',
        icon: <DescriptionIcon />,
        path: '/customs/capital-goods',
      },
    ],
  },
  {
    title: 'Settings',
    icon: <SettingsIcon />,
    children: [
      { title: 'User Management', icon: <PeopleIcon />, path: '/settings/users' },
      { title: 'Access Menu', icon: <SettingsIcon />, path: '/settings/access-menu' },
    ],
  },
];

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({ open, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const handleToggle = (title: string) => {
    setExpandedItems((prev) =>
      prev.includes(title) ? prev.filter((item) => item !== title) : [...prev, title]
    );
  };

  const renderMenuItem = (item: MenuItem, depth: number = 0) => {
    const isExpanded = expandedItems.includes(item.title);
    const isActive = item.path === pathname;

    if (item.children) {
      // In collapsed mode, don't show parent items with children
      if (collapsed && depth === 0) {
        return null;
      }

      return (
        <React.Fragment key={item.title}>
          <Tooltip title={collapsed ? item.title : ''} placement="right">
            <ListItemButton
              onClick={() => !collapsed && handleToggle(item.title)}
              sx={{
                pl: collapsed ? 1.5 : 2 + depth * 2,
                borderRadius: 1,
                mx: 1,
                my: 0.25,
                justifyContent: collapsed ? 'center' : 'flex-start',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: collapsed ? 'unset' : 40, color: isExpanded ? theme.palette.primary.main : 'inherit', justifyContent: 'center' }}>
                {item.icon}
              </ListItemIcon>
              {!collapsed && (
                <>
                  <ListItemText
                    primary={item.title}
                    primaryTypographyProps={{
                      fontWeight: isExpanded ? 600 : 500,
                      fontSize: '0.875rem',
                    }}
                  />
                  {isExpanded ? <ExpandLess /> : <ExpandMore />}
                </>
              )}
            </ListItemButton>
          </Tooltip>
          {!collapsed && (
            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
              <List component="div" disablePadding sx={{ py: 0.5 }}>
                {item.children.map((child) => renderMenuItem(child, depth + 1))}
              </List>
            </Collapse>
          )}
        </React.Fragment>
      );
    }

    return (
      <Tooltip key={item.title} title={collapsed ? item.title : ''} placement="right">
        <ListItemButton
          component={Link}
          href={item.path || '#'}
          selected={isActive}
          sx={{
            pl: collapsed ? 1.5 : 2 + depth * 2,
            borderRadius: 1,
            mx: 1,
            my: 0.25,
            justifyContent: collapsed ? 'center' : 'flex-start',
            '&:hover': {
              bgcolor: alpha(theme.palette.primary.main, 0.08),
            },
            '&.Mui-selected': {
              bgcolor: alpha(theme.palette.primary.main, 0.12),
              '& .MuiListItemIcon-root': {
                color: theme.palette.primary.main,
              },
              '& .MuiListItemText-primary': {
                fontWeight: 600,
                color: theme.palette.primary.main,
              },
              '&:hover': {
                bgcolor: alpha(theme.palette.primary.main, 0.16),
              },
            },
          }}
        >
          <ListItemIcon
            sx={{
              minWidth: collapsed ? 'unset' : 40,
              color: isActive ? theme.palette.primary.main : 'inherit',
              justifyContent: 'center',
            }}
          >
            {item.icon}
          </ListItemIcon>
          {!collapsed && (
            <ListItemText
              primary={item.title}
              primaryTypographyProps={{
                fontWeight: isActive ? 600 : 500,
                fontSize: '0.875rem',
              }}
            />
          )}
        </ListItemButton>
      </Tooltip>
    );
  };

  const drawerWidth = collapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH;

  const drawer = (
    <>
      <Toolbar
        sx={{
          px: collapsed ? 1 : 2.5,
          py: 2.5,
          bgcolor: 'white',
          borderBottom: `1px solid ${theme.palette.divider}`,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {!collapsed ? (
          <Image
            src="/logo.png"
            alt="iMAPS Logo"
            width={180}
            height={60}
            priority
            style={{
              objectFit: 'contain',
            }}
          />
        ) : (
          <Box
            sx={{
              width: 48,
              height: 48,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Image
              src="/logo.png"
              alt="iMAPS Logo"
              width={48}
              height={48}
              priority
              style={{
                objectFit: 'contain',
              }}
            />
          </Box>
        )}
        {!isMobile && (
          <IconButton
            onClick={onToggleCollapse}
            sx={{
              position: 'absolute',
              right: collapsed ? 12 : 8,
              top: '50%',
              transform: 'translateY(-50%)',
              bgcolor: 'background.paper',
              border: `1px solid ${theme.palette.divider}`,
              width: 24,
              height: 24,
              '&:hover': {
                bgcolor: 'action.hover',
              },
            }}
            size="small"
          >
            {collapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
          </IconButton>
        )}
      </Toolbar>
      <Box sx={{ py: 2, overflowY: 'auto', overflowX: 'hidden', height: 'calc(100vh - 88px)' }}>
        <List component="nav" sx={{ px: collapsed ? 0.5 : 0.5 }}>
          {menuItems.map((item) => renderMenuItem(item))}
        </List>
      </Box>
    </>
  );

  return (
    <>
      {/* Mobile Drawer */}
      <Drawer
        variant="temporary"
        open={open}
        onClose={onClose}
        ModalProps={{
          keepMounted: true, // Better mobile performance
        }}
        sx={{
          display: { xs: 'block', md: 'none' },
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: `1px solid ${theme.palette.divider}`,
            bgcolor: theme.palette.mode === 'light' ? '#ffffff' : 'background.paper',
          },
        }}
      >
        {drawer}
      </Drawer>

      {/* Desktop Drawer */}
      <Drawer
        variant="permanent"
        sx={{
          display: { xs: 'none', md: 'block' },
          width: drawerWidth,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: drawerWidth,
            boxSizing: 'border-box',
            borderRight: `1px solid ${theme.palette.divider}`,
            bgcolor: theme.palette.mode === 'light' ? '#ffffff' : 'background.paper',
            transition: theme.transitions.create('width', {
              easing: theme.transitions.easing.sharp,
              duration: theme.transitions.duration.enteringScreen,
            }),
          },
        }}
      >
        {drawer}
      </Drawer>
    </>
  );
}
