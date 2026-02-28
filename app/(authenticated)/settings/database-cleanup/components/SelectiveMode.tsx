/**
 * SelectiveMode Component
 * Handles selective database cleanup with table selection and dependency validation
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Typography,
  Button,
  Stack,
  TextField,
  Alert,
  LinearProgress,
  Checkbox,
  FormControlLabel,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  useTheme,
  alpha,
  CircularProgress,
} from '@mui/material';
import {
  ArrowBack,
  Warning,
  Lock,
  CheckCircle,
  Error as ErrorIcon,
  ExpandMore,
  Info,
  Delete,
  Backup as BackupIcon,
  FolderOpen as FolderOpenIcon,
} from '@mui/icons-material';
import { useToast } from '@/app/components/ToastProvider';
import {
  useSelectiveCleanup,
  useFetchTableRowCounts,
  useExecuteCleanup,
  CleanupProgress,
} from '@/hooks/useSelectiveCleanup';
import { CLEANUP_TABLES, PHASES, getTablesByPhase, Phase } from '@/lib/cleanup/table-config';

interface SelectiveModeProps {
  onBack: () => void;
}

type SelectiveStep = 'selection' | 'review' | 'password' | 'executing' | 'completed' | 'error';

export function SelectiveMode({ onBack }: SelectiveModeProps) {
  const theme = useTheme();
  const { showToast } = useToast();

  // Cleanup state
  const {
    state,
    selectedTableIds,
    toggleTable,
    selectPhase,
    deselectPhase,
    selectPhaseWithDependencies,
    clearSelection,
    updateRowCounts,
    validate,
    getDeleteOrder,
    getSummary,
    getSuggestedTables,
    autoComplete,
  } = useSelectiveCleanup();

  // Local state
  const [step, setStep] = useState<SelectiveStep>('selection');
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());
  const [showDependencyWarning, setShowDependencyWarning] = useState(false);
  const [createBackup, setCreateBackup] = useState(true);
  const [backupLocation, setBackupLocation] = useState('./backups');

  // Memoize table IDs array to prevent unnecessary re-renders
  const memoizedTableIds = useMemo(() => Array.from(selectedTableIds), [selectedTableIds]);

  // Row count fetching
  const { rowCounts, loading: rowCountsLoading, fetch: fetchRowCounts } =
    useFetchTableRowCounts(memoizedTableIds);

  // Execution
  const { progress, isRunning, error, execute } = useExecuteCleanup();

  // Update row counts when selection changes
  useEffect(() => {
    if (memoizedTableIds.length > 0) {
      fetchRowCounts();
    }
  }, [memoizedTableIds]);

  // Update row counts in cleanup state
  useEffect(() => {
    updateRowCounts(rowCounts);
  }, [rowCounts]);

  const handlePhaseClick = (phaseNumber: number) => {
    const isExpanded = expandedPhases.has(phaseNumber);
    const newExpanded = new Set(expandedPhases);
    if (isExpanded) {
      newExpanded.delete(phaseNumber);
    } else {
      newExpanded.add(phaseNumber);
    }
    setExpandedPhases(newExpanded);
  };

  const handleSelectPhaseAll = (phaseNumber: number) => {
    selectPhase(phaseNumber);
  };

  const handleDeselectPhaseAll = (phaseNumber: number) => {
    deselectPhase(phaseNumber);
  };

  const handleAutoComplete = () => {
    autoComplete();
    showToast('Added dependent tables', 'success');
  };

  const handleProceedToReview = () => {
    if (selectedTableIds.size === 0) {
      showToast('Please select at least one table', 'error');
      return;
    }

    const isValid = validate();
    if (!isValid && state.validationErrors.length > 0) {
      const errorCount = state.validationErrors.filter((e) => e.severity === 'error').length;
      if (errorCount > 0) {
        showToast(`${errorCount} validation error(s) found. Please resolve them first.`, 'error');
        return;
      }
    }

    setStep('review');
  };

  const handleConfirmPassword = async () => {
    if (!password) {
      setPasswordError('Password is required');
      return;
    }

    setPasswordError('');
    setStep('executing');

    try {
      const tableIds = Array.from(selectedTableIds);
      await execute(tableIds, password, 'selective');

      if (!error) {
        setStep('completed');
        showToast('Database cleanup completed successfully', 'success');
      } else {
        setStep('error');
        showToast(`Cleanup failed: ${error}`, 'error');
      }
    } catch (err) {
      setStep('error');
      const message = err instanceof Error ? err.message : 'Cleanup failed';
      showToast(message, 'error');
    }
  };

  const suggestedTables = getSuggestedTables();
  const summary = getSummary();

  return (
    <Box>
      <Stack spacing={3}>
        {/* Back Button */}
        <Button
          startIcon={<ArrowBack />}
          onClick={onBack}
          disabled={isRunning || ['executing', 'completed', 'error'].includes(step)}
          sx={{ alignSelf: 'flex-start' }}
        >
          Back
        </Button>

        {/* Selection Step */}
        {step === 'selection' && (
          <Card>
            <CardHeader
              avatar={<Info sx={{ color: theme.palette.info.main }} />}
              title="Select Tables to Clean"
              subheader="Choose specific tables with smart dependency validation"
            />
            <CardContent>
              <Stack spacing={3}>
                {/* Validation Errors */}
                {state.validationErrors.length > 0 && (
                  <Alert severity="error">
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Validation Errors:
                    </Typography>
                    {state.validationErrors.map((error, idx) => (
                      <Typography key={idx} variant="body2">
                        • {error.tableName}: {error.error}
                      </Typography>
                    ))}
                  </Alert>
                )}

                {/* Automatic Selection Suggestion */}
                {suggestedTables.length > 0 && (
                  <Alert severity="warning">
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      Missing Dependencies
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                      To cleanly delete the selected tables, the following dependent tables
                      should also be deleted:
                    </Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
                      {suggestedTables.map((tableId) => {
                        const table = CLEANUP_TABLES.find((t) => t.id === tableId);
                        return (
                          <Chip
                            key={tableId}
                            label={table?.displayName || tableId}
                            size="small"
                          />
                        );
                      })}
                    </Box>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={handleAutoComplete}
                    >
                      Add Missing Dependencies
                    </Button>
                  </Alert>
                )}

                {/* Phase Selection Accordions */}
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 2 }}>
                    Available Tables by Phase
                  </Typography>

                  {PHASES.map((phase: Phase) => {
                    const tablesInPhase = getTablesByPhase(phase.number);
                    const selectedCount = tablesInPhase.filter((t) =>
                      selectedTableIds.has(t.id)
                    ).length;
                    const allSelected = selectedCount === tablesInPhase.length;
                    const someSelected = selectedCount > 0;

                    return (
                      <Accordion
                        key={phase.number}
                        expanded={expandedPhases.has(phase.number)}
                        onChange={() => handlePhaseClick(phase.number)}
                      >
                        <AccordionSummary expandIcon={<ExpandMore />}>
                          <Checkbox
                            checked={allSelected}
                            indeterminate={someSelected && !allSelected}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => {
                              if (allSelected) {
                                handleDeselectPhaseAll(phase.number);
                              } else {
                                handleSelectPhaseAll(phase.number);
                              }
                            }}
                            sx={{ mr: 1 }}
                          />
                          <Box sx={{ flex: 1 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                              {phase.name}
                            </Typography>
                            <Typography variant="caption" color="textSecondary">
                              {selectedCount} / {tablesInPhase.length} selected
                            </Typography>
                          </Box>
                        </AccordionSummary>
                        <AccordionDetails>
                          <Stack spacing={2}>
                            {tablesInPhase.map((table) => (
                              <FormControlLabel
                                key={table.id}
                                control={
                                  <Checkbox
                                    checked={selectedTableIds.has(table.id)}
                                    onChange={() => toggleTable(table.id)}
                                  />
                                }
                                label={
                                  <Box>
                                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                      {table.displayName}
                                    </Typography>
                                    <Typography variant="caption" color="textSecondary">
                                      {rowCounts[table.id] !== undefined
                                        ? `${rowCounts[table.id].toLocaleString()} rows`
                                        : "Loading..."}
                                    </Typography>
                                  </Box>
                                }
                              />
                            ))}
                          </Stack>
                        </AccordionDetails>
                      </Accordion>
                    );
                  })}
                </Box>

                {/* Summary */}
                {selectedTableIds.size > 0 && (
                  <Box sx={{ p: 2, bgcolor: alpha(theme.palette.info.main, 0.05), borderRadius: 1 }}>
                    <Stack spacing={1}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Selection Summary:
                      </Typography>
                      <Typography variant="body2">
                        • Tables to clean: {selectedTableIds.size}
                      </Typography>
                      <Typography variant="body2">
                        • Total rows to delete: {state.totalRowCount.toLocaleString()}
                      </Typography>
                      {state.deleteOrder.length > 0 && (
                        <Typography variant="body2">
                          • Delete order: {state.deleteOrder.length} tables in sequence
                        </Typography>
                      )}
                    </Stack>
                  </Box>
                )}

                {/* Action Buttons */}
                <Stack direction="row" spacing={2} sx={{ pt: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={onBack}
                    disabled={rowCountsLoading}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="text"
                    onClick={clearSelection}
                    disabled={selectedTableIds.size === 0 || rowCountsLoading}
                  >
                    Clear All
                  </Button>
                  <Button
                    variant="contained"
                    onClick={handleProceedToReview}
                    disabled={selectedTableIds.size === 0 || rowCountsLoading}
                  >
                    Review & Proceed
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Review Step */}
        {step === 'review' && (
          <Card>
            <CardHeader
              avatar={<Info sx={{ color: theme.palette.warning.main }} />}
              title="Review Cleanup Configuration"
              subheader="Confirm your selection before proceeding"
            />
            <CardContent>
              <Stack spacing={3}>
                <Alert severity="warning" icon={<Warning />}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    Review your selection carefully
                  </Typography>
                  <Typography variant="body2">
                    {selectedTableIds.size} table(s) will be cleared, deleting approximately{' '}
                    {state.totalRowCount.toLocaleString()} rows.
                  </Typography>
                </Alert>

                {/* Tables Table */}
                <TableContainer
                  sx={{
                    maxHeight: 400,
                    overflow: 'auto',
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: 1,
                  }}
                >
                  <Table stickyHeader>
                    <TableHead>
                      <TableRow sx={{ bgcolor: alpha(theme.palette.grey[500], 0.1) }}>
                        <TableCell>Table Name</TableCell>
                        <TableCell align="right">Rows</TableCell>
                        <TableCell align="right">Phase</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {state.deleteOrder.map((tableId) => {
                        const table = CLEANUP_TABLES.find((t) => t.id === tableId);
                        if (!table) return null;

                        return (
                          <TableRow key={tableId}>
                            <TableCell>{table.displayName}</TableCell>
                            <TableCell align="right">
                              {(rowCounts[tableId] || 0).toLocaleString()}
                            </TableCell>
                            <TableCell align="right">Phase {table.phase}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Action Buttons */}
                <Stack direction="row" spacing={2} sx={{ pt: 2 }}>
                  <Button
                    variant="outlined"
                    onClick={() => setStep('selection')}
                    disabled={isRunning}
                  >
                    Back to Selection
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={() => setStep('password')}
                    disabled={isRunning}
                  >
                    Proceed to Confirmation
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Password Step */}
        {step === 'password' && (
          <Card>
            <CardHeader
              avatar={<Lock sx={{ color: theme.palette.warning.main }} />}
              title="Confirm with Password"
              subheader="Admin authentication required"
            />
            <CardContent>
              <Stack spacing={3}>
                <Alert severity="warning">
                  Please enter your password to confirm this dangerous operation.
                </Alert>

                <TextField
                  fullWidth
                  label="Password"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError('');
                  }}
                  error={!!passwordError}
                  helperText={passwordError}
                  placeholder="Enter your password"
                  autoFocus
                />

                <Stack direction="row" spacing={2}>
                  <Button
                    variant="outlined"
                    onClick={() => {
                      setStep('review');
                      setPassword('');
                      setPasswordError('');
                    }}
                    disabled={isRunning}
                  >
                    Back
                  </Button>
                  <Button
                    variant="contained"
                    color="error"
                    onClick={handleConfirmPassword}
                    disabled={!password || isRunning}
                  >
                    Confirm & Start Cleanup
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Executing Step */}
        {step === 'executing' && progress && (
          <Card>
            <CardHeader
              avatar={
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: alpha(theme.palette.info.main, 0.1),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <CircularProgress size={24} />
                </Box>
              }
              title="Cleanup in Progress"
              subheader={`Phase ${progress.phase}: ${progress.phase_name}`}
            />
            <CardContent>
              <Stack spacing={3}>
                {/* Progress Bar */}
                <Box>
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                    Current Operation
                  </Typography>
                  <Typography variant="body2" color="textSecondary" sx={{ mb: 1 }}>
                    {progress.message}
                  </Typography>
                  <LinearProgress
                    variant="determinate"
                    value={
                      progress.tables_total > 0
                        ? (progress.tables_completed / progress.tables_total) * 100
                        : 0
                    }
                  />
                  <Typography variant="caption" color="textSecondary" sx={{ mt: 1 }}>
                    {progress.tables_completed} / {progress.tables_total} tables completed
                  </Typography>
                </Box>

                {/* Statistics */}
                <Stack direction="row" spacing={3}>
                  <Box>
                    <Typography variant="caption" color="textSecondary">
                      Phase
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {progress.phase} / 7
                    </Typography>
                  </Box>
                  <Box>
                    <Typography variant="caption" color="textSecondary">
                      Rows Deleted
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                      {progress.rows_deleted.toLocaleString()}
                    </Typography>
                  </Box>
                </Stack>

                <Alert severity="info">
                  Please do not close or refresh this page during cleanup.
                </Alert>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Completed Step */}
        {step === 'completed' && (
          <Card sx={{ bgcolor: alpha(theme.palette.success.main, 0.05) }}>
            <CardHeader
              avatar={<CheckCircle sx={{ color: theme.palette.success.main }} />}
              title="Cleanup Completed Successfully"
              subheader="Database has been cleaned"
            />
            <CardContent>
              <Stack spacing={3}>
                <Alert severity="success">
                  Database cleanup has been completed successfully. All cleanup operations
                  have been logged in the audit trail.
                </Alert>

                {progress && (
                  <Box sx={{ p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                    <Typography
                      variant="caption"
                      color="textSecondary"
                      sx={{ display: 'block', mb: 0.5 }}
                    >
                      Summary:
                    </Typography>
                    <Typography variant="body2">
                      • Total rows deleted: {progress.rows_deleted.toLocaleString()}
                    </Typography>
                    <Typography variant="body2">
                      • Tables cleaned: {selectedTableIds.size}
                    </Typography>
                    <Typography variant="body2">
                      • Phases completed: 7 / 7
                    </Typography>
                  </Box>
                )}

                <Stack direction="row" spacing={2}>
                  <Button
                    variant="outlined"
                    onClick={onBack}
                  >
                    Back to Menu
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => {
                      clearSelection();
                      setStep('selection');
                      setPassword('');
                    }}
                  >
                    Perform Another Cleanup
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Error Step */}
        {step === 'error' && (
          <Card sx={{ bgcolor: alpha(theme.palette.error.main, 0.05) }}>
            <CardHeader
              avatar={<ErrorIcon sx={{ color: theme.palette.error.main }} />}
              title="Cleanup Failed"
              subheader="An error occurred during cleanup"
            />
            <CardContent>
              <Stack spacing={3}>
                <Alert severity="error">
                  <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                    {error || 'Unknown error occurred'}
                  </Typography>
                  <Typography variant="body2">
                    The database backup has been preserved. Please contact support if the
                    cleanup fails repeatedly.
                  </Typography>
                </Alert>

                <Stack direction="row" spacing={2}>
                  <Button
                    variant="outlined"
                    onClick={onBack}
                  >
                    Go Back
                  </Button>
                  <Button
                    variant="contained"
                    onClick={() => {
                      setStep('selection');
                      setPassword('');
                    }}
                  >
                    Try Again
                  </Button>
                </Stack>
              </Stack>
            </CardContent>
          </Card>
        )}
      </Stack>
    </Box>
  );
}
