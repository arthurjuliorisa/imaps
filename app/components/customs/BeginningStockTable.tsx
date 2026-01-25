'use client';

import React, { useState, useEffect } from 'react';
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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Chip,
} from '@mui/material';
import {
  Edit as EditIcon,
  Delete as DeleteIcon,
  Search as SearchIcon,
  Visibility as ViewIcon,
} from '@mui/icons-material';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { formatQty } from '@/lib/utils/format';

export interface BeginningStockData {
  id: string;
  itemCode: string;
  itemName: string;
  itemType?: string;
  uom: string;
  beginningBalance: number;
  beginningDate: string;
  remarks?: string;
  ppkek_numbers?: string[];
  // Added for edit functionality
  itemId?: string;
  uomId?: string;
  // Check if this balance has any transactions
  hasTransactions?: boolean;
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
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [filterDate, setFilterDate] = useState<Dayjs | null>(null);
  const [ppkekDialogOpen, setPpkekDialogOpen] = useState(false);
  const [selectedPpkeks, setSelectedPpkeks] = useState<string[]>([]);
  const [selectedItemInfo, setSelectedItemInfo] = useState<{ code: string; name: string } | null>(null);

  // Debounce search term - wait 500ms after user stops typing
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 500);

    return () => {
      clearTimeout(timer);
    };
  }, [searchTerm]);

  // Trigger search only when debounced value changes
  useEffect(() => {
    setPage(0);
    onSearch?.(debouncedSearchTerm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchTerm]);

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
  };

  const handleDateChange = (newDate: Dayjs | null) => {
    setFilterDate(newDate);
    setPage(0);
    onDateFilter?.(newDate ? newDate.format('YYYY-MM-DD') : null);
  };

  const handleViewPpkeks = (ppkekNumbers: string[] | undefined, itemCode: string, itemName: string) => {
    setSelectedPpkeks(ppkekNumbers || []);
    setSelectedItemInfo({ code: itemCode, name: itemName });
    setPpkekDialogOpen(true);
  };

  const handleClosePpkekDialog = () => {
    setPpkekDialogOpen(false);
    setSelectedPpkeks([]);
    setSelectedItemInfo(null);
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
      <Box
        sx={{
          mb: 3,
          p: 2.5,
          borderRadius: 2,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: (theme) => theme.palette.mode === 'dark'
            ? alpha(theme.palette.background.paper, 0.4)
            : alpha(theme.palette.grey[50], 1),
        }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            placeholder="Search by item code or name..."
            value={searchTerm}
            onChange={handleSearchChange}
            size="medium"
            sx={{
              flexGrow: 1,
            }}
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
                  size: 'medium',
                  sx: {
                    minWidth: 250,
                  },
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
              <TableCell sx={{ fontWeight: 600 }}>Item Type</TableCell>
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
                <TableCell colSpan={9} align="center" sx={{ py: 8 }}>
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
                        bgcolor: alpha(theme.palette.secondary.main, 0.1),
                        color: theme.palette.secondary.main,
                        borderRadius: 1,
                        display: 'inline-block',
                        fontWeight: 600,
                        fontSize: '0.75rem',
                      }}
                    >
                      {row.itemType || '-'}
                    </Typography>
                  </TableCell>
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
                      {formatQty(row.beginningBalance)}
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
                    <Tooltip title="View PPKEK Numbers">
                      <IconButton
                        size="small"
                        onClick={() => handleViewPpkeks(row.ppkek_numbers, row.itemCode, row.itemName)}
                        color="info"
                        sx={{ mr: 0.5 }}
                      >
                        <ViewIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={row.hasTransactions ? "This balance already have transaction(s) and cannot be edited" : "Edit"}>
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => onEdit(row)}
                          color="primary"
                          sx={{ mr: 0.5 }}
                          disabled={row.hasTransactions}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Delete" sx={{ display: 'none' }}>
                      <IconButton
                        size="small"
                        onClick={() => onDelete(row)}
                        color="error"
                        sx={{ display: 'none' }}
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

      {/* PPKEK Numbers Detail Dialog */}
      <Dialog
        open={ppkekDialogOpen}
        onClose={handleClosePpkekDialog}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 2,
          },
        }}
      >
        <DialogTitle
          sx={{
            bgcolor: alpha(theme.palette.info.main, 0.08),
            borderBottom: `1px solid ${alpha(theme.palette.info.main, 0.1)}`,
          }}
        >
          <Box>
            <Typography component="div" fontWeight="bold" color="info.main" sx={{ fontSize: '1.125rem' }}>
              PPKEK Numbers Details
            </Typography>
            {selectedItemInfo && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Item: {selectedItemInfo.code} - {selectedItemInfo.name}
              </Typography>
            )}
          </Box>
        </DialogTitle>

        <DialogContent sx={{ mt: 2, minHeight: '150px' }}>
          {selectedPpkeks.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No PPKEK numbers assigned
            </Typography>
          ) : (
            <Stack spacing={1.5}>
              <Typography variant="subtitle2" fontWeight="bold">
                Associated PPKEK Numbers:
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                {selectedPpkeks.map((ppkek, index) => (
                  <Chip
                    key={index}
                    label={ppkek}
                    color="info"
                    variant="outlined"
                    sx={{
                      fontWeight: 600,
                      fontSize: '0.875rem',
                    }}
                  />
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1 }}>
                Total: {selectedPpkeks.length} PPKEK number(s)
              </Typography>
            </Stack>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${alpha(theme.palette.divider, 0.1)}` }}>
          <Button
            onClick={handleClosePpkekDialog}
            variant="contained"
            sx={{
              textTransform: 'none',
              borderRadius: 1,
            }}
          >
            Close
          </Button>
        </DialogActions>
      </Dialog>

    </Box>
  );
}
