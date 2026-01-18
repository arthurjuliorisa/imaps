'use client';

import React, { useState } from 'react';
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Box,
  Menu,
  MenuItem,
  Avatar,
  Divider,
  ListItemIcon,
  Breadcrumbs,
  Link as MuiLink,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import {
  Logout,
  NavigateNext,
  Menu as MenuIcon,
  Warehouse as WarehouseIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';
import { ThemeToggle } from './ThemeToggle';
import { signOut, useSession } from 'next-auth/react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

const DRAWER_WIDTH = 280;
const DRAWER_WIDTH_COLLAPSED = 72;

interface HeaderProps {
  onMenuClick: () => void;
  sidebarCollapsed: boolean;
  onToggleCollapse: () => void;
}

export function Header({ onMenuClick, sidebarCollapsed, onToggleCollapse }: HeaderProps) {
  const { data: session } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = (_event?: {}, _reason?: "escapeKeyDown" | "backdropClick") => {
    setAnchorEl(null);
  };

  const handleLogout = async () => {
    handleClose();
    await signOut({ redirect: false });
    router.push('/login');
  };

  // Generate breadcrumbs from pathname
  const pathSegments = pathname.split('/').filter(Boolean);
  const breadcrumbs = pathSegments.map((segment, index) => {
    const path = `/${pathSegments.slice(0, index + 1).join('/')}`;
    const label = segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, ' ');
    return { label, path };
  });

  const drawerWidth = isMobile ? 0 : (sidebarCollapsed ? DRAWER_WIDTH_COLLAPSED : DRAWER_WIDTH);

  return (
    <AppBar
      position="fixed"
      elevation={0}
      sx={{
        width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` },
        ml: { xs: 0, md: `${drawerWidth}px` },
        bgcolor: '#4a5568',
        color: '#ffffff',
        borderRadius: 0,
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
        transition: theme.transitions.create(['width', 'margin'], {
          easing: theme.transitions.easing.sharp,
          duration: theme.transitions.duration.enteringScreen,
        }),
      }}
    >
      <Toolbar>
        {isMobile && (
          <IconButton
            aria-label="open drawer"
            edge="start"
            onClick={onMenuClick}
            sx={{ mr: 2, color: '#ffffff' }}
          >
            <MenuIcon />
          </IconButton>
        )}

        {/* Collapse button and vTradEx branding - only show on desktop */}
        {!isMobile && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mr: 3 }}>
            <IconButton
              onClick={onToggleCollapse}
              sx={{
                bgcolor: 'rgba(255, 255, 255, 0.15)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: 0,
                width: 32,
                height: 32,
                color: '#ffffff',
                '&:hover': {
                  bgcolor: 'rgba(255, 255, 255, 0.25)',
                },
              }}
              size="small"
            >
              {sidebarCollapsed ? <ChevronRightIcon fontSize="small" /> : <ChevronLeftIcon fontSize="small" />}
            </IconButton>
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                fontSize: '0.875rem',
                color: '#ffffff',
                whiteSpace: 'nowrap',
              }}
            >
              IT Inventory Report
            </Typography>
          </Box>
        )}

        {/* Branding - only show on mobile */}
        {isMobile && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mr: 2 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 0,
                bgcolor: 'rgba(255, 255, 255, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 700,
                fontSize: '1.125rem',
                color: '#ffffff',
              }}
            >
              M
            </Box>
            <Typography
              variant="h6"
              sx={{
                fontWeight: 600,
                fontSize: '1rem',
                color: '#ffffff',
                whiteSpace: 'nowrap',
              }}
            >
              IT Inventory Report
            </Typography>
          </Box>
        )}

        <Box sx={{ flexGrow: 1 }}>
          <Breadcrumbs
            separator={<NavigateNext fontSize="small" sx={{ color: 'rgba(255, 255, 255, 0.7)' }} />}
            aria-label="breadcrumb"
          >
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return isLast ? (
                <Typography
                  key={crumb.path}
                  variant="body2"
                  sx={{
                    color: '#ffffff',
                    fontWeight: 600
                  }}
                >
                  {crumb.label}
                </Typography>
              ) : (
                <MuiLink
                  key={crumb.path}
                  component={Link}
                  href={crumb.path}
                  underline="hover"
                  sx={{
                    fontSize: '0.875rem',
                    color: 'rgba(255, 255, 255, 0.7)',
                    '&:hover': {
                      color: '#ffffff',
                    }
                  }}
                >
                  {crumb.label}
                </MuiLink>
              );
            })}
          </Breadcrumbs>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ThemeToggle />

          <IconButton onClick={handleMenu} sx={{ ml: 1 }}>
            <Avatar
              sx={{
                width: 36,
                height: 36,
                borderRadius: 0,
                bgcolor: 'rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                fontWeight: 600,
              }}
            >
              {session?.user?.name ? session.user.name.charAt(0).toUpperCase() : 'U'}
            </Avatar>
          </IconButton>

          <Menu
            anchorEl={anchorEl}
            open={Boolean(anchorEl)}
            onClose={handleClose}
            PaperProps={{
              sx: {
                mt: 1.5,
                minWidth: 200,
              },
            }}
          >
            <Box sx={{ px: 2, py: 1.5 }}>
              <Typography variant="subtitle2" fontWeight="bold">
                {session?.user?.name || 'User'}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {session?.user?.email || ''}
              </Typography>
            </Box>
            <Divider />
            <MenuItem onClick={handleLogout}>
              <ListItemIcon>
                <Logout fontSize="small" color="error" />
              </ListItemIcon>
              Logout
            </MenuItem>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
}
