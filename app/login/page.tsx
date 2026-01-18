'use client';

import React, { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Button,
  Typography,
  Alert,
  InputAdornment,
  IconButton,
  CircularProgress,
  Stack,
  Paper,
  MenuItem,
  Select,
  FormControl,
  Chip,
  Divider,
} from '@mui/material';
import { Visibility, VisibilityOff, PersonOutline, LockOutlined, Language, AdminPanelSettings, Engineering, Visibility as ViewIcon } from '@mui/icons-material';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [language, setLanguage] = useState('id');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Redirect if already authenticated
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/dashboard');
    }
  }, [status, router]);

  // Show loading while checking session
  if (status === 'loading') {
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        setError(language === 'id' ? 'Email atau password salah' : 'Invalid email or password');
        setLoading(false);
      } else if (result?.ok) {
        router.replace('/dashboard');
      } else {
        setError(language === 'id' ? 'Autentikasi gagal. Silakan coba lagi.' : 'Authentication failed. Please try again.');
        setLoading(false);
      }
    } catch (err) {
      console.error('Login error:', err);

      if (err instanceof Error) {
        if (err.message.includes('fetch')) {
          setError(language === 'id' ? 'Kesalahan jaringan. Silakan periksa koneksi Anda.' : 'Network error. Please check your connection.');
        } else {
          setError(language === 'id' ? 'Terjadi kesalahan. Silakan coba lagi.' : 'An error occurred. Please try again.');
        }
      } else {
        setError(language === 'id' ? 'Terjadi kesalahan yang tidak terduga.' : 'An unexpected error occurred.');
      }
      setLoading(false);
    }
  };

  // Quick login helper for development
  const quickLogin = (userEmail: string, userPassword: string) => {
    setEmail(userEmail);
    setPassword(userPassword);
  };

  // Development credentials
  const devCredentials = [
    {
      role: 'Admin',
      email: 'admin@harmoni.co.id',
      password: 'admin123',
      icon: <AdminPanelSettings fontSize="small" />,
      color: 'error' as const,
    },
    {
      role: 'WMS API',
      email: 'wms@harmoni.co.id',
      password: 'wms123',
      icon: <Engineering fontSize="small" />,
      color: 'primary' as const,
    },
    {
      role: 'User',
      email: 'user@harmoni.co.id',
      password: 'user123',
      icon: <ViewIcon fontSize="small" />,
      color: 'success' as const,
    },
  ];

  const isDevelopment = process.env.NODE_ENV === 'development';

  return (
    <Box
      sx={{
        minHeight: '100vh',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#1a1a1a',
        overflow: 'hidden',
      }}
    >
      {/* Full-screen warehouse background with dark overlay */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundImage: 'url(https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?q=80&w=2070)',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0, 0, 0, 0.65)',
          },
        }}
      />

      {/* Main content container */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          flex: 1,
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          p: { xs: 2, sm: 3, md: 4 },
        }}
      >
        {/* Left side - Branding text */}
        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: { xs: 'center', md: 'flex-start' },
            pl: { xs: 0, md: 8, lg: 12 },
            py: { xs: 4, md: 0 },
          }}
        >
          <Box>
            <Typography
              sx={{
                fontSize: { xs: '2rem', sm: '2.8rem', md: '3.6rem', lg: '4rem' },
                fontWeight: 700,
                color: 'white',
                lineHeight: 1.2,
                mb: 2,
                textShadow: '0 4px 12px rgba(0,0,0,0.5), 0 2px 4px rgba(0,0,0,0.3)',
                letterSpacing: '0.02em',
              }}
            >
              唯智仓库管理系统
            </Typography>
            <Typography
              sx={{
                fontSize: { xs: '1rem', sm: '1.2rem', md: '1.4rem', lg: '1.6rem' },
                fontWeight: 500,
                color: 'rgba(255, 255, 255, 0.95)',
                textShadow: '0 2px 8px rgba(0,0,0,0.4)',
                letterSpacing: '0.05em',
              }}
            >
              vTradEx Warehouse Management System
            </Typography>
          </Box>
        </Box>

        {/* Right side - Floating login box (positioned at center right, aligned with vTradEx text) */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            pr: { xs: 0, md: 8, lg: 12 },
          }}
        >
          <Paper
            elevation={8}
            sx={{
              width: { xs: '100%', sm: 336, md: 360 },
              p: { xs: 2.5, sm: 3.5 },
              bgcolor: 'white',
              borderRadius: 0,
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            <Typography
              variant="h6"
              component="h1"
              sx={{
                fontWeight: 600,
                color: 'text.primary',
                mb: 2.5,
                textAlign: 'center',
                fontSize: { xs: '1rem', sm: '1.1rem' },
              }}
            >
              Halaman Login
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 2.5 }}>
                {error}
              </Alert>
            )}

            {/* Development Credentials - Only show in development mode */}
            {isDevelopment && (
              <Paper
                elevation={0}
                sx={{
                  mb: 2.5,
                  p: 1.5,
                  bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                  border: (theme) => `1px solid ${theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200]}`,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1.5 }}>
                  <Chip
                    label="DEV"
                    size="small"
                    color="warning"
                    sx={{ fontWeight: 600, fontSize: '0.7rem', height: 20 }}
                  />
                  <Typography
                    variant="caption"
                    sx={{
                      ml: 1,
                      color: 'text.secondary',
                      fontWeight: 500,
                      fontSize: '0.7rem',
                    }}
                  >
                    Quick Login
                  </Typography>
                </Box>

                <Stack spacing={1}>
                  {devCredentials.map((cred) => (
                    <Box
                      key={cred.role}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        p: 1,
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'background.paper' : 'white',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.mode === 'dark' ? theme.palette.grey[800] : theme.palette.grey[200]}`,
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                        <Box
                          sx={{
                            width: 28,
                            height: 28,
                            borderRadius: 0.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            bgcolor: `${cred.color}.main`,
                            color: 'white',
                          }}
                        >
                          {cred.icon}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 600,
                              color: 'text.primary',
                              fontSize: '0.75rem',
                            }}
                          >
                            {cred.role}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{
                              color: 'text.secondary',
                              display: 'block',
                              fontSize: '0.65rem',
                            }}
                          >
                            {cred.email}
                          </Typography>
                        </Box>
                      </Box>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => quickLogin(cred.email, cred.password)}
                        sx={{
                          minWidth: 50,
                          fontSize: '0.7rem',
                          textTransform: 'none',
                          borderColor: `${cred.color}.main`,
                          color: `${cred.color}.main`,
                          py: 0.5,
                          px: 1.5,
                          '&:hover': {
                            borderColor: `${cred.color}.dark`,
                            bgcolor: `${cred.color}.50`,
                          },
                        }}
                      >
                        Use
                      </Button>
                    </Box>
                  ))}
                </Stack>

                <Divider sx={{ my: 1 }} />

                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.disabled',
                    fontSize: '0.65rem',
                    display: 'block',
                    textAlign: 'center',
                  }}
                >
                  Development mode only
                </Typography>
              </Paper>
            )}

            <form onSubmit={handleSubmit}>
              <Stack spacing={2}>
                <TextField
                  fullWidth
                  label={language === 'id' ? 'Email' : 'Email'}
                  type="text"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="username"
                  autoFocus
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <PersonOutline sx={{ color: 'action.active' }} />
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: 'grey.50',
                      fontSize: '0.875rem',
                    },
                    '& .MuiInputLabel-root': {
                      fontSize: '0.875rem',
                    },
                  }}
                />

                <TextField
                  fullWidth
                  label={language === 'id' ? 'Password' : 'Password'}
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockOutlined sx={{ color: 'action.active' }} />
                      </InputAdornment>
                    ),
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton
                          onClick={() => setShowPassword(!showPassword)}
                          edge="end"
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                        >
                          {showPassword ? <VisibilityOff /> : <Visibility />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: 'grey.50',
                      fontSize: '0.875rem',
                    },
                    '& .MuiInputLabel-root': {
                      fontSize: '0.875rem',
                    },
                  }}
                />

                <FormControl fullWidth>
                  <Select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    startAdornment={
                      <InputAdornment position="start">
                        <Language sx={{ color: 'action.active', ml: 1 }} />
                      </InputAdornment>
                    }
                    sx={{
                      bgcolor: 'grey.50',
                      fontSize: '0.875rem',
                    }}
                  >
                    <MenuItem value="id">Bahasa Indonesia</MenuItem>
                    <MenuItem value="en">English</MenuItem>
                  </Select>
                </FormControl>

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="medium"
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={16} color="inherit" /> : null}
                  sx={{
                    py: 1.2,
                    bgcolor: '#1976d2',
                    textTransform: 'none',
                    fontSize: '0.875rem',
                    fontWeight: 600,
                    '&:hover': {
                      bgcolor: '#1565c0',
                    },
                  }}
                >
                  {loading ? (language === 'id' ? 'Masuk...' : 'Signing in...') : (language === 'id' ? 'Masuk' : 'Sign In')}
                </Button>
              </Stack>
            </form>
          </Paper>
        </Box>
      </Box>

      {/* Footer */}
      <Box
        sx={{
          position: 'relative',
          zIndex: 1,
          py: 2,
          px: 4,
          bgcolor: 'rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(10px)',
        }}
      >
        <Typography
          variant="body2"
          sx={{
            color: 'rgba(255, 255, 255, 0.8)',
            textAlign: 'center',
            fontSize: '0.875rem',
          }}
        >
          © {new Date().getFullYear()} vTradEx Warehouse Management System. All rights reserved.
        </Typography>
      </Box>
    </Box>
  );
}
