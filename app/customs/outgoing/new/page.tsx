'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import {
  Box,
  Container,
  Paper,
  Typography,
  Breadcrumbs,
  Link,
  alpha,
  useTheme,
} from '@mui/material';
import { ArrowBack, Description } from '@mui/icons-material';
import { OutgoingDocumentForm } from '@/app/components/customs/forms/OutgoingDocumentForm';

export default function NewOutgoingDocumentPage() {
  const router = useRouter();
  const theme = useTheme();

  const handleClose = () => {
    router.push('/customs/outgoing');
  };

  const handleSuccess = () => {
    router.push('/customs/outgoing');
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Breadcrumbs aria-label="breadcrumb" sx={{ mb: 2 }}>
          <Link
            underline="hover"
            color="inherit"
            href="/customs"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            Customs
          </Link>
          <Link
            underline="hover"
            color="inherit"
            href="/customs/outgoing"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            Outgoing Documents
          </Link>
          <Typography color="text.primary">New Document</Typography>
        </Breadcrumbs>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box
            sx={{
              p: 1.5,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.primary.main, 0.1),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Description sx={{ fontSize: 32, color: 'primary.main' }} />
          </Box>
          <Box>
            <Typography variant="h4" fontWeight="bold" gutterBottom>
              Create New Outgoing Document
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Record outgoing goods with customs documentation (PEB, PPKEK)
            </Typography>
          </Box>
        </Box>
      </Box>

      <Paper
        elevation={0}
        sx={{
          p: 4,
          borderRadius: 2,
          border: `1px solid ${theme.palette.divider}`,
        }}
      >
        <OutgoingDocumentForm onClose={handleClose} onSuccess={handleSuccess} />
      </Paper>

      <Box
        sx={{
          mt: 3,
          p: 2,
          bgcolor: alpha(theme.palette.info.main, 0.08),
          borderRadius: 1,
          border: `1px solid ${alpha(theme.palette.info.main, 0.2)}`,
        }}
      >
        <Typography variant="subtitle2" fontWeight="bold" color="info.main" gutterBottom>
          Important Information
        </Typography>
        <Typography variant="body2" color="text.secondary" component="div">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>All fields marked with asterisk (*) are required</li>
            <li>Document dates cannot be in the future</li>
            <li>For finished goods (FERT items), production batch selection is mandatory for traceability</li>
            <li>Stock availability is checked in real-time for each item</li>
            <li>Once submitted, the document will be processed and stock will be adjusted automatically</li>
          </ul>
        </Typography>
      </Box>
    </Container>
  );
}
