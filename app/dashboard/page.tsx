'use client';

import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Card,
  CardContent,
  CardActionArea,
  Container,
  Stack,
  alpha,
  useTheme,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Business,
  Email,
  Language,
  Phone,
  LocationOn,
  Description,
  ImportExport,
  Inventory2,
  Category,
  RecyclingOutlined,
  Widgets,
  Assessment,
} from '@mui/icons-material';
import Link from 'next/link';

interface QuickLinkCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  href: string;
  gradient: string;
}

function QuickLinkCard({ title, description, icon, href, gradient }: QuickLinkCardProps) {
  const theme = useTheme();

  return (
    <Card
      elevation={2}
      sx={{
        height: '100%',
        transition: 'all 0.3s ease-in-out',
        '&:hover': {
          transform: 'translateY(-4px)',
          boxShadow: theme.shadows[8],
        },
      }}
    >
      <CardActionArea
        component={Link}
        href={href}
        sx={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
        }}
      >
        <CardContent sx={{ width: '100%' }}>
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: 2,
              background: gradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mb: 2,
              color: 'white',
            }}
          >
            {icon}
          </Box>
          <Typography variant="h6" fontWeight="bold" gutterBottom>
            {title}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {description}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function DashboardPage() {
  const theme = useTheme();

  const quickLinks: QuickLinkCardProps[] = [
    {
      title: 'Laporan Pemasukan Barang',
      description: 'Laporan barang masuk (Incoming)',
      icon: <ImportExport sx={{ fontSize: 32 }} />,
      href: '/customs/incoming',
      gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    },
    {
      title: 'Laporan Pengeluaran Barang',
      description: 'Laporan barang keluar (Outgoing)',
      icon: <ImportExport sx={{ fontSize: 32, transform: 'rotate(180deg)' }} />,
      href: '/customs/outgoing',
      gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
    },
    {
      title: 'LPJ Work In Progress',
      description: 'Laporan pertanggungjawaban WIP',
      icon: <Widgets sx={{ fontSize: 32 }} />,
      href: '/customs/wip',
      gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
    },
    {
      title: 'LPJ Mutasi Bahan Baku',
      description: 'Mutasi bahan baku/bahan penolong',
      icon: <Inventory2 sx={{ fontSize: 32 }} />,
      href: '/customs/material-usage',
      gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
    },
    {
      title: 'LPJ Mutasi Hasil Produksi',
      description: 'Mutasi hasil produksi (Production)',
      icon: <Category sx={{ fontSize: 32 }} />,
      href: '/customs/production',
      gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
    },
    {
      title: 'LPJ Mutasi Scrap/Reject',
      description: 'Mutasi bahan scrap/reject',
      icon: <RecyclingOutlined sx={{ fontSize: 32 }} />,
      href: '/customs/scrap',
      gradient: 'linear-gradient(135deg, #30cfd0 0%, #330867 100%)',
    },
    {
      title: 'LPJ Mutasi Barang Modal',
      description: 'Mutasi barang modal (Capital Goods)',
      icon: <Assessment sx={{ fontSize: 32 }} />,
      href: '/customs/capital-goods',
      gradient: 'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    },
  ];

  return (
    <Box>
      {/* Welcome Banner */}
      <Paper
        elevation={0}
        sx={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          p: 4,
          mb: 4,
          borderRadius: 3,
        }}
      >
        <Container maxWidth={false}>
          <Grid container spacing={4} alignItems="center">
            <Grid size={{ xs: 12, md: 8 }}>
              <Typography variant="h3" fontWeight="bold" gutterBottom>
                WELCOME TO
              </Typography>
              <Typography variant="h4" fontWeight="bold" gutterBottom>
                PT. Ventora Innovations Indonesia
              </Typography>
              <Typography variant="body1" sx={{ opacity: 0.9, mt: 2 }}>
                Integrated Material Administration and Planning System
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: 200,
                }}
              >
                <Business sx={{ fontSize: 120, opacity: 0.2 }} />
              </Box>
            </Grid>
          </Grid>
        </Container>
      </Paper>

      {/* Company Information */}
      <Paper
        elevation={2}
        sx={{
          p: 3,
          mb: 4,
          borderRadius: 2,
        }}
      >
        <Typography variant="h6" fontWeight="bold" gutterBottom sx={{ mb: 3 }}>
          Informasi Perusahaan
        </Typography>
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.primary.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.palette.primary.main,
                }}
              >
                <LocationOn />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Alamat
                </Typography>
                <Typography variant="body2" fontWeight={500}>
                  Jakarta, Indonesia
                </Typography>
              </Box>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.success.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.palette.success.main,
                }}
              >
                <Phone />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Telepon
                </Typography>
                <Typography variant="body2" fontWeight={500}>
                  +62 21 1234 5678
                </Typography>
              </Box>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.warning.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.palette.warning.main,
                }}
              >
                <Email />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Email
                </Typography>
                <Typography variant="body2" fontWeight={500}>
                  info@ventora.co.id
                </Typography>
              </Box>
            </Stack>
          </Grid>
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Stack direction="row" spacing={2} alignItems="center">
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  bgcolor: alpha(theme.palette.info.main, 0.1),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: theme.palette.info.main,
                }}
              >
                <Language />
              </Box>
              <Box>
                <Typography variant="caption" color="text.secondary" display="block">
                  Website
                </Typography>
                <Typography variant="body2" fontWeight={500}>
                  www.ventora.co.id
                </Typography>
              </Box>
            </Stack>
          </Grid>
        </Grid>
      </Paper>

      {/* Quick Links Section */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight="bold" gutterBottom>
          Link Terkait
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Akses cepat ke laporan dan dokumen customs
        </Typography>

        <Grid container spacing={3}>
          {quickLinks.map((link) => (
            <Grid key={link.title} size={{ xs: 12, sm: 6, md: 4 }}>
              <QuickLinkCard {...link} />
            </Grid>
          ))}
        </Grid>
      </Box>
    </Box>
  );
}
