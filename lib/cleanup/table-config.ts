/**
 * Database Cleanup Table Configuration
 * Defines cleanup tables with their metadata, dependencies, and feature eligibility.
 */

export interface CleanupTable {
  id: string; // Unique identifier (usually same as name)
  name: string; // Database table name
  displayName: string; // Human-readable name
  phase: number; // Phase number (1-6)
  phaseName: string; // Phase description
  rowCount?: number; // Row count (populated at runtime)
  dependencies?: string[]; // Table IDs this table depends on
  dependentTables?: string[]; // Table IDs that depend on this
  size?: string; // Approx data size
  isPartitioned?: boolean; // Is partitioned table
  cascadeDelete?: boolean; // Has cascade delete
  canDelete: boolean; // Can be deleted independently
  selected?: boolean; // User selection state
  disabled?: boolean; // Is disabled for selection
  reason?: string; // Why cannot delete (if disabled)
  companyScope: CleanupCompanyScope; // Explicit company ownership strategy
  cleanupEligibility?: CleanupEligibility; // Which cleanup features may operate on this table
}

export interface CleanupEligibility {
  fullReset: boolean;
  selectiveCleanup: boolean;
  dedicatedFeature?: 'insw-cleanup';
  retainedHistory?: boolean;
  exclusionReason?: string;
}

export type CleanupCompanyScope =
  | {
      type: 'direct';
      companyColumn: string;
    }
  | {
      type: 'parent';
      parentTable: string;
      parentCompanyColumn: string;
      childForeignKey: string;
      parentPrimaryKey: string;
    }
  | {
      type: 'unsupported';
      reason: string;
    };

