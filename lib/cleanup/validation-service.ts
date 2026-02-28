/**
 * Database Cleanup Validation Service
 * Handles dependency validation and smart selection logic
 */

import {
  CLEANUP_TABLES,
  CleanupTable,
  getTableById,
  getTableDependencies,
  getTablesByPhase
} from './table-config';

export interface ValidationError {
  tableId: string;
  tableName: string;
  error: string;
  severity: 'warning' | 'error';
  relatedTableId?: string;
}

export interface SelectionResult {
  selectedIds: string[];
  warnings: ValidationError[];
  errors: ValidationError[];
}

export class CleanupValidationService {
  /**
   * Validate selected tables for dependency conflicts
   * Returns errors if invalid selections detected
   */
  static validateSelection(selectedTableIds: string[]): ValidationError[] {
    const errors: ValidationError[] = [];
    const selectedSet = new Set(selectedTableIds);
    const selectedTables = selectedTableIds
      .map(id => getTableById(id))
      .filter((t): t is CleanupTable => t !== undefined);

    for (const table of selectedTables) {
      if (!table.dependencies) continue;

      // Check if dependent tables that this table depends on are also selected
      // AND there are tables that depend on this table that are NOT selected
      for (const depId of table.dependencies) {
        const depTable = getTableById(depId);
        if (!depTable) continue;

        if (!selectedSet.has(depId)) {
          // This table depends on depId, but depId is not selected
          errors.push({
            tableId: depId,
            tableName: depTable.displayName,
            error: `${table.displayName} depends on ${depTable.displayName}. You must delete dependencies first.`,
            severity: 'error',
            relatedTableId: table.id
          });
        }
      }
    }

    return errors;
  }

  /**
   * Smart selection: select all tables in a phase with auto-dependencies
   * Returns selected IDs and warnings
   */
  static selectPhaseWithDependencies(
    phase: number,
    currentSelection: string[] = []
  ): SelectionResult {
    const phaseTableIds = getTablesByPhase(phase).map(t => t.id);
    let selectedIds = new Set([...currentSelection]);
    const warnings: ValidationError[] = [];

    // Add phase tables
    for (const tableId of phaseTableIds) {
      selectedIds.add(tableId);
    }

    // Auto-add all dependencies recursively
    let changed = true;
    const maxIterations = 10; // Prevent infinite loops
    let iterations = 0;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;
      const previousSize = selectedIds.size;

      for (const tableId of Array.from(selectedIds)) {
        const table = getTableById(tableId);
        if (!table || !table.dependencies) continue;

        for (const depId of table.dependencies) {
          if (!selectedIds.has(depId)) {
            selectedIds.add(depId);
            changed = true;

            const depTable = getTableById(depId);
            warnings.push({
              tableId: depId,
              tableName: depTable?.displayName || depId,
              error: `Auto-selected due to dependency from ${table.displayName}`,
              severity: 'warning',
              relatedTableId: tableId
            });
          }
        }
      }

      if (selectedIds.size === previousSize) {
        changed = false;
      }
    }

    const validationErrors = this.validateSelection(Array.from(selectedIds));

