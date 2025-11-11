'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { ThemeProvider as MuiThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import { getTheme } from '../theme/theme';
import EmotionRegistry from './EmotionRegistry';

type ThemeMode = 'light' | 'dark';

interface ThemeContextType {
  mode: ThemeMode;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: 'light',
  toggleTheme: () => {},
});

export const useThemeMode = () => useContext(ThemeContext);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('light');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const saved = localStorage.getItem('themeMode') as ThemeMode;
    if (saved) {
      setMode(saved);
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      setMode(prefersDark ? 'dark' : 'light');
    }
  }, []);

  const toggleTheme = () => {
    setMode((prevMode) => {
      const newMode = prevMode === 'light' ? 'dark' : 'light';
      localStorage.setItem('themeMode', newMode);
      return newMode;
    });
  };

  const theme = React.useMemo(() => getTheme(mode), [mode]);

  // Prevent flash by rendering a consistent state during hydration
  if (!mounted) {
    return (
      <EmotionRegistry options={{ key: 'mui' }}>
        <ThemeContext.Provider value={{ mode: 'light', toggleTheme }}>
          <MuiThemeProvider theme={getTheme('light')}>
            <CssBaseline />
            {children}
          </MuiThemeProvider>
        </ThemeContext.Provider>
      </EmotionRegistry>
    );
  }

  return (
    <EmotionRegistry options={{ key: 'mui' }}>
      <ThemeContext.Provider value={{ mode, toggleTheme }}>
        <MuiThemeProvider theme={theme}>
          <CssBaseline />
          {children}
        </MuiThemeProvider>
      </ThemeContext.Provider>
    </EmotionRegistry>
  );
}
