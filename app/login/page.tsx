'use client';

import React, { useState } from 'react';
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
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        bgcolor: '#FAFAFA',
        flexDirection: { xs: 'column', md: 'row' },
      }}
    >
      {/* Left side - Illustration */}
      <Box
        sx={{
          flex: { xs: 'none', md: '1 1 58%' },
          position: 'relative',
          bgcolor: '#FFFFFF',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          p: 4,
          overflow: 'hidden',
          minHeight: { xs: '300px', md: '100vh' },
        }}
      >
          {/* Logo at top left */}
          <Box sx={{ position: 'absolute', top: 32, left: 32 }}>
            <Image
              src="/logo.png"
              alt="iMAPS Logo"
              width={180}
              height={60}
              priority
              style={{ objectFit: 'contain' }}
            />
          </Box>

          {/* Illustration area */}
          <Box
            sx={{
              width: '100%',
              maxWidth: 600,
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
                height: '500px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {/* Placeholder for illustration - you can replace with actual SVG or image */}
              <Box
                sx={{
                  width: '500px',
                  height: '300px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                }}
              >
                {/* Three people working illustration placeholder */}
                <Box
                  sx={{
                    width: '150px',
                    height: '200px',
                    bgcolor: '#FF8B7B',
                    borderRadius: '50% 50% 0 0',
                    opacity: 0.3,
                  }}
                />
                <Box
                  sx={{
                    width: '150px',
                    height: '200px',
                    bgcolor: '#FF8B7B',
                    borderRadius: '50% 50% 0 0',
                    opacity: 0.3,
                  }}
                />
                <Box
                  sx={{
                    width: '150px',
                    height: '200px',
                    bgcolor: '#FF8B7B',
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
                    width: '50px',
                    height: '50px',
                    border: '2px solid #E0E0E0',
                    borderRadius: '8px',
                    opacity: 0.5,
                    top: position.top,
                    left: position.left,
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
          p: { xs: 3, md: 6 },
          bgcolor: '#FAFAFA',
        }}
      >
          <Box sx={{ width: '100%', maxWidth: 450, px: 2 }}>
            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontWeight: 600,
                color: '#2C3E50',
                mb: 1,
              }}
            >
              Welcome to iMAPS for Ventora
            </Typography>
            <Typography
              variant="body2"
              sx={{
                color: '#7F8C8D',
                mb: 4,
              }}
            >
              Please sign-in to your account and start the using of this program
            </Typography>

            {error && (
              <Alert severity="error" sx={{ mb: 3 }}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <Stack spacing={2.5}>
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
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: 'white',
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
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      bgcolor: 'white',
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
                      sx={{ color: '#7F8C8D' }}
                    />
                  }
                  label={
                    <Typography variant="body2" color="text.secondary">
                      Remember Me
                    </Typography>
                  }
                />

                <Button
                  fullWidth
                  type="submit"
                  variant="contained"
                  size="large"
                  disabled={loading}
                  startIcon={loading ? <CircularProgress size={20} color="inherit" /> : <LockOutlined />}
                  sx={{
                    py: 1.5,
                    bgcolor: '#5865F2',
                    textTransform: 'uppercase',
                    fontWeight: 600,
                    '&:hover': {
                      bgcolor: '#4752C4',
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
