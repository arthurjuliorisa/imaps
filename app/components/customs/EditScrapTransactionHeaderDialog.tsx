'use client';

import { useEffect, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Stack, TextField } from '@mui/material';
import { useToast } from '@/app/components/ToastProvider';
import { SCRAP_CUSTOMS_TYPES } from '@/lib/validators/constants/customs-document-types';
import type { ScrapTransaction } from '@/types/transaction';

type Props = { open: boolean; transaction: ScrapTransaction | null; onClose: () => void; onSuccess: () => void };

/** Header-only editor. Line quantities, amounts and identity belong exclusively
 * to Edit Item, which keeps multi-line document mutations unambiguous. */
export function EditScrapTransactionHeaderDialog({ open, transaction, onClose, onSuccess }: Props) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ transactionNumber: '', ppkekNumber: '', registrationDate: '', customsDocumentType: '', recipientName: '', remarks: '' });
  const isOutgoing = transaction?.transactionType === 'OUT';

  useEffect(() => {
    if (open && transaction) setForm({
      transactionNumber: transaction.transactionNumber || transaction.docNumber || '',
      ppkekNumber: transaction.ppkekNumber || '',
      registrationDate: transaction.regDate ? String(transaction.regDate).slice(0, 10) : '',
      customsDocumentType: transaction.transactionType === 'OUT' ? (transaction.customsDocumentType || transaction.docType || '') : '',
      recipientName: transaction.transactionType === 'OUT' ? (transaction.recipientName || '') : '', remarks: transaction.remarks || '',
    });
  }, [open, transaction]);

  const update = (field: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement>) => setForm(current => ({ ...current, [field]: event.target.value }));
  const submit = async () => {
    if (!transaction) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/customs/scrap-transactions/${transaction.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, scope: 'header', registrationDate: form.registrationDate || null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Failed to update transaction');
      toast.success('Transaction header updated successfully'); onSuccess(); onClose();
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Failed to update transaction'); }
    finally { setSaving(false); }
  };

  return <Dialog open={open} onClose={() => !saving && onClose()} fullWidth maxWidth="sm">
    <DialogTitle>Edit Transaction</DialogTitle>
    <DialogContent dividers><Stack spacing={2} sx={{ pt: 1 }}>
      <Alert severity="info">This edits document-level fields only. Use Edit Item to change a line’s quantity or value.</Alert>
      <TextField label="Document Number" value={form.transactionNumber} onChange={update('transactionNumber')} fullWidth />
      <TextField label="Registration Number" value={form.ppkekNumber} onChange={update('ppkekNumber')} fullWidth />
      <TextField label="Registration Date" type="date" value={form.registrationDate} onChange={update('registrationDate')} InputLabelProps={{ shrink: true }} fullWidth />
      {isOutgoing && <TextField select label="Custom Doc Type" value={form.customsDocumentType} onChange={update('customsDocumentType')} fullWidth>
        {SCRAP_CUSTOMS_TYPES.map(type => <MenuItem key={type} value={type}>{type}</MenuItem>)}
      </TextField>}
      {isOutgoing && <TextField label="Recipient" value={form.recipientName} onChange={update('recipientName')} fullWidth />}
      <TextField label="Remarks" value={form.remarks} onChange={update('remarks')} fullWidth multiline minRows={2} />
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose} disabled={saving}>Cancel</Button><Button variant="contained" onClick={submit} disabled={saving}>{saving ? <CircularProgress size={18} /> : 'Save Transaction'}</Button></DialogActions>
  </Dialog>;
}
