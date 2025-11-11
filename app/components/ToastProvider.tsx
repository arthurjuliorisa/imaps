'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import Snackbar from '@mui/material/Snackbar';
import Alert from '@mui/material/Alert';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import InfoIcon from '@mui/icons-material/Info';
import WarningIcon from '@mui/icons-material/Warning';

type ToastSeverity = 'success' | 'error' | 'info' | 'warning';

interface ToastMessage {
  message: string;
  severity: ToastSeverity;
  id: number;
}

interface ToastContextType {
  showToast: (message: string, severity?: ToastSeverity) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

const iconMapping = {
  success: <CheckCircleIcon fontSize="inherit" />,
  error: <ErrorIcon fontSize="inherit" />,
  info: <InfoIcon fontSize="inherit" />,
  warning: <WarningIcon fontSize="inherit" />,
};

interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [currentToast, setCurrentToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((message: string, severity: ToastSeverity = 'info') => {
    const id = Date.now();
    const newToast: ToastMessage = { message, severity, id };

    setToasts((prev) => [...prev, newToast]);

    // If no toast is currently showing, display this one immediately
    if (!currentToast) {
      setCurrentToast(newToast);
    }
  }, [currentToast]);

  const success = useCallback((message: string) => {
    showToast(message, 'success');
  }, [showToast]);

  const error = useCallback((message: string) => {
    showToast(message, 'error');
  }, [showToast]);

  const info = useCallback((message: string) => {
    showToast(message, 'info');
  }, [showToast]);

  const warning = useCallback((message: string) => {
    showToast(message, 'warning');
  }, [showToast]);

  const handleClose = (event?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') {
      return;
    }
    setCurrentToast(null);
  };

  const handleExited = () => {
    // Remove the current toast from the queue
    setToasts((prev) => {
      const newToasts = prev.slice(1);
      // Show the next toast if available
      if (newToasts.length > 0) {
        setCurrentToast(newToasts[0]);
      }
      return newToasts;
    });
  };

  const contextValue: ToastContextType = {
    showToast,
    success,
    error,
    info,
    warning,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <Snackbar
        open={!!currentToast}
        autoHideDuration={5000}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
        TransitionProps={{
          onExited: handleExited,
        }}
      >
        {currentToast ? (
          <Alert
            onClose={handleClose}
            severity={currentToast.severity}
            variant="filled"
            icon={iconMapping[currentToast.severity]}
            sx={{
              width: '100%',
              minWidth: 300,
              boxShadow: (theme) => theme.shadows[8],
              '& .MuiAlert-icon': {
                fontSize: '1.5rem',
              },
            }}
          >
            {currentToast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
};
