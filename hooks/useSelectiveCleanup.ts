/**
 * useSelectiveCleanup Hook
 * Manages state for selective database cleanup mode
 */

import { useState, useCallback, useMemo, useRef } from 'react';
import {
  CleanupValidationService,
  ValidationError,
  SelectionResult
} from '@/lib/cleanup/validation-service';
import { CLEANUP_TABLES, PHASES, getTablesByPhase, Phase } from '@/lib/cleanup/table-config';

export interface SelectedTable {
  id: string;
  name: string;
  rowCount: number;
  selected: boolean;
}

export interface PhaseSelection {
  phaseNumber: number;
  phaseName: string;
  tablesTotal: number;
  tablesSelected: number;
  selected: boolean;
}

export interface SelectiveCleanupState {
  selectedTables: SelectedTable[];
  phaseSelections: PhaseSelection[];
  totalRowCount: number;
  validationErrors: ValidationError[];
  deleteOrder: string[];
  isValid: boolean;
  warnings: string[];
}

interface TableRowCounts {
  [tableId: string]: number;
}

export function useSelectiveCleanup() {
  const [selectedTableIds, setSelectedTableIds] = useState<Set<string>>(
    new Set()
  );
  const [rowCounts, setRowCounts] = useState<TableRowCounts>({});
  const [validationErrors, setValidationErrors] = useState<ValidationError[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  /**
   * Toggle table selection
   */
  const toggleTable = useCallback(
    (tableId: string) => {
      setSelectedTableIds((prev) => {
        const next = new Set(prev);
        if (next.has(tableId)) {
          next.delete(tableId);
        } else {
          next.add(tableId);
        }
        return next;
      });

      // Clear validation errors when user makes changes
      setValidationErrors([]);
    },
    []
  );

  /**
   * Select entire phase
   */
  const selectPhase = useCallback((phaseNumber: number) => {
    const tablesInPhase = getTablesByPhase(phaseNumber);
    setSelectedTableIds((prev) => {
      const next = new Set(prev);
      tablesInPhase.forEach((table) => {
        next.add(table.id);
      });
      return next;
    });
    setValidationErrors([]);
  }, []);

  /**
   * Deselect entire phase
   */
  const deselectPhase = useCallback((phaseNumber: number) => {
    const tablesInPhase = getTablesByPhase(phaseNumber);
    setSelectedTableIds((prev) => {
      const next = new Set(prev);
      tablesInPhase.forEach((table) => {
        next.delete(table.id);
      });
      return next;
    });
    setValidationErrors([]);
  }, []);

  const selectPhaseWithDependencies = useCallback((phaseNumber: number) => {
    const result = CleanupValidationService.selectPhaseWithDependencies(
      phaseNumber,
      Array.from(selectedTableIds)
    );

    setSelectedTableIds(new Set(result.selectedIds));
    setWarnings(
      result.warnings.map((w) => w.error)
    );
    setValidationErrors(result.errors);
  }, [selectedTableIds]);

  /**
   * Clear all selections
   */
  const clearSelection = useCallback(() => {
    setSelectedTableIds(new Set());
    setValidationErrors([]);
    setWarnings([]);
  }, []);

  /**
   * Set row counts for tables
   */
  const updateRowCounts = useCallback((counts: TableRowCounts) => {
    setRowCounts(counts);
  }, []);

  /**
   * Validate current selection
   */
  const validate = useCallback((): boolean => {
    const selectedIds = Array.from(selectedTableIds);
    const errors = CleanupValidationService.validateSelection(selectedIds);
    setValidationErrors(errors);

    return errors.length === 0;
  }, [selectedTableIds]);

  /**
   * Get optimal delete order
   */
  const getDeleteOrder = useCallback((): string[] => {
    const selectedIds = Array.from(selectedTableIds);
    const errors = CleanupValidationService.validateSelection(selectedIds);
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      return [];
    }

    const batches = CleanupValidationService.calculateOptimalDeleteOrder(selectedIds);
    return batches.flat();
  }, [selectedTableIds]);

  /**
   * Get completion summary
   */
  const getSummary = useCallback(() => {
    const selectedIds = Array.from(selectedTableIds);
    return CleanupValidationService.getSummary(selectedIds);
  }, [selectedTableIds]);

  /**
   * Get suggested tables to add
   */
  const getSuggestedTables = useCallback((): string[] => {
    const selectedIds = Array.from(selectedTableIds);
    const result = CleanupValidationService.suggestCompletionTables(selectedIds);
    return result.toAdd.map((t) => t.id);
  }, [selectedTableIds]);

  /**
   * Auto-suggest completion
   */
  const autoComplete = useCallback(() => {
    const suggested = getSuggestedTables();
    if (suggested.length > 0) {
      const newSelection = new Set(selectedTableIds);
      suggested.forEach((id) => newSelection.add(id));
      setSelectedTableIds(newSelection);
      setWarnings([
        `Added ${suggested.length} dependent table(s) for valid cleanup`
      ]);
    }
  }, [selectedTableIds, getSuggestedTables]);

  /**
   * Computed state
   */
  const state = useMemo<SelectiveCleanupState>(() => {
    // Build selected table list
    const selectedTables: SelectedTable[] = CLEANUP_TABLES.map((table) => ({
      id: table.id,
      name: table.displayName,
      rowCount: rowCounts[table.id] || 0,
      selected: selectedTableIds.has(table.id)
    }));

    // Build phase selections
    const phaseSelections: PhaseSelection[] = PHASES.map((phase: Phase) => {
      const tablesInPhase = getTablesByPhase(phase.number);
      const selectedInPhase = tablesInPhase.filter((t) =>
        selectedTableIds.has(t.id)
      ).length;

      return {
        phaseNumber: phase.number,
        phaseName: phase.name,
        tablesTotal: tablesInPhase.length,
        tablesSelected: selectedInPhase,
        selected: selectedInPhase === tablesInPhase.length
      };
    });

    // Calculate totals
    const totalRowCount = Array.from(selectedTableIds).reduce(
      (sum, id) => sum + (rowCounts[id] || 0),
      0
    );

    // Get validation result
    const selectedIds = Array.from(selectedTableIds);
    const errors = CleanupValidationService.validateSelection(selectedIds);
    const batches = errors.length === 0 
      ? CleanupValidationService.calculateOptimalDeleteOrder(selectedIds)
      : [];

    return {
      selectedTables,
      phaseSelections,
      totalRowCount,
      validationErrors: errors,
      deleteOrder: batches.flat(),
      isValid: errors.length === 0,
      warnings
    };
  }, [selectedTableIds, rowCounts, validationErrors, warnings]);

  return {
    // State
    state,
    selectedTableIds,
    rowCounts,

    // Actions
    toggleTable,
    selectPhase,
    deselectPhase,
    selectPhaseWithDependencies,
    clearSelection,
    updateRowCounts,

    // Validation
    validate,
    getDeleteOrder,
    getSummary,
    getSuggestedTables,
    autoComplete,

    // Helpers
    hasSelection: selectedTableIds.size > 0,
    isValid: validationErrors.length === 0
  };
}

