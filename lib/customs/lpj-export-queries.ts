import { prisma } from '@/lib/prisma';
import { serializeBigInt } from '@/lib/bigint-serializer';

export type LpjExportKind = 'wip' | 'raw-material' | 'production' | 'scrap' | 'capital-goods';

export interface LpjExportFilters {
  companyCode: number;
  startDate: Date;
  endDate: Date;
  search?: string | null;
  itemType?: string | null;
}

function cleanFilter(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function numericString(value: unknown): string {
  return value === null || value === undefined ? '0' : String(value);
}

export async function countWipRows(filters: LpjExportFilters): Promise<number> {
  let query = `SELECT COUNT(*) as count FROM vw_lpj_wip WHERE company_code = $1 AND stock_date = $2::DATE`;
  const params: unknown[] = [filters.companyCode, filters.startDate];
  let paramIndex = 3;
  const search = cleanFilter(filters.search);
  const itemType = cleanFilter(filters.itemType);

  if (itemType) {
    query += ` AND item_type = $${paramIndex}`;
    params.push(itemType);
    paramIndex++;
  }

  if (search) {
    query += ` AND (
      company_name ILIKE $${paramIndex}
      OR item_code ILIKE $${paramIndex}
      OR item_name ILIKE $${paramIndex}
      OR item_type ILIKE $${paramIndex}
      OR unit_quantity ILIKE $${paramIndex}
      OR COALESCE(remarks, '') ILIKE $${paramIndex}
    )`;
    params.push(`%${search}%`);
  }

  const result = await prisma.$queryRawUnsafe<[{ count: bigint }]>(query, ...params);
  return Number(result[0]?.count ?? 0);
}

export async function fetchWipRows(filters: LpjExportFilters): Promise<Record<string, unknown>[]> {
  let query = `
    SELECT
      no,
      company_name,
      item_code,
      item_name,
      item_type,
      unit_quantity,
      quantity,
      stock_date,
      remarks,
      created_at
    FROM vw_lpj_wip
    WHERE company_code = $1
      AND stock_date = $2::DATE
  `;
  const params: unknown[] = [filters.companyCode, filters.startDate];
  let paramIndex = 3;
  const search = cleanFilter(filters.search);
  const itemType = cleanFilter(filters.itemType);

  if (itemType) {
    query += ` AND item_type = $${paramIndex}`;
    params.push(itemType);
    paramIndex++;
  }

  if (search) {
    query += ` AND (
      company_name ILIKE $${paramIndex}
      OR item_code ILIKE $${paramIndex}
      OR item_name ILIKE $${paramIndex}
      OR item_type ILIKE $${paramIndex}
      OR unit_quantity ILIKE $${paramIndex}
      OR COALESCE(remarks, '') ILIKE $${paramIndex}
    )`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY item_code`;

  const rows = await prisma.$queryRawUnsafe<any[]>(query, ...params);
  return serializeBigInt(rows).map((row: any) => ({
    no: Number(row.no ?? 0),
    companyName: row.company_name,
    itemCode: row.item_code,
    itemName: row.item_name,
    itemType: row.item_type,
    unitQuantity: row.unit_quantity,
    quantity: Number(row.quantity ?? 0),
    stockDate: row.stock_date,
    remarks: row.remarks ?? '-',
    createdAt: row.created_at,
  }));
}

function lpjFunctionConfig(kind: Exclude<LpjExportKind, 'wip'>): {
  functionName: string;
  itemTypes: string[];
  searchPrefix: string;
  usesScrapAdjustment: boolean;
} {
  switch (kind) {
    case 'raw-material':
      return {
        functionName: 'fn_calculate_lpj_bahan_baku',
        itemTypes: ['ROH', 'HALB', 'HIBE'],
        searchPrefix: '',
        usesScrapAdjustment: false,
      };
    case 'production':
      return {
        functionName: 'fn_calculate_lpj_hasil_produksi',
        itemTypes: ['FERT', 'HALB'],
        searchPrefix: '',
        usesScrapAdjustment: false,
      };
    case 'scrap':
      return {
        functionName: 'fn_calculate_lpj_barang_sisa',
        itemTypes: ['SCRAP'],
        searchPrefix: 'lpj.',
        usesScrapAdjustment: true,
      };
    case 'capital-goods':
      return {
        functionName: 'fn_calculate_lpj_bahan_baku',
        itemTypes: ['HIBE-M', 'HIBE-E', 'HIBE-T'],
        searchPrefix: '',
        usesScrapAdjustment: false,
      };
  }
}

function itemTypesSql(itemTypes: string[]): string {
  return `ARRAY[${itemTypes.map((type) => `'${type}'`).join(', ')}]`;
}

export async function countMutationRows(
  kind: Exclude<LpjExportKind, 'wip'>,
  filters: LpjExportFilters
): Promise<number> {
  const config = lpjFunctionConfig(kind);
  let query = `
    SELECT COUNT(DISTINCT ROW(item_code, unit_quantity)) as count
    FROM ${config.functionName}(
      ${itemTypesSql(config.itemTypes)},
      $2::DATE,
      $3::DATE
    )
    WHERE company_code = $1
  `;
  const params: unknown[] = [filters.companyCode, filters.startDate, filters.endDate];
  let paramIndex = 4;
  const search = cleanFilter(filters.search);
  const itemType = cleanFilter(filters.itemType);

  if (itemType) {
    query += ` AND item_type = $${paramIndex}`;
    params.push(itemType);
    paramIndex++;
  }

  if (search) {
    query += ` AND (
      company_name ILIKE $${paramIndex}
      OR item_code ILIKE $${paramIndex}
      OR item_name ILIKE $${paramIndex}
      OR item_type ILIKE $${paramIndex}
      OR unit_quantity ILIKE $${paramIndex}
      ${kind === 'raw-material' ? `OR company_code::text ILIKE $${paramIndex}` : ''}
      ${kind === 'production' ? `OR COALESCE(currency::text, '') ILIKE $${paramIndex}` : ''}
      ${kind === 'scrap' ? `OR COALESCE(remarks, '') ILIKE $${paramIndex}` : ''}
    )`;
    params.push(`%${search}%`);
  }

  const result = await prisma.$queryRawUnsafe<[{ count: bigint }]>(query, ...params);
  return Number(result[0]?.count ?? 0);
}

export async function fetchMutationRows(
  kind: Exclude<LpjExportKind, 'wip'>,
  filters: LpjExportFilters
): Promise<Record<string, unknown>[]> {
  const config = lpjFunctionConfig(kind);
  const search = cleanFilter(filters.search);
  const itemType = cleanFilter(filters.itemType);
  const params: unknown[] = [filters.companyCode, filters.startDate, filters.endDate];
  let paramIndex = 4;
  const sourceSql = config.usesScrapAdjustment
    ? `
      WITH lpj AS (
        SELECT *
        FROM ${config.functionName}(
          ${itemTypesSql(config.itemTypes)},
          $2::DATE,
          $3::DATE
        )
      ),
      range_adjustments AS (
        SELECT
          company_code,
          item_code,
          uom,
          SUM(adjustment_qty)::NUMERIC(15,3) AS adjustment
        FROM stock_daily_snapshot
        WHERE item_type = 'SCRAP'
          AND company_code = $1
          AND snapshot_date BETWEEN $2::DATE AND $3::DATE
        GROUP BY company_code, item_code, uom
      )
      SELECT
        lpj.no,
        lpj.company_code,
        lpj.company_name,
        lpj.item_code,
        lpj.item_name,
        lpj.item_type,
        lpj.unit_quantity as unit,
        lpj.snapshot_date,
        lpj.opening_balance as beginning,
        lpj.quantity_received as "in",
        lpj.quantity_issued_outgoing as "out",
        COALESCE(range_adjustments.adjustment, lpj.adjustment, 0::NUMERIC(15,3)) as adjustment,
        lpj.closing_balance as ending,
        lpj.stock_count_result as "stockOpname",
        lpj.quantity_difference as variant,
        lpj.value_amount,
        lpj.currency,
        lpj.remarks
      FROM lpj
      LEFT JOIN range_adjustments
        ON range_adjustments.company_code = lpj.company_code
       AND range_adjustments.item_code = lpj.item_code
       AND COALESCE(range_adjustments.uom, 'UNIT') = lpj.unit_quantity
      WHERE lpj.company_code = $1
    `
    : `
      SELECT
        no,
        company_code,
        company_name,
        item_code,
        item_name,
        item_type,
        unit_quantity as unit,
        snapshot_date,
        opening_balance as beginning,
        quantity_received as "in",
        quantity_issued_outgoing as "out",
        adjustment,
        closing_balance as ending,
        stock_count_result as "stockOpname",
        quantity_difference as variant,
        value_amount,
        currency,
        remarks
      FROM ${config.functionName}(
        ${itemTypesSql(config.itemTypes)},
        $2::DATE,
        $3::DATE
      )
      WHERE company_code = $1
    `;

  let query = sourceSql;
  const prefix = config.searchPrefix;

  if (itemType) {
    query += ` AND ${prefix}item_type = $${paramIndex}`;
    params.push(itemType);
    paramIndex++;
  }

  if (search) {
    query += ` AND (
      ${prefix}company_name ILIKE $${paramIndex}
      OR ${prefix}item_code ILIKE $${paramIndex}
      OR ${prefix}item_name ILIKE $${paramIndex}
      OR ${prefix}item_type ILIKE $${paramIndex}
      OR ${prefix}unit_quantity ILIKE $${paramIndex}
      ${kind === 'raw-material' ? `OR ${prefix}company_code::text ILIKE $${paramIndex}` : ''}
      ${kind === 'production' ? `OR COALESCE(${prefix}currency::text, '') ILIKE $${paramIndex}` : ''}
      ${kind === 'scrap' ? `OR COALESCE(${prefix}remarks, '') ILIKE $${paramIndex}` : ''}
    )`;
    params.push(`%${search}%`);
  }

  query += ` ORDER BY ${prefix}item_code`;

  const rows = await prisma.$queryRawUnsafe<any[]>(query, ...params);
  return serializeBigInt(rows).map((row: any, index: number) => ({
    no: index + 1,
    companyName: row.company_name,
    itemCode: row.item_code,
    itemName: row.item_name,
    itemType: row.item_type,
    unit: row.unit || 'N/A',
    beginning: numericString(row.beginning),
    in: numericString(row.in),
    out: numericString(row.out),
    adjustment: numericString(row.adjustment),
    ending: numericString(row.ending),
    stockOpname: numericString(row.stockOpname),
    variant: numericString(row.variant),
    remarks: row.remarks ?? '-',
  }));
}
