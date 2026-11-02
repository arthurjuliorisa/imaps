import { regenerationMessage, REGENERATION_SUCCESS } from '../insw-regeneration-messages';
import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { captureCompletedWmsSource, type CompletedSourceCapture } from '../insw-worker/completed-source-capture';
import { resolveInswCompanyConfig } from '../config/insw-company-config';
import { resolveWorkerAllowedCompanies } from '../config/insw-worker-config';
import { canonicalIdentity } from './contracts';
import { projectWmsInswStatus, wmsInswFactsSql, wmsSourceDomains, type WmsInswFacts } from './wms-log-status';

type Database = PrismaClient | Prisma.TransactionClient;
export class RegenerationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 409) { super(message); }
}
const refuse = (code: string, message: string): never => { throw new RegenerationError(code, message); };

// Accept only an audit reason. Identity, actor and destination are server-derived.
export function validateRegenerationRequest(value: unknown): string {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== 1 || !Object.hasOwn(value, 'reason')) {
    throw new RegenerationError('INVALID_REQUEST', regenerationMessage('INVALID_REQUEST'), 400);
  }
  const reason = (value as { reason?: unknown }).reason;
  if (typeof reason !== 'string' || !reason.trim() || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason)) {
    throw new RegenerationError('INVALID_REASON', regenerationMessage('INVALID_REASON'), 400);
  }
  return reason.trim();
}

async function facts(db: Database, logId: bigint, principal: { role: string; companyCode?: unknown }) {
  const company = Number(principal.companyCode);
  if (principal.role !== 'SUPER_ADMIN' && (!Number.isInteger(company) || company <= 0)) {
    throw new RegenerationError('FORBIDDEN', 'Assigned company required.', 403);
  }
  const rows = await db.$queryRaw<WmsInswFacts[]>(wmsInswFactsSql(Prisma.sql`w.id = ${logId}
    ${principal.role === 'SUPER_ADMIN' ? Prisma.empty : Prisma.sql`AND w.company_code = ${company}`}`));
  if (rows.length !== 1) throw new RegenerationError('NOT_FOUND', 'Eligible WMS audit/source not found in your company scope.', 404);
  const row = rows[0];
  let allowed: readonly number[] = [];
  try { allowed = resolveWorkerAllowedCompanies(); } catch { /* No inferred authorization. */ }
  if (!allowed.includes(row.company_code)) refuse('ADMISSION_DENIED', 'Company is not admitted for this queue in the application process.');
  if (row.queues.length || row.history_count || row.remote_success || row.history_mismatch) refuse('TRANSMISSION_HISTORY_EXISTS', 'Existing queue, tracking or conflicting delivery history blocks regeneration.');
  if (!projectWmsInswStatus(row, true).canRegenerate) refuse('LOCAL_HISTORY_OR_SOURCE_BLOCK', 'Source is incomplete, ambiguous, or already has queue/tracking evidence. Use INSW Logs reconciliation or guarded RESEND.');
  const orphan = await db.insw_tracking_log.findFirst({ where: { company_code: row.company_code,
    transaction_type: row.operation.toLowerCase(), OR: [{ wms_id: null, transaction_id: null }, { wms_id: '', transaction_id: null }] }, select: { id: true } });
  if (orphan) refuse('ORPHAN_DELIVERY_HISTORY', 'Unlinked INSW tracking exists for this company/domain. Reconcile that history before regeneration.');
  return row;
}

// Snapshot persisted header + active details, including aliases and readiness
// fields, without recreating any converter. Repeat after the canonical lock.
async function sourceSnapshot(db: Database, row: WmsInswFacts, lock = false) {
  const domain = wmsSourceDomains.find(d => d[0] === row.operation)!;
  const [, , table, , items, prefix] = domain;
  const stock = row.operation === 'STOCK_OPNAME';
  const parent = stock ? 'wms_stock_opname_id' : `${prefix}_id`;
  const scope = stock ? Prisma.sql`i.company_code = g.company_code` : Prisma.sql`i.${Prisma.raw(prefix + '_company')} = g.company_code AND i.deleted_at IS NULL`;
  if (lock) {
    await db.$queryRaw(Prisma.sql`SELECT g.id FROM ${Prisma.raw(table)} g WHERE g.id = ${row.source_id} AND g.company_code = ${row.company_code} FOR UPDATE`);
    await db.$queryRaw(Prisma.sql`SELECT i.id FROM ${Prisma.raw(items)} i JOIN ${Prisma.raw(table)} g ON i.${Prisma.raw(parent)} = g.id
      WHERE g.id = ${row.source_id} AND g.company_code = ${row.company_code} AND ${scope} FOR SHARE OF i`);
  }
  const [snapshot] = await db.$queryRaw<{ value: string }[]>(Prisma.sql`SELECT jsonb_build_object('header', to_jsonb(g), 'details',
    (SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM ${Prisma.raw(items)} i WHERE i.${Prisma.raw(parent)} = g.id AND ${scope}))::text AS value
    FROM ${Prisma.raw(table)} g WHERE g.id = ${row.source_id} AND g.company_code = ${row.company_code}`);
  if (!snapshot) refuse('SOURCE_CHANGED', 'Source disappeared during regeneration. Refresh and review.');
  return createHash('sha256').update(snapshot.value).digest('hex');
}

