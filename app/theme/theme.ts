import { createTheme } from '@mui/material/styles';

// Create a sophisticated theme with Material Design 3 principles
export const getTheme = (mode: 'light' | 'dark') =>
  createTheme({
    palette: {
      mode,
      ...(mode === 'light'
        ? {
            // Light mode - Professional blue-based palette
            primary: {
              main: '#1e3a8a', // Deep blue
              light: '#3b82f6',
              dark: '#1e40af',
              contrastText: '#ffffff',
            },
            secondary: {
              main: '#7c3aed', // Purple accent
              light: '#a78bfa',
              dark: '#6d28d9',
              contrastText: '#ffffff',
            },
            success: {
              main: '#059669',
              light: '#10b981',
              dark: '#047857',
            },
            warning: {
              main: '#f59e0b',
              light: '#fbbf24',
              dark: '#d97706',
            },
            error: {
              main: '#dc2626',
              light: '#ef4444',
              dark: '#b91c1c',
            },
            info: {
              main: '#0891b2',
              light: '#06b6d4',
              dark: '#0e7490',
            },
            background: {
              default: '#f8fafc',
              paper: '#ffffff',
            },
            text: {
              primary: '#0f172a',
              secondary: '#64748b',
            },
            divider: 'rgba(0, 0, 0, 0.08)',
          }
        : {
            // Dark mode - Modern dark palette
            primary: {
              main: '#60a5fa', // Bright blue
              light: '#93c5fd',
              dark: '#3b82f6',
              contrastText: '#ffffff',
            },
            secondary: {
              main: '#a78bfa', // Light purple
              light: '#c4b5fd',
              dark: '#8b5cf6',
              contrastText: '#ffffff',
            },
            success: {
              main: '#10b981',
              light: '#34d399',
              dark: '#059669',
            },
            warning: {
              main: '#fbbf24',
              light: '#fcd34d',
              dark: '#f59e0b',
            },
            error: {
              main: '#ef4444',
              light: '#f87171',
              dark: '#dc2626',
            },
            info: {
              main: '#06b6d4',
              light: '#22d3ee',
              dark: '#0891b2',
            },
            background: {
              default: '#0f172a',
              paper: '#1e293b',
            },
            text: {
              primary: '#f1f5f9',
              secondary: '#94a3b8',
            },
            divider: 'rgba(255, 255, 255, 0.08)',
          }),
    },
    typography: {
      fontFamily: [
        'Inter',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ].join(','),
      h1: {
        fontSize: '2.5rem',
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: '-0.02em',
      },
      h2: {
        fontSize: '2rem',
        fontWeight: 700,
        lineHeight: 1.3,
        letterSpacing: '-0.01em',
      },
      h3: {
        fontSize: '1.75rem',
        fontWeight: 600,
        lineHeight: 1.3,
      },
      h4: {
        fontSize: '1.5rem',
        fontWeight: 600,
        lineHeight: 1.4,
      },
      h5: {
        fontSize: '1.25rem',
        fontWeight: 600,
        lineHeight: 1.5,
      },
      h6: {
        fontSize: '1.125rem',
        fontWeight: 600,
        lineHeight: 1.5,
      },
      subtitle1: {
        fontSize: '1rem',
        fontWeight: 500,
        lineHeight: 1.5,
      },
      subtitle2: {
        fontSize: '0.875rem',
        fontWeight: 500,
        lineHeight: 1.5,
      },
      body1: {
        fontSize: '1rem',
        lineHeight: 1.5,
      },
      body2: {
        fontSize: '0.875rem',
        lineHeight: 1.5,
      },
      button: {
        fontWeight: 600,
        letterSpacing: '0.02em',
      },
    },
    shape: {
      borderRadius: 12,
    },
    shadows: [
      'none',
      '0px 2px 4px rgba(0, 0, 0, 0.05)',
      '0px 4px 8px rgba(0, 0, 0, 0.06)',
      '0px 6px 12px rgba(0, 0, 0, 0.08)',
      '0px 8px 16px rgba(0, 0, 0, 0.1)',
      '0px 10px 20px rgba(0, 0, 0, 0.12)',
      '0px 12px 24px rgba(0, 0, 0, 0.14)',
      '0px 14px 28px rgba(0, 0, 0, 0.16)',
      '0px 16px 32px rgba(0, 0, 0, 0.18)',
      '0px 18px 36px rgba(0, 0, 0, 0.2)',
      '0px 20px 40px rgba(0, 0, 0, 0.22)',
      '0px 22px 44px rgba(0, 0, 0, 0.24)',
      '0px 24px 48px rgba(0, 0, 0, 0.26)',
      '0px 26px 52px rgba(0, 0, 0, 0.28)',
      '0px 28px 56px rgba(0, 0, 0, 0.3)',
      '0px 30px 60px rgba(0, 0, 0, 0.32)',
      '0px 32px 64px rgba(0, 0, 0, 0.34)',
      '0px 34px 68px rgba(0, 0, 0, 0.36)',
      '0px 36px 72px rgba(0, 0, 0, 0.38)',
      '0px 38px 76px rgba(0, 0, 0, 0.4)',
      '0px 40px 80px rgba(0, 0, 0, 0.42)',
      '0px 42px 84px rgba(0, 0, 0, 0.44)',
      '0px 44px 88px rgba(0, 0, 0, 0.46)',
      '0px 46px 92px rgba(0, 0, 0, 0.48)',
      '0px 48px 96px rgba(0, 0, 0, 0.5)',
    ],
    components: {
      MuiButton: {
        styleOverrides: {
          root: {
            textTransform: 'none',
            borderRadius: 10,
            padding: '10px 24px',
            fontWeight: 600,
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              transform: 'translateY(-2px)',
              boxShadow: '0px 8px 16px rgba(0, 0, 0, 0.1)',
            },
          },
          sizeLarge: {
            padding: '12px 32px',
            fontSize: '1rem',
          },
          sizeSmall: {
            padding: '6px 16px',
            fontSize: '0.875rem',
          },
        },
      },
      MuiPaper: {
        styleOverrides: {
          root: {
            borderRadius: 12,
            backgroundImage: 'none',
          },
          elevation1: {
            boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.05)',
          },
          elevation2: {
            boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.08)',
          },
          elevation3: {
            boxShadow: '0px 6px 16px rgba(0, 0, 0, 0.1)',
          },
        },
      },
      MuiCard: {
        styleOverrides: {
          root: {
            borderRadius: 16,
            transition: 'all 0.3s ease-in-out',
            '&:hover': {
              transform: 'translateY(-4px)',
              boxShadow: '0px 12px 24px rgba(0, 0, 0, 0.12)',
            },
          },
        },
      },
      MuiTextField: {
        styleOverrides: {
          root: {
            '& .MuiOutlinedInput-root': {
              borderRadius: 10,
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                '& .MuiOutlinedInput-notchedOutline': {
                  borderWidth: 2,
                },
              },
              '&.Mui-focused': {
                '& .MuiOutlinedInput-notchedOutline': {
                  borderWidth: 2,
                },
              },
            },
          },
        },
      },
      MuiChip: {
        styleOverrides: {
          root: {
            fontWeight: 500,
            borderRadius: 8,
          },
        },
      },
      MuiTableCell: {
        styleOverrides: {
          head: {
            fontWeight: 600,
            backgroundColor: mode === 'light' ? '#f8fafc' : '#0f172a',
          },
        },
      },
      MuiTooltip: {
        styleOverrides: {
          tooltip: {
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: '0.875rem',
          },
        },
      },
      MuiListItemButton: {
        styleOverrides: {
          root: {
            borderRadius: 10,
            margin: '4px 8px',
            transition: 'all 0.2s ease-in-out',
            '&:hover': {
              backgroundColor: mode === 'light' ? 'rgba(30, 58, 138, 0.08)' : 'rgba(96, 165, 250, 0.12)',
              transform: 'translateX(4px)',
            },
            '&.Mui-selected': {
              backgroundColor: mode === 'light' ? 'rgba(30, 58, 138, 0.12)' : 'rgba(96, 165, 250, 0.16)',
              '&:hover': {
                backgroundColor: mode === 'light' ? 'rgba(30, 58, 138, 0.16)' : 'rgba(96, 165, 250, 0.20)',
              },
            },
          },
        },
      },
      MuiAppBar: {
        styleOverrides: {
          root: {
            boxShadow: mode === 'light'
              ? '0px 1px 3px rgba(0, 0, 0, 0.05)'
              : '0px 1px 3px rgba(0, 0, 0, 0.2)',
          },
        },
      },
    },
  });
