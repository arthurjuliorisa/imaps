'use client';

import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  TablePagination,
  alpha,
  useTheme,
  IconButton,
  Tooltip,
  Box,
  CircularProgress,
  TextField,
  InputAdornment,
  Stack,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';

export interface BeginningStockData {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
  beginningBalance: number;
  beginningDate: string;
  remarks?: string;
  // Added for edit functionality
  itemId?: string;
  uomId?: string;
}

interface BeginningStockTableProps {
  data: BeginningStockData[];
  loading?: boolean;
  onEdit: (item: BeginningStockData) => void;
  onDelete: (item: BeginningStockData) => void;
  onSearch?: (searchTerm: string) => void;
  onDateFilter?: (date: string | null) => void;
}

export function BeginningStockTable({
  data,
  loading = false,
  onEdit,
  onDelete,
  onSearch,
  onDateFilter,
}: BeginningStockTableProps) {
  const theme = useTheme();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState<Dayjs | null>(null);

  const handleChangePage = (_event: unknown, newPage: number) => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10));
    setPage(0);
  };

  const handleSearchChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setSearchTerm(value);
    setPage(0);
    onSearch?.(value);
  };

  const handleDateChange = (newDate: Dayjs | null) => {
    setFilterDate(newDate);
    setPage(0);
    onDateFilter?.(newDate ? newDate.format('YYYY-MM-DD') : null);
  };

  const paginatedData = data.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box>
      {/* Search and Filter Section */}
      <Box sx={{ mb: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            placeholder="Search by item code or name..."
            value={searchTerm}
            onChange={handleSearchChange}
            size="small"
            sx={{ flexGrow: 1 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon color="action" />
                </InputAdornment>
              ),
            }}
          />
          <LocalizationProvider dateAdapter={AdapterDayjs}>
            <DatePicker
              label="Filter by Beginning Date"
              value={filterDate}
              onChange={handleDateChange}
              slotProps={{
                textField: {
                  size: 'small',
                  sx: { minWidth: 220 },
                },
                actionBar: {
                  actions: ['clear', 'today'],
                },
              }}
            />
          </LocalizationProvider>
        </Stack>
      </Box>

      {/* Data Table */}
      <TableContainer>
        <Table sx={{ minWidth: 650 }} aria-label="beginning stock table">
          <TableHead>
            <TableRow
              sx={{
                bgcolor: alpha(theme.palette.primary.main, 0.08),
              }}
            >
              <TableCell sx={{ fontWeight: 600 }}>No</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Code</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Item Name</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>UOM</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="right">
                Beginning Balance
              </TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Beginning Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Remarks</TableCell>
              <TableCell sx={{ fontWeight: 600 }} align="center">
                Action
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {paginatedData.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} align="center" sx={{ py: 8 }}>
                  <Typography variant="body1" color="text.secondary">
                    No beginning stock data found
                  </Typography>
                </TableCell>
              </TableRow>
            ) : (
              paginatedData.map((row, index) => (
                <TableRow
                  key={row.id}
                  sx={{
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.04),
                    },
                  }}
                >
                  <TableCell>{page * rowsPerPage + index + 1}</TableCell>
                  <TableCell>
                    <Typography variant="body2" fontWeight={600}>
                      {row.itemCode}
                    </Typography>
                  </TableCell>
                  <TableCell>{row.itemName}</TableCell>
                  <TableCell>
                    <Typography
                      variant="body2"
                      sx={{
                        px: 1,
                        py: 0.5,
                        bgcolor: alpha(theme.palette.info.main, 0.1),
                        color: theme.palette.info.main,
                        borderRadius: 1,
                        display: 'inline-block',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                      }}
                    >
                      {row.uom}
                    </Typography>
                  </TableCell>
                  <TableCell align="right">
                    <Typography variant="body2" fontWeight={600}>
                      {row.beginningBalance.toLocaleString('id-ID', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {dayjs(row.beginningDate).format('DD/MM/YYYY')}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2" color="text.secondary">
                      {row.remarks || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="center">
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => onEdit(row)}
                        color="primary"
                        sx={{ mr: 0.5 }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        onClick={() => onDelete(row)}
                        color="error"
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
      <TablePagination
        rowsPerPageOptions={[5, 10, 25, 50]}
        component="div"
        count={data.length}
        rowsPerPage={rowsPerPage}
        page={page}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </Box>
  );
}