    return {
      selectedIds: Array.from(selectedIds),
      warnings,
      errors: validationErrors
    };
  }

  /**
   * Deselect phase and all dependent tables
   * Returns selected IDs and warnings if dependent tables were removed
   */
  static deselectPhaseWithDependents(
    phase: number,
    currentSelection: string[]
  ): SelectionResult {
    const phaseTableIds = new Set(getTablesByPhase(phase).map(t => t.id));
    let selectedIds = new Set(currentSelection);
    const warnings: ValidationError[] = [];

    // Remove phase tables
    for (const tableId of phaseTableIds) {
      selectedIds.delete(tableId);
    }

    // Find and notify about tables that depend on removed tables
    for (const tableId of phaseTableIds) {
      const { dependsOnThis } = getTableDependencies(tableId);
      for (const depTable of dependsOnThis) {
        if (selectedIds.has(depTable.id)) {
          warnings.push({
            tableId: depTable.id,
            tableName: depTable.displayName,
            error: `This table depends on ${getTableById(tableId)?.displayName}. Deselecting will break dependency.`,
            severity: 'warning',
            relatedTableId: tableId
          });
        }
      }
    }

    return {
      selectedIds: Array.from(selectedIds),
      warnings,
      errors: []
    };
  }

  /**
   * Calculate optimal deletion order based on dependencies
   * Returns array of deletion batches (can be deleted in parallel)
   */
  static calculateOptimalDeleteOrder(selectedTableIds: string[]): string[][] {
    const order: string[][] = [];
    const processed = new Set<string>();
    const remaining = new Set(selectedTableIds);

    while (remaining.size > 0) {
      const batch: string[] = [];

      for (const tableId of remaining) {
        const table = getTableById(tableId);
        const dependencies = table?.dependencies || [];

        // Check if all dependencies are already processed
        const depsProcessed = dependencies.every(depId => processed.has(depId));

        if (depsProcessed) {
          batch.push(tableId);
        }
      }

      if (batch.length === 0) {
        // Circular dependency or error - add remaining as is
        batch.push(...remaining);
      }

      order.push(batch);

      batch.forEach(tableId => {
        processed.add(tableId);
        remaining.delete(tableId);
      });
    }

    return order;
  }

  /**
   * Get all tables that should be selected when selecting a table
   * (includes all dependencies transitively)
   */
  static getTransitiveDependencies(tableId: string): {
    directDeps: string[];
    allDeps: string[];
  } {
    const allDeps = new Set<string>();
    const directDeps: string[] = [];
    const queue = [tableId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      if (visited.has(currentId)) continue;
      visited.add(currentId);

      const table = getTableById(currentId);
      if (!table || !table.dependencies) continue;

      for (const depId of table.dependencies) {
        if (currentId === tableId) {
          directDeps.push(depId);
        }
        allDeps.add(depId);
        queue.push(depId);
      }
    }

    return {
      directDeps,
      allDeps: Array.from(allDeps)
    };
  }

  /**
   * Check if tables can be safely deleted together
   */
  static canDeleteTogether(tableIds: string[]): { can: boolean; errors: ValidationError[] } {
    const errors = this.validateSelection(tableIds);
    return {
      can: errors.length === 0,
      errors
    };
  }

  /**
   * Get related tables (dependencies and dependents)
   */
  static getRelatedTables(tableId: string): {
    dependencies: CleanupTable[];
    dependents: CleanupTable[];
  } {
    const { dependsOn, dependsOnThis } = getTableDependencies(tableId);
    return {
      dependencies: dependsOn,
      dependents: dependsOnThis
    };
  }

  /**
   * Suggest completion - what tables need to be added to make selection valid
   */
  static suggestCompletionTables(selectedTableIds: string[]): {
    toAdd: CleanupTable[];
    warnings: ValidationError[];
  } {
    const errors = this.validateSelection(selectedTableIds);
    const toAdd: CleanupTable[] = [];
    const addedIds = new Set(selectedTableIds);

    for (const error of errors) {
      const table = getTableById(error.tableId);
      if (table && !addedIds.has(error.tableId)) {
        toAdd.push(table);
        addedIds.add(error.tableId);
      }
    }

    return {
      toAdd,
      warnings: errors
    };
  }

  /**
   * Get cleanup summary for selected tables
   */
  static getSummary(selectedTableIds: string[]): {
    tableCount: number;
    phasesCovered: number[];
    partitionedTables: string[];
    cascadeDeleteableTables: string[];
    estimatedComplexity: 'low' | 'medium' | 'high';
  } {
    const selectedTables = selectedTableIds
      .map(id => getTableById(id))
      .filter((t): t is CleanupTable => t !== undefined);

    const phaseSet = new Set(selectedTables.map(t => t.phase));
    const partitionedTables = selectedTables
      .filter(t => t.isPartitioned)
      .map(t => t.name);
    const cascadeDeleteableTables = selectedTables
      .filter(t => t.cascadeDelete)
      .map(t => t.name);

    // Estimate complexity based on phases covered and dependencies
    let complexity: 'low' | 'medium' | 'high' = 'low';
    if (phaseSet.size >= 5 || selectedTableIds.length >= 15) {
      complexity = 'high';
    } else if (phaseSet.size >= 3 || selectedTableIds.length >= 8) {
      complexity = 'medium';
    }

    return {
      tableCount: selectedTableIds.length,
      phasesCovered: Array.from(phaseSet).sort(),
      partitionedTables,
      cascadeDeleteableTables,
      estimatedComplexity: complexity
    };
  }
}
