'use client';

import React from 'react';
import { Button } from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';

interface Props {
  role?: string;
  companyType: 'BZ' | 'SEZ' | null;
  status: 'OPEN' | 'TRANSMITTED_TO_INSW' | 'LOCKED';
  mixedStatus: boolean;
  disabled: boolean;
  onClick: () => void;
}

export function BeginningBalanceLockAction({ role, companyType, status, mixedStatus, disabled, onClick }: Props) {
  if (role !== 'ADMIN' || mixedStatus || status === 'LOCKED') return null;
  if (companyType !== 'BZ' && !(companyType === 'SEZ' && status === 'TRANSMITTED_TO_INSW')) return null;
  return (
    <Button variant="outlined" color="warning" startIcon={<LockIcon />} onClick={onClick}
      disabled={disabled} sx={{ textTransform: 'none', borderRadius: 2 }}>
      {companyType === 'BZ' ? 'Lock Beginning Balance' : 'Lock Saldo Awal'}
    </Button>
  );
}

export function beginningBalanceLockDialog(companyType: 'BZ' | 'SEZ' | null) {
  return companyType === 'BZ' ? {
    title: 'Lock Beginning Balance locally?',
    message: 'This permanently locks all active Beginning Balance rows for your company across all dates and item types in iMAPS, including rows outside the current filters. No data will be sent to INSW. No further creates, imports, edits or deletes will be allowed, including for Admin. There is no reopen action.',
    confirmText: 'Lock Beginning Balance',
  } : {
    title: 'Lock Saldo Awal?',
    message: 'Tindakan ini tidak dapat dibatalkan. Saldo Awal akan dikunci di INSW (Registrasi Final). Setelah dikunci, data tidak dapat diubah lagi.',
    confirmText: 'Lock Saldo Awal',
  };
}
