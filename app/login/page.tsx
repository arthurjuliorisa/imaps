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
  Checkbox,
  FormControlLabel,
} from '@mui/material';
import { Visibility, VisibilityOff, LockOutlined } from '@mui/icons-material';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function LoginPage() {
  const router = useRouter();
  const { status } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
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
        setError('Invalid email or password');
        setLoading(false);
      } else if (result?.ok) {
        // Keep loading true during redirect
        router.replace('/dashboard');
      } else {
        setError('Authentication failed. Please try again.');
        setLoading(false);
      }
    } catch (err) {
      console.error('Login error:', err);

      if (err instanceof Error) {
        if (err.message.includes('fetch')) {
          setError('Network error. Please check your connection.');
        } else {
          setError('An error occurred. Please try again.');
        }
      } else {
        setError('An unexpected error occurred.');
      }
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        bgcolor: 'background.default',
        flexDirection: { xs: 'column', md: 'row' },
      }}
    >
      {/* Left side - Illustration */}
      <Box
        sx={{
          flex: { xs: 'none', md: '1 1 58%' },
          position: 'relative',
          bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
          display: { xs: 'flex', sm: 'flex', md: 'flex' },
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 2, sm: 3, md: 4 },
          overflow: 'hidden',
          minHeight: { xs: '200px', sm: '250px', md: '100vh' },
        }}
      >
          {/* Logo at top left */}
          <Box sx={{
            position: 'absolute',
            top: { xs: 16, sm: 24, md: 32 },
            left: { xs: 16, sm: 24, md: 32 }
          }}>
            <Image
              src="/logo.png"
              alt="iMAPS Logo"
              width={210}
              height={62}
              priority
              style={{ objectFit: 'contain', height: 'auto', width: 'auto', maxWidth: '100%' }}
            />
          </Box>

          {/* Illustration area */}
          <Box
            sx={{
              width: '100%',
              maxWidth: { xs: '100%', sm: 500, md: 600 },
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
            }}
          >
            {/* Manufacturing/Business icons scattered around */}
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                height: { xs: '200px', sm: '350px', md: '500px' },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Placeholder for illustration - you can replace with actual SVG or image */}
              <Box
                sx={{
                  width: { xs: '100%', sm: '400px', md: '500px' },
                  height: { xs: '150px', sm: '250px', md: '300px' },
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: { xs: 1, sm: 1.5, md: 2 },
                }}
              >
                {/* Three people working illustration placeholder */}
                <Box
                  sx={{
                    width: { xs: '60px', sm: '100px', md: '150px' },
                    height: { xs: '100px', sm: '150px', md: '200px' },
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'primary.dark' : '#FF8B7B',
                    borderRadius: '50% 50% 0 0',
                    opacity: 0.3,
                  }}
                />
                <Box
                  sx={{
                    width: { xs: '60px', sm: '100px', md: '150px' },
                    height: { xs: '100px', sm: '150px', md: '200px' },
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'primary.dark' : '#FF8B7B',
                    borderRadius: '50% 50% 0 0',
                    opacity: 0.3,
                  }}
                />
                <Box
                  sx={{
                    width: { xs: '60px', sm: '100px', md: '150px' },
                    height: { xs: '100px', sm: '150px', md: '200px' },
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'primary.dark' : '#FF8B7B',
                    borderRadius: '50% 50% 0 0',
                    opacity: 0.3,
                  }}
                />
              </Box>

              {/* Scattered icon placeholders */}
              {[
                { top: '10%', left: '15%' },
                { top: '20%', left: '75%' },
                { top: '35%', left: '10%' },
                { top: '45%', left: '80%' },
                { top: '60%', left: '20%' },
                { top: '70%', left: '70%' },
                { top: '15%', left: '50%' },
                { top: '50%', left: '45%' },
                { top: '80%', left: '30%' },
                { top: '25%', left: '85%' },
                { top: '75%', left: '55%' },
                { top: '40%', left: '65%' },
              ].map((position, i) => (
                <Box
                  key={i}
                  sx={{
                    position: 'absolute',
                    width: { xs: '30px', sm: '40px', md: '50px' },
                    height: { xs: '30px', sm: '40px', md: '50px' },
                    border: (theme) => `2px solid ${theme.palette.mode === 'dark' ? theme.palette.grey[700] : '#E0E0E0'}`,
                    borderRadius: { xs: '6px', sm: '7px', md: '8px' },
                    opacity: 0.5,
                    top: position.top,
                    left: position.left,
                    display: { xs: i > 7 ? 'none' : 'block', sm: i > 9 ? 'none' : 'block', md: 'block' },
                  }}
                />
              ))}
            </Box>
          </Box>
      </Box>

      {/* Right side - Login form */}
      <Box
        sx={{
          flex: { xs: 'none', md: '1 1 42%' },
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: { xs: 3, sm: 4, md: 6 },
          bgcolor: 'background.default',
        }}
      >
          <Box sx={{
            width: '100%',
            maxWidth: { xs: '100%', sm: 420, md: 450 },
            px: { xs: 1, sm: 2 }
          }}>
            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontWeight: 600,
                color: (theme) => theme.palette.text.primary,
                mb: 1,
                fontSize: { xs: '1.5rem', sm: '1.75rem', md: '2.125rem' },
              }}
            >
              Welcome to iMAPS for Polygroup
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: (theme) => theme.palette.text.secondary,
                mb: { xs: 3, sm: 3.5, md: 4 },
                fontSize: { xs: '0.875rem', sm: '0.875rem', md: '0.875rem' },
              }}
            >
              Please sign-in to your account and start the using of this program
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: { xs: 2.5, sm: 3 } }}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <Stack spacing={{ xs: 2, sm: 2.5 }}>
                <TextField
                  fullWidth
                  label="Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  error={!!error && !email}
                  helperText={!!error && !email ? 'Email is required' : ''}
                  autoComplete="email"
                  autoFocus
                  InputLabelProps={{
                    sx: {
                      color: (theme) => theme.palette.text.primary,
                      fontSize: { xs: '0.875rem', sm: '1rem' },
                      '&.Mui-focused': {
                        color: (theme) => theme.palette.primary.main,
                      },
                    },
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'white',
                      fontSize: { xs: '0.875rem', sm: '1rem' },
                      minHeight: { xs: '48px', sm: '56px' },
                      '& input': {
                        color: (theme) => theme.palette.text.primary,
                        padding: { xs: '12px 14px', sm: '16.5px 14px' },
                      },
                      '& fieldset': {
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'rgba(0, 0, 0, 0.23)',
                      },
                      '&:hover fieldset': {
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'rgba(0, 0, 0, 0.87)',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: (theme) => theme.palette.primary.main,
                      },
                    },
                  }}
                />
                <TextField
                  fullWidth
                  label="Password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  InputLabelProps={{
                    sx: {
                      color: (theme) => theme.palette.text.primary,
                      fontSize: { xs: '0.875rem', sm: '1rem' },
                      '&.Mui-focused': {
                        color: (theme) => theme.palette.primary.main,
                      },
                    },
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'white',
                      fontSize: { xs: '0.875rem', sm: '1rem' },
                      minHeight: { xs: '48px', sm: '56px' },
                      '& input': {
                        color: (theme) => theme.palette.text.primary,
                        padding: { xs: '12px 14px', sm: '16.5px 14px' },
                      },
                      '& fieldset': {
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'rgba(0, 0, 0, 0.23)',
                      },
                      '&:hover fieldset': {
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'rgba(0, 0, 0, 0.87)',
                      },
                      '&.Mui-focused fieldset': {
                        borderColor: (theme) => theme.palette.primary.main,
                      },
                    },
                  }}
                  slotProps={{
                    input: {
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowPassword(!showPassword)}
                            edge="end"
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            tabIndex={0}
                            sx={{
                              minWidth: { xs: '44px', sm: '48px' },
                              minHeight: { xs: '44px', sm: '48px' },
                            }}
                          >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                />

                <FormControlLabel
                  control={
                    <Checkbox
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      color="primary"
                      sx={{
                        padding: { xs: '6px', sm: '9px' },
                      }}
                    />
                  }
                  label={
                    <Typography
                      variant="body2"
                      sx={{
                        color: (theme) => theme.palette.text.primary,
                        fontSize: { xs: '0.875rem', sm: '0.875rem' },
                      }}
                    >
                      Remember Me
                    </Typography>
                  }
                  sx={{
                    marginLeft: { xs: 0, sm: 0 },
                    '& .MuiFormControlLabel-label': {
                      paddingLeft: { xs: '4px', sm: '8px' },
                    },
                  }}
                />

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <LockOutlined />}
                  sx={{
                    py: { xs: 1.25, sm: 1.5 },
                    minHeight: { xs: '48px', sm: '52px' },
                    fontSize: { xs: '0.875rem', sm: '0.9375rem', md: '1rem' },
                    bgcolor: 'primary.main',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    '&:hover': {
                      bgcolor: 'primary.dark',
                    },
                  }}
                >
                  {loading ? 'Signing in...' : 'Login'}
                </Button>
              </Stack>
            </form>
          </Box>
      </Box>
    </Box>
  );
}
