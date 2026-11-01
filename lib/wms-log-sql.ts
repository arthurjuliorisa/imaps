import { Prisma } from '@prisma/client';
import type { WmsLogWhere } from './wms-log-filters';
import { wmsInswMatchingIds } from './insw-queue/wms-log-status';

/** Authorized list/export predicate. The optional INSW classification is inside
 * WHERE, before counting, ordering, pagination and CSV cursor selection. */
export function bindWmsCsvFilters(where: WmsLogWhere): Prisma.Sql {
  const terms = [Prisma.sql`TRUE`];
  if (where.company_code !== undefined) terms.push(Prisma.sql`log.company_code = ${where.company_code}`);
  if (where.action !== undefined) terms.push(Prisma.sql`log.action = ${where.action}`);
  if (where.transmission_status !== undefined) terms.push(Prisma.sql`log.transmission_status = ${where.transmission_status}`);
  if (where.error_type !== undefined) terms.push(Prisma.sql`log.error_type = ${where.error_type}`);
  if (where.wms_id) terms.push(Prisma.sql`log.wms_id ILIKE ${`%${where.wms_id.contains}%`} ESCAPE E'\\\\'`);
  if (where.created_at?.gte) terms.push(Prisma.sql`log.created_at >= ${where.created_at.gte.toISOString()}::timestamptz`);
  if (where.created_at?.lte) terms.push(Prisma.sql`log.created_at <= ${where.created_at.lte.toISOString()}::timestamptz`);
  if (where.insw_status) terms.push(Prisma.sql`log.id IN (${wmsInswMatchingIds(Prisma.join(terms, ' AND '), where.insw_status)})`);
  return Prisma.join(terms, ' AND ');
}

