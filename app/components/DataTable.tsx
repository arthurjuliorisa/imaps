'use client';

import React, { useState, useEffect } from 'react';
import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  IconButton,
  Tooltip,
  Box,
  TextField,
  InputAdornment,
  Skeleton,
  Typography,
  alpha,
  useTheme,
  Stack,
} from '@mui/material';
import { Edit, Delete, Search, Inbox } from '@mui/icons-material';

export interface Column {
  id: string;
  label: string;
  minWidth?: number;
  align?: 'left' | 'right' | 'center';
  format?: (value: any, row?: any) => string | React.ReactNode;
}

export interface ExtraAction {
  icon: React.ReactNode;
  label: string;
  onClick: (row: any) => void;
  color?: 'primary' | 'secondary' | 'success' | 'error' | 'info' | 'warning';
}


interface DataTableProps {
  columns: Column[];
  data: any[];
  onEdit?: (row: any) => void;
  onDelete?: (row: any) => void;
  extraActions?: ExtraAction[];
  searchable?: boolean;
  searchPlaceholder?: string;
  loading?: boolean;
  emptyMessage?: string;
}

export function DataTable({
  columns,
  data,
  onEdit,
  onDelete,
  extraActions,
  searchable = true,
  searchPlaceholder = 'Search...',
  loading = false,
  emptyMessage = 'No data available',
}: DataTableProps) {
  const theme = useTheme();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');

  // Reset to first page when search changes
  useEffect(() => {
    setPage(0);
  }, [searchTerm]);

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(+event.target.value);
    setPage(0);
  };

  const hasActions = onEdit || onDelete || (extraActions && extraActions.length > 0);

  const filteredData = searchable
    ? data.filter((row) =>
        Object.values(row).some((value) =>
          String(value).toLowerCase().includes(searchTerm.toLowerCase())
        )
      )
    : data;

  return (
    <Paper
      elevation={2}
      sx={{
        width: '100%',
        overflow: 'hidden',
        borderRadius: 2,
        border: `1px solid ${theme.palette.divider}`,
      }}
    >
      {searchable && (
        <Box sx={{ p: 2.5, borderBottom: `1px solid ${theme.palette.divider}` }}>
          <TextField
            fullWidth
            variant="outlined"
            placeholder={searchPlaceholder}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            size="small"
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search color="action" />
                </InputAdornment>
              ),
            }}
            sx={{
              '& .MuiOutlinedInput-root': {
                bgcolor: alpha(theme.palette.background.default, 0.5),
              },
            }}
          />
        </Box>
      )}
      <TableContainer sx={{ maxHeight: 600 }}>
        <Table stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell
                align="center"
                sx={{
                  fontWeight: 700,
                  minWidth: 70,
                  background: `linear-gradient(${alpha(theme.palette.primary.main, 0.05)}, ${alpha(theme.palette.primary.main, 0.05)}), ${theme.palette.background.paper}`,
                  color: theme.palette.primary.main,
                  position: 'sticky',
                  top: 0,
                  zIndex: 100,
                }}
              >
                No
              </TableCell>
              {columns.map((column) => (
                <TableCell
                  key={column.id}
                  align={column.align || 'left'}
                  sx={{
                    fontWeight: 700,
                    minWidth: column.minWidth,
                    background: `linear-gradient(${alpha(theme.palette.primary.main, 0.05)}, ${alpha(theme.palette.primary.main, 0.05)}), ${theme.palette.background.paper}`,
                    color: theme.palette.primary.main,
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                  }}
                >
                  {column.label}
                </TableCell>
              ))}
              {hasActions && (
                <TableCell
                  align="center"
                  sx={{
                    fontWeight: 700,
                    minWidth: 120,
                    background: `linear-gradient(${alpha(theme.palette.primary.main, 0.05)}, ${alpha(theme.palette.primary.main, 0.05)}), ${theme.palette.background.paper}`,
                    color: theme.palette.primary.main,
                    position: 'sticky',
                    top: 0,
                    zIndex: 100,
                  }}
                >
                  Action
                </TableCell>
              )}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              // Loading skeleton
              Array.from(new Array(rowsPerPage)).map((_, index) => (
                <TableRow key={`skeleton-${index}`}>
                  <TableCell align="center">
                    <Skeleton variant="text" width={30} />
                  </TableCell>
                  {columns.map((column) => (
                    <TableCell key={column.id}>
                      <Skeleton variant="text" />
                    </TableCell>
                  ))}
                  {hasActions && (
                    <TableCell align="center">
                      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
                        <Skeleton variant="circular" width={32} height={32} />
                        <Skeleton variant="circular" width={32} height={32} />
                      </Box>
                    </TableCell>
                  )}
                </TableRow>
              ))
            ) : filteredData.length === 0 ? (
              // Empty state
              <TableRow>
                <TableCell colSpan={columns.length + 2} align="center" sx={{ py: 8 }}>
                  <Stack spacing={2} alignItems="center">
                    <Box
                      sx={{
                        p: 3,
                        borderRadius: '50%',
                        bgcolor: alpha(theme.palette.primary.main, 0.1),
                      }}
                    >
                      <Inbox sx={{ fontSize: 48, color: theme.palette.primary.main }} />
                    </Box>
                    <Typography variant="h6" fontWeight={600} color="text.secondary">
                      {emptyMessage}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {searchTerm
                        ? 'Try adjusting your search to find what you are looking for.'
                        : 'There are no records to display at this time.'}
                    </Typography>
                  </Stack>
                </TableCell>
              </TableRow>
            ) : (
              // Data rows
              filteredData
                .slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
                .map((row, index) => (
                  <TableRow
                    hover
                    key={row.id || index}
                    sx={{
                      transition: 'all 0.2s ease-in-out',
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.04),
                        transform: 'scale(1.002)',
                      },
                    }}
                  >
                    <TableCell
                      align="center"
                      sx={{
                        fontWeight: 600,
                        color: theme.palette.text.secondary,
                      }}
                    >
                      {page * rowsPerPage + index + 1}
                    </TableCell>
                    {columns.map((column) => {
                      const value = row[column.id];
                      return (
                        <TableCell key={column.id} align={column.align || 'left'}>
                          {column.format ? column.format(value, row) : value}
                        </TableCell>
                      );
                    })}
                    {hasActions && (
                      <TableCell align="center">
                        <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'center' }}>
                          {extraActions?.map((action, actionIndex) => (
                            <Tooltip key={actionIndex} title={action.label} arrow>
                              <IconButton
                                size="small"
                                color={action.color || 'primary'}
                                onClick={() => action.onClick(row)}
                                sx={{
                                  transition: 'all 0.2s',
                                  '&:hover': {
                                    bgcolor: alpha(theme.palette[action.color || 'primary'].main, 0.1),
                                    transform: 'scale(1.1)',
                                  },
                                }}
                              >
                                {action.icon}
                              </IconButton>
                            </Tooltip>
                          ))}
                          {onEdit && (
                            <Tooltip title="Edit" arrow>
                              <IconButton
                                size="small"
                                color="primary"
                                onClick={() => onEdit(row)}
                                sx={{
                                  transition: 'all 0.2s',
                                  '&:hover': {
                                    bgcolor: alpha(theme.palette.primary.main, 0.1),
                                    transform: 'scale(1.1)',
                                  },
                                }}
                              >
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                          {onDelete && (
                            <Tooltip title="Delete" arrow>
                              <IconButton
                                size="small"
                                color="error"
                                onClick={() => onDelete(row)}
                                sx={{
                                  transition: 'all 0.2s',
                                  '&:hover': {
                                    bgcolor: alpha(theme.palette.error.main, 0.1),
                                    transform: 'scale(1.1)',
                                  },
                                }}
                              >
                                <Delete fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </TableCell>
                    )}
                  </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[10, 25, 50, 100]}
        component="div"
        count={filteredData.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
        sx={{
          borderTop: `1px solid ${theme.palette.divider}`,
          '.MuiTablePagination-selectLabel, .MuiTablePagination-displayedRows': {
            fontWeight: 500,
          },
        }}
      />
    </Paper>
  );
}
