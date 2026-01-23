'use client';

import React, { useEffect, useState } from 'react';
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
  Recycling as RecyclingIcon,
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

interface ApiMenu {
  id: string;
  menuName: string;
  menuPath: string | null;
  menuIcon: string | null;
  parentId: string | null;
  menuOrder: number | null;
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
}

// Map icon name to icon component
const getIconComponent = (iconName: string | null): React.ReactNode => {
  if (!iconName) return <DescriptionIcon />;

  const iconMap: Record<string, React.ReactNode> = {
    Dashboard: <DashboardIcon />,
    Description: <DescriptionIcon />,
    Settings: <SettingsIcon />,
    Category: <CategoryIcon />,
    People: <PeopleIcon />,
    LocalShipping: <LocalShippingIcon />,
    AttachMoney: <AttachMoneyIcon />,
    History: <HistoryIcon />,
    Recycling: <RecyclingIcon />,
  };

  return iconMap[iconName] || <DescriptionIcon />;
};

// Flattened menu structure with sections (DEPRECATED - will be replaced by dynamic menus)
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
      { title: 'Scrap Master', icon: <RecyclingIcon />, path: '/master/scrap-items' },
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
    title: 'Transaksi',
    items: [
      {
        title: 'Transaksi Scrap',
        icon: <RecyclingIcon />,
        path: '/customs/scrap-transactions',
      },
      {
        title: 'Transaksi Barang Modal',
        icon: <DescriptionIcon />,
        path: '/customs/capital-goods-transactions',
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
  const [dynamicMenuSections, setDynamicMenuSections] = useState<MenuSection[]>([]);
  const [isLoadingMenus, setIsLoadingMenus] = useState(true);

  // Fetch user's accessible menus
  useEffect(() => {
    const fetchUserMenus = async () => {
      try {
        setIsLoadingMenus(true);
        const response = await fetch('/api/settings/access-menu/current-user-menus');

        if (!response.ok) {
          throw new Error('Failed to fetch menus');
        }

        const menus: ApiMenu[] = await response.json();

        // Group menus by parent
        const parentMenus = menus.filter((m) => m.parentId === null);
        const childMenus = menus.filter((m) => m.parentId !== null);

        // Build menu sections
        const sections: MenuSection[] = parentMenus.map((parent) => {
          // Get children of this parent
          const children = childMenus.filter((child) => child.parentId === parent.id);

          // If parent has a path, it's a standalone menu item
          if (parent.menuPath && children.length === 0) {
            return {
              items: [
                {
                  title: parent.menuName,
                  icon: getIconComponent(parent.menuIcon),
                  path: parent.menuPath,
                },
              ],
            };
          }

          // If parent has children, it's a section
          return {
            title: parent.menuName,
            items: children
              .filter((child) => child.menuPath !== null)
              .map((child) => ({
                title: child.menuName,
                icon: getIconComponent(child.menuIcon),
                path: child.menuPath!,
              })),
          };
        });

        setDynamicMenuSections(sections);
      } catch (error) {
        console.error('Error fetching user menus:', error);
        // Fallback to empty menus on error
        setDynamicMenuSections([]);
      } finally {
        setIsLoadingMenus(false);
      }
    };

    fetchUserMenus();
  }, []);

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
            borderRadius: 0,
            mx: 1,
            my: 0.25,
            justifyContent: collapsed ? 'center' : 'flex-start',
            color: '#ffffff',
            '&:hover': {
              bgcolor: '#409EFF',
            },
            '&.Mui-selected': {
              bgcolor: 'rgba(255, 255, 255, 0.15)',
              '& .MuiListItemIcon-root': {
                color: '#ffffff',
              },
              '& .MuiListItemText-primary': {
                fontWeight: 600,
                color: '#ffffff',
              },
              '&:hover': {
                bgcolor: '#409EFF',
              },
            },
          }}
        >
          <ListItemIcon
            sx={{
              minWidth: collapsed ? 'unset' : 40,
              color: '#ffffff',
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
                color: '#ffffff',
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
            borderColor: 'rgba(255, 255, 255, 0.2)',
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
            borderColor: 'rgba(255, 255, 255, 0.2)',
          },
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: 'rgba(255, 255, 255, 0.7)',
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
          minHeight: 64,
          height: 64,
          bgcolor: '#2B3346',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          position: 'relative',
        }}
      >
        {!collapsed ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box
              sx={{
                width: 56,
                height: 32,
                borderRadius: 0,
                bgcolor: 'rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '1.25rem',
                color: '#ffffff',
              }}
            >
              WMS
            </Box>
            <Box>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 700,
                  fontSize: '1rem',
                  color: '#ffffff',
                  lineHeight: 1.2,
                }}
              >
                - IT Inventory Report
              </Typography>
            </Box>
          </Box>
        ) : (
          <Box
            sx={{
              width: 56,
              height: 40,
              borderRadius: 0,
              bgcolor: 'rgba(255, 255, 255, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: '1.25rem',
              color: '#ffffff',
            }}
          >
            WMS
          </Box>
        )}
      </Toolbar>
      <Box sx={{ py: 2, overflowY: 'auto', overflowX: 'hidden', height: 'calc(100vh - 64px)', bgcolor: '#38425D' }}>
        <List component="nav" sx={{ px: collapsed ? 0.5 : 0.5 }}>
          {isLoadingMenus ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                Loading menus...
              </Typography>
            </Box>
          ) : dynamicMenuSections.length > 0 ? (
            dynamicMenuSections.map((section, sectionIndex) => (
              <React.Fragment key={`section-${sectionIndex}`}>
                {section.title && renderSectionDivider(section.title)}
                {section.items.map((item) => renderMenuItem(item))}
              </React.Fragment>
            ))
          ) : (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'rgba(255, 255, 255, 0.7)' }}>
                No menus available
              </Typography>
            </Box>
          )}
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
            borderRadius: 0,
            borderRight: '1px solid rgba(255, 255, 255, 0.1)',
            bgcolor: '#38425D',
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
            borderRadius: 0,
            borderRight: '1px solid rgba(255, 255, 255, 0.1)',
            bgcolor: '#38425D',
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
