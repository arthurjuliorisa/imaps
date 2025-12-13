'use client';

import React from 'react';
import { Chip, ChipProps } from '@mui/material';
import {
  CheckCircle as ApprovedIcon,
  Cancel as RejectedIcon,
  Schedule as PendingIcon,
  Description as DraftIcon,
  Block as CancelledIcon,
  Done as CompletedIcon,
  Inventory as AvailableIcon,
  Lock as ReservedIcon,
  Warning as QuarantineIcon,
  Report as BlockedIcon,
  EventBusy as ExpiredIcon,
  ArrowCircleDown as InboundIcon,
  ArrowCircleUp as OutboundIcon,
  SwapVert as AdjustmentIcon,
} from '@mui/icons-material';
import {
  DocumentStatus,
  StockStatus,
  TransactionType,
  AdjustmentType,
} from '@/types/stock-calculation';

/**
 * Status Badge Props
 */
export interface StatusBadgeProps extends Omit<ChipProps, 'label'> {
  status:
    | DocumentStatus
    | StockStatus
    | TransactionType
    | AdjustmentType
    | string;
  size?: 'small' | 'medium';
  showIcon?: boolean;
  variant?: 'filled' | 'outlined';
}

/**
 * Status Configuration
 */
interface StatusConfig {
  label: string;
  color:
    | 'default'
    | 'primary'
    | 'secondary'
    | 'error'
    | 'warning'
    | 'info'
    | 'success';
  icon?: React.ReactElement;
  bgcolor?: string;
  textColor?: string;
}

/**
 * Status Configuration Map
 */
const statusConfigs: Record<string, StatusConfig> = {
  // Document Status
  DRAFT: {
    label: 'Draft',
    color: 'default',
    icon: <DraftIcon />,
    bgcolor: '#e0e0e0',
    textColor: '#616161',
  },
  PENDING: {
    label: 'Pending',
    color: 'warning',
    icon: <PendingIcon />,
    bgcolor: '#fff4e5',
    textColor: '#ed6c02',
  },
  APPROVED: {
    label: 'Approved',
    color: 'success',
    icon: <ApprovedIcon />,
    bgcolor: '#e8f5e9',
    textColor: '#2e7d32',
  },
  REJECTED: {
    label: 'Rejected',
    color: 'error',
    icon: <RejectedIcon />,
    bgcolor: '#ffebee',
    textColor: '#d32f2f',
  },
  CANCELLED: {
    label: 'Cancelled',
    color: 'error',
    icon: <CancelledIcon />,
    bgcolor: '#ffebee',
    textColor: '#d32f2f',
  },
  COMPLETED: {
    label: 'Completed',
    color: 'success',
    icon: <CompletedIcon />,
    bgcolor: '#e8f5e9',
    textColor: '#2e7d32',
  },

  // Stock Status
  AVAILABLE: {
    label: 'Available',
    color: 'success',
    icon: <AvailableIcon />,
    bgcolor: '#e8f5e9',
    textColor: '#2e7d32',
  },
  RESERVED: {
    label: 'Reserved',
    color: 'info',
    icon: <ReservedIcon />,
    bgcolor: '#e3f2fd',
    textColor: '#1976d2',
  },
  QUARANTINE: {
    label: 'Quarantine',
    color: 'warning',
    icon: <QuarantineIcon />,
    bgcolor: '#fff4e5',
    textColor: '#ed6c02',
  },
  BLOCKED: {
    label: 'Blocked',
    color: 'error',
    icon: <BlockedIcon />,
    bgcolor: '#ffebee',
    textColor: '#d32f2f',
  },
  EXPIRED: {
    label: 'Expired',
    color: 'error',
    icon: <ExpiredIcon />,
    bgcolor: '#ffebee',
    textColor: '#d32f2f',
  },

  // Transaction Type
  IN: {
    label: 'Inbound',
    color: 'success',
    icon: <InboundIcon />,
    bgcolor: '#e8f5e9',
    textColor: '#2e7d32',
  },
  OUT: {
    label: 'Outbound',
    color: 'error',
    icon: <OutboundIcon />,
    bgcolor: '#ffebee',
    textColor: '#d32f2f',
  },
  ADJUSTMENT: {
    label: 'Adjustment',
    color: 'warning',
    icon: <AdjustmentIcon />,
    bgcolor: '#fff4e5',
    textColor: '#ed6c02',
  },
  TRANSFER: {
    label: 'Transfer',
    color: 'info',
    icon: <AdjustmentIcon />,
    bgcolor: '#e3f2fd',
    textColor: '#1976d2',
  },

  // Adjustment Type
  OPNAME: {
    label: 'Opname',
    color: 'info',
    bgcolor: '#e3f2fd',
    textColor: '#1976d2',
  },
  CORRECTION: {
    label: 'Correction',
    color: 'warning',
    bgcolor: '#fff4e5',
    textColor: '#ed6c02',
  },
  SCRAP: {
    label: 'Scrap',
    color: 'error',
    bgcolor: '#ffebee',
    textColor: '#d32f2f',
  },
  DAMAGE: {
    label: 'Damage',
    color: 'error',
    bgcolor: '#ffebee',
    textColor: '#d32f2f',
  },
  FOUND: {
    label: 'Found',
    color: 'success',
    bgcolor: '#e8f5e9',
    textColor: '#2e7d32',
  },
  LOST: {
    label: 'Lost',
    color: 'error',
    bgcolor: '#ffebee',
    textColor: '#d32f2f',
  },
  CONVERSION: {
    label: 'Conversion',
    color: 'info',
    bgcolor: '#e3f2fd',
    textColor: '#1976d2',
  },
  SYSTEM: {
    label: 'System',
    color: 'default',
    bgcolor: '#f5f5f5',
    textColor: '#757575',
  },
};

