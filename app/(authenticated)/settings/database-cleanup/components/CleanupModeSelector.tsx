/**
 * CleanupModeSelector Component
 * Displays mode selection cards for starting cleanup
 */

import React from 'react';
import {
  Box,
  Card,
  CardContent,
  CardActionArea,
  Grid,
  Typography,
  Stack,
  Chip,
  useTheme,
  alpha,
} from '@mui/material';
import { DeleteSweep, FilterList, Speed, Settings, CloudOff } from '@mui/icons-material';

interface CleanupModeSelectorProps {
  onSelectFullReset: () => void;
  onSelectSelective: () => void;
  onSelectINSWCleanup: () => void;
}

export function CleanupModeSelector({
  onSelectFullReset,
  onSelectSelective,
  onSelectINSWCleanup
}: CleanupModeSelectorProps) {
  const theme = useTheme();

  return (
    <Grid container spacing={3}>
      {/* Full Reset Card */}
      <Grid size={{ xs: 12, sm: 6 }}>
        <Card
          sx={{
            height: '100%',
            cursor: 'pointer',
            transition: 'all 0.3s',
            '&:hover': {
              boxShadow: theme.shadows[8],
              transform: 'translateY(-4px)',
            },
            bgcolor: alpha(theme.palette.error.main, 0.05),
            borderColor: theme.palette.error.main,
            borderWidth: 2,
            borderStyle: 'solid',
          }}
        >
          <CardActionArea onClick={onSelectFullReset} sx={{ height: '100%', p: 0 }}>
            <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Stack spacing={2}>
                {/* Icon */}
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '12px',
                    bgcolor: alpha(theme.palette.error.main, 0.1),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <DeleteSweep
                    sx={{
                      fontSize: 32,
                      color: theme.palette.error.main,
                    }}
                  />
                </Box>

                {/* Title & Badge */}
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      Full Reset
                    </Typography>
                    <Chip label="Fast" size="small" variant="outlined" />
                  </Stack>
                </Box>

                {/* Description */}
                <Typography variant="body2" color="textSecondary">
                  Delete all data from all 25 cleanup tables in one operation. Perfect for
                  complete database reset.
                </Typography>

                {/* Features */}
                <Stack spacing={1}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Speed fontSize="small" sx={{ color: 'success.main' }} />
                    <Typography variant="caption" color="textSecondary">
                      Fastest option - single operation
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      label="25 tables"
                      size="small"
                      variant="outlined"
                      sx={{ height: 24 }}
                    />
                  </Box>
                </Stack>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>

      {/* Selective Cleanup Card */}
      <Grid size={{ xs: 12, sm: 6 }}>
        <Card
          sx={{
            height: '100%',
            cursor: 'pointer',
            transition: 'all 0.3s',
            '&:hover': {
              boxShadow: theme.shadows[8],
              transform: 'translateY(-4px)',
            },
            bgcolor: alpha(theme.palette.info.main, 0.05),
            borderColor: theme.palette.info.main,
            borderWidth: 2,
            borderStyle: 'solid',
          }}
        >
          <CardActionArea onClick={onSelectSelective} sx={{ height: '100%', p: 0 }}>
            <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Stack spacing={2}>
                {/* Icon */}
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '12px',
                    bgcolor: alpha(theme.palette.info.main, 0.1),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FilterList
                    sx={{
                      fontSize: 32,
                      color: theme.palette.info.main,
                    }}
                  />
                </Box>

                {/* Title & Badge */}
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      Selective Cleanup
                    </Typography>
                    <Chip label="Flexible" size="small" variant="outlined" />
                  </Stack>
                </Box>

                {/* Description */}
                <Typography variant="body2" color="textSecondary">
                  Choose specific tables to clean with smart dependency validation. See row
                  counts before cleanup.
                </Typography>

                {/* Features */}
                <Stack spacing={1}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Settings fontSize="small" sx={{ color: 'info.main' }} />
                    <Typography variant="caption" color="textSecondary">
                      Choose exactly what to delete
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      label="Smart selection"
                      size="small"
                      variant="outlined"
                      sx={{ height: 24 }}
                    />
                  </Box>
                </Stack>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>

      {/* INSW Cleanup Card (Test Mode Only) */}
      <Grid size={{ xs: 12, sm: 6 }}>
        <Card
          sx={{
            height: '100%',
            cursor: 'pointer',
            transition: 'all 0.3s',
            '&:hover': {
              boxShadow: theme.shadows[8],
              transform: 'translateY(-4px)',
            },
            bgcolor: alpha(theme.palette.warning.main, 0.05),
            borderColor: theme.palette.warning.main,
            borderWidth: 2,
            borderStyle: 'solid',
          }}
        >
          <CardActionArea onClick={onSelectINSWCleanup} sx={{ height: '100%', p: 0 }}>
            <CardContent sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              <Stack spacing={2}>
                {/* Icon */}
                <Box
                  sx={{
                    width: 56,
                    height: 56,
                    borderRadius: '12px',
                    bgcolor: alpha(theme.palette.warning.main, 0.1),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CloudOff
                    sx={{
                      fontSize: 32,
                      color: theme.palette.warning.main,
                    }}
                  />
                </Box>

                {/* Title & Badge */}
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="h6" sx={{ fontWeight: 600 }}>
                      INSW Data Cleanup
                    </Typography>
                    <Chip label="Test Mode" size="small" variant="outlined" />
                  </Stack>
                </Box>

                {/* Description */}
                <Typography variant="body2" color="textSecondary">
                  Remove temporary transaction data from the INSW system. Test mode only.
                </Typography>

                {/* Features */}
                <Stack spacing={1}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Settings fontSize="small" sx={{ color: 'warning.main' }} />
                    <Typography variant="caption" color="textSecondary">
                      Clean INSW temporary endpoint
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Chip
                      label="INSW API"
                      size="small"
                      variant="outlined"
                      sx={{ height: 24 }}
                    />
                  </Box>
                </Stack>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      </Grid>
    </Grid>
  );
}
