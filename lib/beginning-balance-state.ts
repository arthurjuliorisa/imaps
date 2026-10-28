import type { Prisma } from '@prisma/client';

export class BeginningBalanceStateError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export function summarizeBeginningBalanceState(statuses: readonly string[]) {
  const distinct = new Set(statuses);
  return {
    overallStatus: distinct.has('LOCKED') ? 'LOCKED'
      : distinct.has('TRANSMITTED_TO_INSW') ? 'TRANSMITTED_TO_INSW' : 'OPEN',
    mixedStatus: distinct.size > 1,
  };
}

export async function readBeginningBalanceState(tx: Prisma.TransactionClient, companyCode: number) {
  const groups = await tx.beginning_balances.groupBy({
    by: ['status'],
    where: { company_code: companyCode, deleted_at: null },
  });
  return { ...summarizeBeginningBalanceState(groups.map(group => group.status)), hasRows: groups.length > 0 };
}

/**
 * All Beginning Balance writers take this company mutex before reading state.
 * Use READ COMMITTED so a waiter sees the preceding transaction's committed state.
 * The two-int advisory namespace is separate from existing bigint inventory locks;
 * no company row lock is held that could block unrelated WMS foreign-key inserts.
 */
export async function serializeBeginningBalance(tx: Prisma.TransactionClient, companyCode: number) {
  await tx.$queryRawUnsafe(
    'SELECT 1 AS locked FROM pg_advisory_xact_lock(1111641171::int, $1::int)', companyCode
  );
}

export async function guardBeginningBalanceWrite(tx: Prisma.TransactionClient, companyCode: number) {
  await serializeBeginningBalance(tx, companyCode);
  const state = await readBeginningBalanceState(tx, companyCode);
  if (state.overallStatus === 'LOCKED') {
    throw new BeginningBalanceStateError('Company Beginning Balance is LOCKED; changes are not allowed');
  }
  // Historical mixed states require an explicit policy; never normalize silently.
  if (state.mixedStatus) {
    throw new BeginningBalanceStateError('Company Beginning Balance has mixed statuses; review is required before changes');
  }
  return state;
}

/** Caller must authorize Admin and resolve company_type === BZ before entering. */
export async function lockBeginningBalanceLocally(tx: Prisma.TransactionClient, companyCode: number) {
  await serializeBeginningBalance(tx, companyCode);
  const state = await readBeginningBalanceState(tx, companyCode);
  if (!state.hasRows) throw new BeginningBalanceStateError('Cannot lock Beginning Balance without active rows');
  if (state.mixedStatus) throw new BeginningBalanceStateError('Company Beginning Balance has mixed statuses; review is required before locking');
  if (state.overallStatus === 'LOCKED') return { alreadyLocked: true };
  await tx.beginning_balances.updateMany({
    where: { company_code: companyCode, deleted_at: null },
    data: { status: 'LOCKED' },
  });
  return { alreadyLocked: false };
}

/** Reject supplied company selectors; authenticated context remains authoritative. */
export function assertBeginningBalanceCompanyScope(request: Request, companyCode: number, body?: Record<string, unknown> | null) {
  const query = new URL(request.url).searchParams;
  for (const key of ['company_code', 'companyCode']) {
    for (const value of [...query.getAll(key), ...(body?.[key] === undefined ? [] : [body[key]])]) {
      if (Number(value) !== companyCode) {
        throw new BeginningBalanceStateError('Forbidden company scope', 403);
      }
    }
  }
}