// ============================================================================
// PHASE 1: SCRAP MANAGEMENT (2 tables)
// ============================================================================
const PHASE_1_TABLES: CleanupTable[] = [
  {
    id: 'scrap_transaction_items',
    name: 'scrap_transaction_items',
    displayName: 'Scrap Transaction Items',
    phase: 1,
    phaseName: 'Phase 1: Scrap Management',
    cascadeDelete: true,
    dependencies: ['scrap_transactions'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'scrap_transaction_company' }
  },
  {
    id: 'scrap_transactions',
    name: 'scrap_transactions',
    displayName: 'Scrap Transactions',
    phase: 1,
    phaseName: 'Phase 1: Scrap Management',
    isPartitioned: true,
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['scrap_transaction_items'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  }
];

// ============================================================================
// PHASE 2: TRACEABILITY/ALLOCATION (4 tables)
// ============================================================================
const PHASE_2_TABLES: CleanupTable[] = [
  {
    id: 'work_order_material_consumption',
    name: 'work_order_material_consumption',
    displayName: 'Work Order Material Consumption',
    phase: 2,
    phaseName: 'Phase 2: Traceability / Allocation',
    cascadeDelete: false,
    dependencies: ['material_usages'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'work_order_fg_production',
    name: 'work_order_fg_production',
    displayName: 'Work Order FG Production',
    phase: 2,
    phaseName: 'Phase 2: Traceability / Allocation',
    cascadeDelete: false,
    dependencies: ['production_outputs'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'outgoing_work_order_allocations',
    name: 'outgoing_work_order_allocations',
    displayName: 'Outgoing Work Order Allocations',
    phase: 2,
    phaseName: 'Phase 2: Traceability / Allocation',
    cascadeDelete: false,
    dependencies: ['outgoing_good_items'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: {
      type: 'parent',
      parentTable: 'outgoing_good_items',
      parentCompanyColumn: 'outgoing_good_company',
      childForeignKey: 'outgoing_good_item_id',
      parentPrimaryKey: 'id'
    }
  },
  {
    id: 'outgoing_fg_production_traceability',
    name: 'outgoing_fg_production_traceability',
    displayName: 'Outgoing FG Production Traceability',
    phase: 2,
    phaseName: 'Phase 2: Traceability / Allocation',
    cascadeDelete: false,
    dependencies: ['outgoing_good_items', 'incoming_goods'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  }
];

// ============================================================================
// PHASE 3: SNAPSHOT/SUMMARY (2 tables)
// ============================================================================
const PHASE_3_TABLES: CleanupTable[] = [
  {
    id: 'snapshot_recalc_queue',
    name: 'snapshot_recalc_queue',
    displayName: 'Snapshot Recalculation Queue',
    phase: 3,
    phaseName: 'Phase 3: Snapshot / Summary',
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['stock_daily_snapshot'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'stock_daily_snapshot',
    name: 'stock_daily_snapshot',
    displayName: 'Stock Daily Snapshot',
    phase: 3,
    phaseName: 'Phase 3: Snapshot / Summary',
    cascadeDelete: false,
    dependencies: [],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'wip_balances',
    name: 'wip_balances',
    displayName: 'WIP Balances',
    phase: 3,
    phaseName: 'Phase 3: Snapshot / Summary',
    cascadeDelete: false,
    dependencies: [],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' },
    cleanupEligibility: {
      fullReset: true,
      selectiveCleanup: true,
    }
  }
];

// ============================================================================
// PHASE 4: DETAIL/ITEM TABLES (6 tables)
// ============================================================================
const PHASE_4_TABLES: CleanupTable[] = [
  {
    id: 'outgoing_good_items',
    name: 'outgoing_good_items',
    displayName: 'Outgoing Good Items',
    phase: 4,
    phaseName: 'Phase 4: Detail / Item Tables',
    cascadeDelete: true,
    dependencies: ['outgoing_goods'],
    dependentTables: [
      'outgoing_work_order_allocations',
      'outgoing_fg_production_traceability'
    ],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'outgoing_good_company' }
  },
  {
    id: 'adjustment_items',
    name: 'adjustment_items',
    displayName: 'Adjustment Items',
    phase: 4,
    phaseName: 'Phase 4: Detail / Item Tables',
    cascadeDelete: true,
    dependencies: ['adjustments'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'adjustment_company' }
  },
  {
    id: 'production_output_items',
    name: 'production_output_items',
    displayName: 'Production Output Items',
    phase: 4,
    phaseName: 'Phase 4: Detail / Item Tables',
    cascadeDelete: true,
    dependencies: ['production_outputs'],
    dependentTables: ['work_order_fg_production'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'production_output_company' }
  },
  {
    id: 'material_usage_items',
    name: 'material_usage_items',
    displayName: 'Material Usage Items',
    phase: 4,
    phaseName: 'Phase 4: Detail / Item Tables',
    cascadeDelete: true,
    dependencies: ['material_usages'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'material_usage_company' }
  },
  {
    id: 'incoming_good_items',
    name: 'incoming_good_items',
    displayName: 'Incoming Good Items',
    phase: 4,
    phaseName: 'Phase 4: Detail / Item Tables',
    cascadeDelete: true,
    dependencies: ['incoming_goods'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'incoming_good_company' }
  },
  {
    id: 'wms_stock_opname_items',
    name: 'wms_stock_opname_items',
    displayName: 'WMS Stock Opname Items',
    phase: 4,
    phaseName: 'Phase 4: Detail / Item Tables',
    cascadeDelete: true,
    dependencies: ['wms_stock_opnames'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  }
];

// ============================================================================
// PHASE 5: MAIN TRANSACTION HEADERS (5 tables - PARTITIONED)
// ============================================================================
const PHASE_5_TABLES: CleanupTable[] = [
  {
    id: 'outgoing_goods',
    name: 'outgoing_goods',
    displayName: 'Outgoing Goods',
    phase: 5,
    phaseName: 'Phase 5: Main Transaction Headers',
    isPartitioned: true,
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['outgoing_good_items'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'adjustments',
    name: 'adjustments',
    displayName: 'Adjustments',
    phase: 5,
    phaseName: 'Phase 5: Main Transaction Headers',
    isPartitioned: true,
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['adjustment_items'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'production_outputs',
    name: 'production_outputs',
    displayName: 'Production Outputs',
    phase: 5,
    phaseName: 'Phase 5: Main Transaction Headers',
    isPartitioned: true,
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['production_output_items', 'work_order_fg_production'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'material_usages',
    name: 'material_usages',
    displayName: 'Material Usages',
    phase: 5,
    phaseName: 'Phase 5: Main Transaction Headers',
    isPartitioned: true,
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['material_usage_items', 'work_order_material_consumption'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'incoming_goods',
    name: 'incoming_goods',
    displayName: 'Incoming Goods',
    phase: 5,
    phaseName: 'Phase 5: Main Transaction Headers',
    isPartitioned: true,
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['incoming_good_items', 'outgoing_fg_production_traceability'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  }
];

// ============================================================================
// PHASE 6: BEGINNING BALANCE (2 tables)
// ============================================================================
const PHASE_6_TABLES: CleanupTable[] = [
  {
    id: 'beginning_balance_ppkeks',
    name: 'beginning_balance_ppkeks',
    displayName: 'Beginning Balance PPKEK References',
    phase: 6,
    phaseName: 'Phase 6: Beginning Balance',
    cascadeDelete: true,
    dependencies: ['beginning_balances'],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: {
      type: 'parent',
      parentTable: 'beginning_balances',
      parentCompanyColumn: 'company_code',
      childForeignKey: 'beginning_balance_id',
      parentPrimaryKey: 'id'
    }
  },
  {
    id: 'beginning_balances',
    name: 'beginning_balances',
    displayName: 'Beginning Balances',
    phase: 6,
    phaseName: 'Phase 6: Beginning Balance',
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['beginning_balance_ppkeks'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'wms_stock_opnames',
    name: 'wms_stock_opnames',
    displayName: 'WMS Stock Opnames',
    phase: 6,
    phaseName: 'Phase 6: Beginning Balance',
    cascadeDelete: false,
    dependencies: [],
    dependentTables: ['wms_stock_opname_items'],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  }
];

// ============================================================================
// PHASE 7: AUDIT & LOGGING (3 tables)
// ============================================================================
const PHASE_7_TABLES: CleanupTable[] = [
  {
    id: 'insw_tracking_log',
    name: 'insw_tracking_log',
    displayName: 'INSW Tracking Log',
    phase: 7,
    phaseName: 'Phase 7: Audit & Logging',
    cascadeDelete: false,
    dependencies: [],
    dependentTables: [],
    canDelete: false,
    selected: false,
    disabled: true,
    reason: 'INSW tracking logs are retained as integration history and are not part of application data cleanup.',
    companyScope: { type: 'direct', companyColumn: 'company_code' },
    cleanupEligibility: {
      fullReset: false,
      selectiveCleanup: false,
      dedicatedFeature: 'insw-cleanup',
      exclusionReason: 'Managed exclusively by the dedicated INSW Data Cleanup flow.',
    }
  },
  {
    id: 'activity_logs',
    name: 'activity_logs',
    displayName: 'Activity Logs',
    phase: 7,
    phaseName: 'Phase 7: Audit & Logging',
    cascadeDelete: false,
    dependencies: [],
    dependentTables: [],
    canDelete: true,
    selected: true,
    companyScope: { type: 'direct', companyColumn: 'company_code' }
  },
  {
    id: 'audit_logs',
    name: 'audit_logs',
    displayName: 'Audit Logs',
    phase: 7,
    phaseName: 'Phase 7: Audit & Logging',
    cascadeDelete: false,
    dependencies: [],
    dependentTables: [],
    canDelete: false,
    selected: false,
    disabled: true,
    reason: 'audit_logs has no reliable company ownership column or parent relationship.',
    companyScope: {
      type: 'unsupported',
      reason: 'audit_logs has no reliable company ownership column or parent relationship.'
    },
    cleanupEligibility: {
      fullReset: false,
      selectiveCleanup: false,
      exclusionReason: 'Unsupported shared audit data is preserved because it cannot be safely scoped to one company.'
    }
  }
];

// ============================================================================
// Complete table list
// ============================================================================
export const CLEANUP_TABLES: CleanupTable[] = [
  ...PHASE_1_TABLES,
  ...PHASE_2_TABLES,
  ...PHASE_3_TABLES,
  ...PHASE_4_TABLES,
  ...PHASE_5_TABLES,
  ...PHASE_6_TABLES,
  ...PHASE_7_TABLES
];

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Get all tables organized by phase
 */
export function getPhaseStructure(): Record<number, CleanupTable[]> {
  const phases: Record<number, CleanupTable[]> = {};
  for (let i = 1; i <= 7; i++) {
    phases[i] = CLEANUP_TABLES.filter(t => t.phase === i);
  }
  return phases;
}

/**
 * Get table by ID
 */
export function getTableById(id: string): CleanupTable | undefined {
  return CLEANUP_TABLES.find(t => t.id === id);
}

/**
 * Get table by name
 */
export function getTableByName(name: string): CleanupTable | undefined {
  return CLEANUP_TABLES.find(t => t.name === name);
}

/**
 * Get tables by phase
 */
export function getTablesByPhase(phase: number): CleanupTable[] {
  return CLEANUP_TABLES.filter(t => t.phase === phase);
}

/**
 * Get table dependencies
 */
export function getTableDependencies(tableId: string): {
  dependsOn: CleanupTable[];
  dependsOnThis: CleanupTable[];
} {
  const table = getTableById(tableId);
  if (!table) return { dependsOn: [], dependsOnThis: [] };

  const dependsOn = CLEANUP_TABLES.filter(t =>
    table.dependencies?.includes(t.id)
  );

  const dependsOnThis = CLEANUP_TABLES.filter(t =>
    t.dependencies?.includes(tableId)
  );

  return { dependsOn, dependsOnThis };
}

/**
 * Convert table ID to SQL name
 */
export function getTableSqlName(tableId: string): string {
  const table = getTableById(tableId);
  return table?.name || tableId;
}

/**
 * Get all table SQL names
 */
export function getAllTableSqlNames(): string[] {
  return CLEANUP_TABLES.map(t => t.name);
}

export function getCleanupEligibility(table: CleanupTable): CleanupEligibility {
  if (table.cleanupEligibility) {
    return table.cleanupEligibility;
  }

  if (table.companyScope.type === 'unsupported' || table.canDelete === false || table.disabled === true) {
    return {
      fullReset: false,
      selectiveCleanup: false,
      exclusionReason: table.reason,
    };
  }

  return {
    fullReset: true,
    selectiveCleanup: true,
  };
}

/**
 * Get application tables that Full Reset can execute.
 */
export function getFullResetTables(): CleanupTable[] {
  return CLEANUP_TABLES.filter(
    (table) => getCleanupEligibility(table).fullReset && table.companyScope.type !== 'unsupported'
  );
}

/**
 * Get application tables that Selective Cleanup can execute.
 */
export function getSelectiveCleanupTables(): CleanupTable[] {
  return CLEANUP_TABLES.filter(
    (table) => getCleanupEligibility(table).selectiveCleanup && table.companyScope.type !== 'unsupported'
  );
}

/**
 * Backward-compatible alias for application Full Reset executable tables.
 */
export function getCompanyScopedCleanupTables(): CleanupTable[] {
  return getFullResetTables();
}

/**
 * Get INSW-owned tracking tables. Local tracking logs are currently retained,
 * so this helper is classification metadata, not a delete list.
 */
export function getDedicatedINSWCleanupTables(): CleanupTable[] {
  return CLEANUP_TABLES.filter(
    (table) => getCleanupEligibility(table).dedicatedFeature === 'insw-cleanup'
  );
}

/**
 * Get tables that are intentionally excluded from cleanup because no safe
 * company ownership path exists.
 */
export function getUnsupportedCleanupTables(): CleanupTable[] {
  return CLEANUP_TABLES.filter((table) => table.companyScope.type === 'unsupported');
}

/**
 * Count total tables
 */
export function getTotalTableCount(): number {
  return CLEANUP_TABLES.length;
}

/**
 * Count tables by phase
 */
export function getTableCountByPhase(phase: number): number {
  return CLEANUP_TABLES.filter(t => t.phase === phase).length;
}

/**
 * Get phase info
 */
export const PHASE_INFO: Record<number, { name: string; description: string; tableCount: number }> = {
  1: {
    name: 'Scrap Management',
    description: 'Scrap transactions for capital goods',
    tableCount: 2
  },
  2: {
    name: 'Traceability / Allocation',
    description: 'Work order tracking and allocations',
    tableCount: 4
  },
  3: {
    name: 'Snapshot / Summary',
    description: 'Daily stock snapshots and recalc queue',
    tableCount: 3
  },
  4: {
    name: 'Detail / Item Tables',
    description: 'Line items from main transactions',
    tableCount: 6
  },
  5: {
    name: 'Main Transaction Headers',
    description: 'Main transaction documents (partitioned)',
    tableCount: 5
  },
  6: {
    name: 'Beginning Balance',
    description: 'Initial balances and WMS stock opname',
    tableCount: 3
  },
  7: {
    name: 'Audit & Logging',
    description: 'INSW tracking, activity & audit logs',
    tableCount: 3
  }
};

/**
 * Phase information interface
 */
export interface Phase {
  number: number;
  name: string;
  description?: string;
}

/**
 * Phase definitions for UI rendering
 */
export const PHASES: Phase[] = [
  { number: 1, name: 'Phase 1: Scrap Management', description: 'Scrap transactions' },
  { number: 2, name: 'Phase 2: Traceability / Allocation', description: 'Material allocation tracking' },
  { number: 3, name: 'Phase 3: Snapshot / Summary', description: 'Stock snapshots' },
  { number: 4, name: 'Phase 4: Detail / Item Tables', description: 'Transaction line items' },
  { number: 5, name: 'Phase 5: Main Transaction Headers', description: 'Transaction documents' },
  { number: 6, name: 'Phase 6: Beginning Balance', description: 'Initial balances' },
  { number: 7, name: 'Phase 7: Audit & Logging', description: 'Audit and activity logs' }
];

/**
 * Validate if tables exist
 */
export function validateTableIds(tableIds: string[]): { valid: boolean; invalid: string[] } {
  const validIds = CLEANUP_TABLES.map(t => t.id);
  const invalid = tableIds.filter(id => !validIds.includes(id));
  return {
    valid: invalid.length === 0,
    invalid
  };
}
