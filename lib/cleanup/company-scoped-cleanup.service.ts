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
