import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  CLEANUP_TABLES,
  CleanupTable,
  getTableById,
  getCleanupEligibility,
  getUnsupportedCleanupTables as getUnsupportedTablesFromConfig,
} from '@/lib/cleanup/table-config';

export class CleanupScopeError extends Error {
  status: number;
  tableId?: string;

  constructor(message: string, tableId?: string, status = 400) {
    super(message);
    this.name = 'CleanupScopeError';
    this.status = status;
    this.tableId = tableId;
  }
}

export type CleanupEligibilityMode = 'fullReset' | 'selectiveCleanup';

type CleanupDbClient = PrismaClient | Prisma.TransactionClient;

function getConfiguredTable(tableId: string): CleanupTable {
  const table = getTableById(tableId);
  if (!table) {
    throw new CleanupScopeError(`Unknown cleanup table: ${tableId}`, tableId);
  }
  return table;
}

function identifier(value: string): Prisma.Sql {
  return Prisma.raw(value);
}

function scopedWhereSql(table: CleanupTable, companyCode: number, alias = 'target'): Prisma.Sql {
  const scope = table.companyScope;

  if (scope.type === 'unsupported') {
    throw new CleanupScopeError(
      `${table.displayName} cannot be cleaned safely: ${scope.reason}`,
      table.id
    );
  }

  if (scope.type === 'direct') {
    return Prisma.sql`${identifier(alias)}.${identifier(scope.companyColumn)} = ${companyCode}`;
  }

  return Prisma.sql`EXISTS (
    SELECT 1
    FROM ${identifier(scope.parentTable)} parent
    WHERE parent.${identifier(scope.parentPrimaryKey)} = ${identifier(alias)}.${identifier(scope.childForeignKey)}
      AND parent.${identifier(scope.parentCompanyColumn)} = ${companyCode}
  )`;
}

export function validateCleanupTableScopes(
  tableIds: string[],
  mode?: CleanupEligibilityMode
): CleanupTable[] {
  const tables = tableIds.map(getConfiguredTable);
  const unsupported = tables.find((table) => table.companyScope.type === 'unsupported');

  if (unsupported?.companyScope.type === 'unsupported') {
    throw new CleanupScopeError(
      `${unsupported.displayName} cannot be cleaned safely: ${unsupported.companyScope.reason}`,
      unsupported.id
    );
  }

  if (mode) {
    const ineligible = tables.find((table) => !getCleanupEligibility(table)[mode]);
    if (ineligible) {
      const eligibility = getCleanupEligibility(ineligible);
      throw new CleanupScopeError(
        `${ineligible.displayName} cannot be cleaned by ${mode === 'fullReset' ? 'Full Reset' : 'Selective Cleanup'}: ${eligibility.exclusionReason || ineligible.reason || 'This table is not eligible for this cleanup feature.'}`,
        ineligible.id
      );
    }
  }

  return tables;
}

export async function countRowsForCompany(
  tableId: string,
  companyCode: number,
  client: CleanupDbClient = prisma
): Promise<number> {
  const table = getConfiguredTable(tableId);
  const whereSql = scopedWhereSql(table, companyCode);

  const result = await client.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint as count
    FROM ${identifier(table.name)} target
    WHERE ${whereSql}
  `;

  return Number(result[0]?.count ?? 0);
}

export async function deleteRowsForCompany(
  tableId: string,
  companyCode: number,
  client: CleanupDbClient = prisma
): Promise<number> {
  const table = getConfiguredTable(tableId);
  const whereSql = scopedWhereSql(table, companyCode);

  if (tableId === 'scrap_transaction_items') {
    const [conflict] = await client.$queryRaw<Array<{ id: number; scrap_transaction_item_id: number; outgoing_good_date: Date }>>`
      SELECT g.id, g.scrap_transaction_item_id, g.outgoing_good_date
      FROM outgoing_good_items g JOIN scrap_transaction_items s
        ON s.scrap_transaction_company = g.outgoing_good_company AND s.id = g.scrap_transaction_item_id
        AND s.scrap_transaction_date = g.outgoing_good_date
      WHERE s.scrap_transaction_company = ${companyCode}
      LIMIT 1
    `;
    if (conflict) throw new CleanupScopeError(
      `Scrap item cleanup scope conflict: retained outgoing_good_items company=${companyCode}, id=${conflict.id}, outgoing_good_date=${conflict.outgoing_good_date.toISOString().slice(0, 10)} references scrap_transaction_items id=${conflict.scrap_transaction_item_id}. Select the referencing outgoing item scope as well.`,
      tableId, 409);
  }

  if (tableId === 'scrap_transactions') {
    // Never expand a selective request to retained outgoing records. Composite
    // identity includes company and business date, exactly like the RESTRICT FK.
    const [conflict] = await client.$queryRaw<Array<{ id: number; scrap_transaction_id: number; outgoing_date: Date }>>`
      SELECT g.id, g.scrap_transaction_id, g.outgoing_date
      FROM outgoing_goods g JOIN scrap_transactions s
        ON s.company_code = g.company_code AND s.id = g.scrap_transaction_id
        AND s.transaction_date = g.outgoing_date
      WHERE s.company_code = ${companyCode}
      LIMIT 1
    `;
    if (conflict) throw new CleanupScopeError(
      `Scrap cleanup scope conflict: retained outgoing_goods company=${companyCode}, id=${conflict.id}, outgoing_date=${conflict.outgoing_date.toISOString().slice(0, 10)} references scrap_transactions id=${conflict.scrap_transaction_id}. Select the referencing outgoing scope as well.`,
      tableId, 409);
  }

  const result = await client.$executeRaw`
    DELETE FROM ${identifier(table.name)} target
    WHERE ${whereSql}
  `;

  return Number(result ?? 0);
}

export async function countRowsForCompanyByTableIds(
  tableIds: string[],
  companyCode: number
): Promise<Record<string, number>> {
  validateCleanupTableScopes(tableIds);

  const rowCounts: Record<string, number> = {};
  for (const tableId of tableIds) {
    rowCounts[tableId] = await countRowsForCompany(tableId, companyCode);
  }

  return rowCounts;
}

export function getUnsupportedCleanupTables(): CleanupTable[] {
  return getUnsupportedTablesFromConfig();
}