export async function regenerateWmsInsw(db: PrismaClient, principal: { id: string; role: string; companyCode?: unknown },
  logId: bigint, request: unknown) {
  const reason = validateRegenerationRequest(request);
  const row = await facts(db, logId, principal);
  const config = resolveInswCompanyConfig(row.company_code);
  const destination = config.useTestMode ? 'TEST' : 'REAL';
  const identity = canonicalIdentity(row.operation === 'ADJUSTMENT' || row.operation === 'STOCK_OPNAME'
    ? { kind: 'SOURCE_HEADER', operation: row.operation, companyCode: row.company_code, sourceId: Number(row.source_id), revision: row.revision!, businessDate: row.business_date! }
    : { kind: 'WMS_REFERENCE', operation: row.operation, companyCode: row.company_code, reference: row.wms_id!, revision: row.revision!, businessDate: row.business_date! });
  const snapshot = await sourceSnapshot(db, row);
  // An async failure audit on this reference invalidates a SUCCESS acceptance.
  const failed = await db.wms_transmission_logs.findFirst({ where: { company_code: row.company_code,
    wms_id: row.wms_id, transmission_status: { in: ['FAILED', 'ERROR', 'RETRYING'] } }, select: { id: true } });
  if (failed) refuse('BUSINESS_COMPLETION_REQUIRES_REVIEW', 'Failure/retry history exists for this reference. Resolve local business processing before regeneration.');
  const common = { companyCode: row.company_code, businessDate: row.business_date!, revision: row.revision!, requestedBy: principal.id,
    completion: 'MANUAL_REGENERATION_SERVER_CHECKS' as const };
  const input: CompletedSourceCapture = row.operation === 'OUTGOING' ? { ...common, operation: row.operation, wmsReference: row.wms_id! }
    : { ...common, operation: row.operation, sourceId: row.source_id! };
  const result = await captureCompletedWmsSource(db, input, {
    recheck: async tx => {
      await tx.$queryRaw`SELECT id FROM wms_transmission_logs WHERE id = ${logId} FOR SHARE`;
      const current = await facts(tx, logId, principal);
      if (current.source_id !== row.source_id || current.revision !== row.revision || current.business_date !== row.business_date
        || current.wms_id !== row.wms_id || current.operation !== row.operation || current.company_code !== row.company_code
        || await sourceSnapshot(tx, current, true) !== snapshot) refuse('SOURCE_CHANGED', 'Source changed during regeneration. Refresh and review again.');
      const failures = await tx.wms_transmission_logs.count({ where: { company_code: row.company_code, wms_id: row.wms_id,
        transmission_status: { in: ['FAILED', 'ERROR', 'RETRYING'] } } });
      if (failures) refuse('SOURCE_CHANGED', 'Business processing history changed during regeneration.');
      const now = resolveInswCompanyConfig(row.company_code);
      if (now.useTestMode !== config.useTestMode || now.apiKey !== config.apiKey || now.uniqueKey !== config.uniqueKey) refuse('SOURCE_CHANGED', 'INSW account or TEST/REAL configuration changed during regeneration.');
    },
    audit: async (tx, queueId, payload) => {
      await tx.activity_logs.create({ data: { user_id: principal.id, company_code: row.company_code,
        action: 'WMS_REGENERATE_INSW_TRANSMISSION', description: 'Initial INSW queue created; not yet transmitted.',
        metadata: { wms_log_id: String(logId), source_id: String(row.source_id), operation: row.operation,
          identity_key: identity.key, wms_reference: row.wms_id, business_date: row.business_date, revision: row.revision,
          activity: payload.data[0].kdKegiatan, destination, remote_check: 'OPERATOR_WEBSITE_CONFIRMATION_NOT_SYSTEM_VERIFIED',
          reason, queue_id: queueId } } });
    },
  });
  return { success: true, queue_id: result.id, destination, message: REGENERATION_SUCCESS };
}