/**
 * Hook for fetching row counts for selected tables
 */
export function useFetchTableRowCounts(tableIds: string[]) {
  const [rowCounts, setRowCounts] = useState<TableRowCounts>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Memoize table IDs string for stable dependency
  const tableIdsString = useMemo(() => JSON.stringify(tableIds), [tableIds]);

  const fetchCounts = useCallback(async () => {
    if (tableIds.length === 0) {
      setRowCounts({});
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response: Response = await window.fetch('/api/admin/cleanup/row-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableIds })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch row counts: ${response.statusText}`);
      }

      const data = await response.json();
      setRowCounts(data.rowCounts || {});
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('Failed to fetch row counts:', err);
    } finally {
      setLoading(false);
    }
  }, [tableIdsString]);

  return { rowCounts, loading, error, fetch: fetchCounts };
}

/**
 * Hook for executing cleanup
 */
export interface CleanupProgress {
  phase: number;
  phase_name: string;
  tables_total: number;
  tables_completed: number;
  current_table: string;
  rows_deleted: number;
  status: 'in_progress' | 'completed' | 'error';
  message?: string;
}

export function useExecuteCleanup() {
  const [progress, setProgress] = useState<CleanupProgress | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupId, setBackupId] = useState<string | null>(null);

  const execute = useCallback(
    async (
      tableIds: string[],
      password: string,
      mode: 'full' | 'selective' = 'selective',
      createBackup: boolean = true,
      backupLocation: string = './backups'
    ) => {
      setIsRunning(true);
      setError(null);
      setProgress(null);

      try {
        const response: Response = await window.fetch('/api/admin/cleanup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableIds: mode === 'selective' ? tableIds : undefined,
            password,
            mode,
            createBackup,
            backupLocation
          })
        });

        if (!response.ok) {
          throw new Error(`Cleanup failed: ${response.statusText}`);
        }

        // Handle SSE for progress updates
        if (response.body) {
          try {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              const chunk = decoder.decode(value);
              const lines = chunk.split('\n');

              for (const line of lines) {
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.backup_id) setBackupId(data.backup_id);
                    if (data.progress) setProgress(data.progress);
                  } catch (e) {
                    // Silent fail on parse errors
                  }
                }
              }
            }
          } catch (streamError) {
            // Handle stream errors gracefully
            console.error('Stream error:', streamError);
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        console.error('Cleanup execution error:', err);
      } finally {
        setIsRunning(false);
      }
    },
    []
  );

  return {
    progress,
    isRunning,
    error,
    backupId,
    execute
  };
}
