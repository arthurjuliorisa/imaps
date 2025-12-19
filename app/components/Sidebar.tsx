'use client';

import React from 'react';
import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Box,
  Typography,
  Divider,
  alpha,
  useTheme,
  IconButton,
  useMediaQuery,
  Tooltip,
  ListSubheader,
} from '@mui/material';
import {
  Dashboard as DashboardIcon,
  Description as DescriptionIcon,
  Settings as SettingsIcon,
  Category as CategoryIcon,
  People as PeopleIcon,
  LocalShipping as LocalShippingIcon,
  AttachMoney as AttachMoneyIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  History as HistoryIcon,
} from '@mui/icons-material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';

const DRAWER_WIDTH = 280;
const DRAWER_WIDTH_COLLAPSED = 72;

interface MenuItem {
  title: string;
  icon: React.ReactNode;
  path: string;
}

interface MenuSection {
  title?: string;
  items: MenuItem[];
}

// Flattened menu structure with sections
const menuSections: MenuSection[] = [
  {
    items: [
      {
        title: 'Dashboard',
        icon: <DashboardIcon />,
        path: '/dashboard',
      },
    ],
  },
  {
    title: 'Master',
    items: [
      { title: 'Company', icon: <CategoryIcon />, path: '/master/companies' },
      { title: 'Item Type', icon: <CategoryIcon />, path: '/master/item-types' },
    ],
  },
  {
    title: 'Lap. per Dokumen',
    items: [
      {
        title: 'Pemasukan Barang',
        icon: <DescriptionIcon />,
        path: '/customs/incoming',
      },
      {
        title: 'Pengeluaran Barang',
        icon: <DescriptionIcon />,
        path: '/customs/outgoing',
      },
    ],
  },
  {
    title: 'LPJ Mutasi',
    items: [
      {
        title: 'Work in Progress',
        icon: <DescriptionIcon />,
        path: '/customs/wip',
      },
      {
        title: 'Bahan Baku/Penolong',
        icon: <DescriptionIcon />,
        path: '/customs/raw-material',
      },
      {
        title: 'Hasil Produksi',
        icon: <DescriptionIcon />,
        path: '/customs/production',
      },
      {
        title: 'Barang Scrap/Reject',
        icon: <DescriptionIcon />,
        path: '/customs/scrap',
      },
      {
        title: 'Barang Modal',
        icon: <DescriptionIcon />,
        path: '/customs/capital-goods',
      },
    ],
  },
  {
    title: 'Beginning Data',
    items: [
      {
        title: 'Beginning Data',
        icon: <DescriptionIcon />,
        path: '/customs/beginning-data',
      },
    ],
  },
  {
    title: 'Settings',
    items: [
      { title: 'User Management', icon: <PeopleIcon />, path: '/settings/users' },
      { title: 'Access Menu', icon: <SettingsIcon />, path: '/settings/access-menu' },
      { title: 'Log Activity', icon: <HistoryIcon />, path: '/settings/log-activity' },
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
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));

  const renderMenuItem = (item: MenuItem) => {
    const isActive = item.path === pathname;

    return (
      <Tooltip key={item.title} title={collapsed ? item.title : ''} placement="right">
        <ListItemButton
          component={Link}
          href={item.path}
          selected={isActive}
          sx={{
            pl: collapsed ? 1.5 : 2,
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

  const renderSectionDivider = (title: string) => {
    if (collapsed) {
      return (
        <Divider
          key={`divider-${title}`}
          sx={{
            my: 1.5,
            mx: 1,
            borderColor: theme.palette.divider,
          }}
        />
      );
    }

    return (
      <Divider
        key={`divider-${title}`}
        textAlign="left"
        sx={{
          my: 1.5,
          mx: 1,
          '&::before, &::after': {
            borderColor: theme.palette.divider,
          },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: theme.palette.text.secondary,
            fontWeight: 600,
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            px: 1,
          }}
        >
          {title}
        </Typography>
      </Divider>
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
          flexDirection: 'column',
          gap: 1,
        }}
      >
        {!collapsed ? (
          <>
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
          </>
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
          {menuSections.map((section, sectionIndex) => (
            <React.Fragment key={`section-${sectionIndex}`}>
              {section.title && renderSectionDivider(section.title)}
              {section.items.map((item) => renderMenuItem(item))}
            </React.Fragment>
          ))}
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