/**
 * StatusBadge Component
 *
 * A versatile badge component for displaying status with:
 * - Color-coded status indicators
 * - Optional icons
 * - Support for various status types (Document, Stock, Transaction, Adjustment)
 * - Consistent styling
 * - Customizable size and variant
 *
 * Usage:
 * ```tsx
 * <StatusBadge status="APPROVED" showIcon />
 * <StatusBadge status="PENDING" size="small" />
 * <StatusBadge status="AVAILABLE" variant="outlined" />
 * ```
 */
export default function StatusBadge({
  status,
  size = 'small',
  showIcon = true,
  variant = 'filled',
  sx,
  ...otherProps
}: StatusBadgeProps) {
  const config = statusConfigs[status] || {
    label: status,
    color: 'default' as const,
    bgcolor: '#e0e0e0',
    textColor: '#616161',
  };

  return (
    <Chip
      label={config.label}
      size={size}
      variant={variant}
      icon={showIcon && config.icon ? config.icon : undefined}
      sx={{
        fontWeight: 600,
        letterSpacing: 0.5,
        ...(variant === 'filled' && {
          bgcolor: config.bgcolor,
          color: config.textColor,
          '& .MuiChip-icon': {
            color: config.textColor,
          },
        }),
        ...(variant === 'outlined' && {
          borderColor: config.textColor,
          color: config.textColor,
          '& .MuiChip-icon': {
            color: config.textColor,
          },
        }),
        ...sx,
      }}
      {...otherProps}
    />
  );
}

/**
 * Document Status Badge
 * Convenience component specifically for document status
 */
export function DocumentStatusBadge({
  status,
  ...props
}: Omit<StatusBadgeProps, 'status'> & { status: DocumentStatus }) {
  return <StatusBadge status={status} {...props} />;
}

/**
 * Stock Status Badge
 * Convenience component specifically for stock status
 */
export function StockStatusBadge({
  status,
  ...props
}: Omit<StatusBadgeProps, 'status'> & { status: StockStatus }) {
  return <StatusBadge status={status} {...props} />;
}

/**
 * Transaction Type Badge
 * Convenience component specifically for transaction type
 */
export function TransactionTypeBadge({
  type,
  ...props
}: Omit<StatusBadgeProps, 'status'> & { type: TransactionType }) {
  return <StatusBadge status={type} {...props} />;
}

/**
 * Adjustment Type Badge
 * Convenience component specifically for adjustment type
 */
export function AdjustmentTypeBadge({
  type,
  ...props
}: Omit<StatusBadgeProps, 'status'> & { type: AdjustmentType }) {
  return <StatusBadge status={type} {...props} />;
}
