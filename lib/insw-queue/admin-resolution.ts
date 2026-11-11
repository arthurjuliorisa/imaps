import { type PrismaClient } from '@prisma/client';
import { lockIncomingBusinessReference } from './incoming-handoff';
import { canResolveQueue } from './operational-state';

export class ResolutionError extends Error {
  constructor(public readonly code: string, public readonly status = 409) { super(code); }
}
export function resolutionNotes(body: unknown): string {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
    || !Object.hasOwn(body, 'notes')) throw new ResolutionError('INVALID_REQUEST', 400);
  const notes = (body as { notes: unknown }).notes;
  if (typeof notes !== 'string' || !notes.trim() || notes.length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes)) {
    throw new ResolutionError('Resolution notes must contain 1–2000 characters.', 400);
  }
  return notes.trim();
}

/** Gate -> reference -> identity -> queue, compatible with worker admission and
 * resend. No transport, queue update, attempt creation or provider dependency. */
export async function resolveQueue(db: PrismaClient, principal: { id: string; role: string; companyCode?: unknown }, queueId: string, body: unknown) {
  if (principal.role !== 'ADMIN') throw new ResolutionError('FORBIDDEN', 403);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(queueId)) throw new ResolutionError('INVALID_TARGET', 400);
  const notes = resolutionNotes(body);
  const company = Number(principal.companyCode);
  if (!Number.isInteger(company) || company <= 0) throw new ResolutionError('FORBIDDEN', 403);
  return db.$transaction(async tx => {
    // JWT role/company cannot outlive an account change for this command.
    const [actor] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users
      WHERE id = ${principal.id} AND role = 'ADMIN' AND company_code = ${company}
        AND is_active AND deleted_at IS NULL FOR SHARE`;
    if (!actor) throw new ResolutionError('FORBIDDEN', 403);
    const target = await tx.insw_queue_cycle.findFirst({ where: { id: queueId, company_code: company },
      select: { identity_key: true, operation: true, wms_reference: true } });
    if (!target) throw new ResolutionError('NOT_FOUND', 404);
    // Hold admission while testing gate ownership and the stable terminal row.
    await tx.$queryRaw`SELECT id FROM insw_dispatch_gate WHERE id = 1 FOR UPDATE`;
    if (target.wms_reference) await lockIncomingBusinessReference(tx, { companyCode: company,
      operation: target.operation, wmsReference: target.wms_reference });
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${target.identity_key}, 0))::text`;
    const [q] = await tx.$queryRaw<{ id: string; status: string; owner_token: string | null; lease_until: Date | null }[]>`
      SELECT id, status, owner_token, lease_until FROM insw_queue_cycle
      WHERE identity_key = ${target.identity_key} AND company_code = ${company}
      ORDER BY cycle DESC LIMIT 1 FOR UPDATE`;
    if (q?.id !== queueId) throw new ResolutionError('TARGET_CHANGED');
    const [existing] = await tx.$queryRaw<{ queue_id: string }[]>`SELECT queue_id FROM insw_admin_resolution WHERE queue_id = ${queueId}::uuid`;
    if (existing) return { success: true, status: 'already_resolved', queue_id: queueId };
    if (!canResolveQueue(q)) throw new ResolutionError('NOT_ELIGIBLE');
    const [busy] = await tx.$queryRaw<{ busy: boolean }[]>`SELECT EXISTS (
      SELECT 1 FROM insw_queue_attempt a WHERE a.queue_id = ${queueId}::uuid
        AND (a.completed_at IS NULL OR EXISTS (SELECT 1 FROM insw_dispatch_gate g WHERE g.busy_attempt_id = a.id))
    ) AS busy`;
    if (busy.busy) throw new ResolutionError('TRANSMISSION_IN_FLIGHT');
    await tx.$executeRaw`INSERT INTO insw_admin_resolution (queue_id, resolved_by, notes)
      VALUES (${queueId}::uuid, ${actor.id}, ${notes})`;
    return { success: true, status: 'resolved', queue_id: queueId };
  }, { maxWait: 5000, timeout: 10000 });
}
