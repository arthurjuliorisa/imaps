import { createHash } from 'node:crypto';
import { InswQueueOperation, Prisma } from '@prisma/client';

type HeaderOperation = 'INCOMING' | 'OUTGOING' | 'MATERIAL_USAGE' | 'PRODUCTION_OUTPUT' | 'ADJUSTMENT' | 'STOCK_OPNAME' | 'CAPITAL_OUTGOING';
type Revision = { revision: string; businessDate: string };
export type TransmissionIdentity = Revision & { companyCode: number } & (
  | { kind: 'SOURCE_HEADER'; operation: HeaderOperation; sourceId: number | bigint | string }
  | { kind: 'WMS_REFERENCE'; operation: Exclude<HeaderOperation, 'STOCK_OPNAME'>; reference: string }
  | { kind: 'SCRAP'; operation: 'SCRAP_INCOMING' | 'SCRAP_OUTGOING'; sourceId: number | bigint | string; actionKey: string }
  | { kind: 'COMPANY_BALANCE'; operation: 'SALDO_AWAL' | 'FINAL_REGISTRATION'; balanceSet: string }
);

export function boundedText(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > max || /[\u0000-\u001f]/.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}
export function integer(value: unknown, name: string, min: number, max = 2147483647): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${name}`);
  return value;
}
function sourceId(value: unknown): string {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 1)) throw new Error('Invalid source ID');
  if (!['number', 'string', 'bigint'].includes(typeof value) || !/^[1-9]\d*$/.test(String(value)) || BigInt(String(value)) > BigInt('9223372036854775807')) throw new Error('Invalid source ID');
  return String(value);
}
const headers: readonly string[] = ['INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME', 'CAPITAL_OUTGOING'];
export function canonicalIdentity(input: TransmissionIdentity) {
  integer(input.companyCode, 'company code', 1);
  const revision = boundedText(input.revision, 'source revision', 200);
  const date = boundedText(input.businessDate, 'business date', 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('Invalid business date');
  let key: string[];
  switch (input.kind) {
    case 'SOURCE_HEADER':
      if (!headers.includes(input.operation)) throw new Error('Invalid header operation');
      key = [sourceId(input.sourceId)]; break;
    case 'WMS_REFERENCE':
      if (!headers.includes(input.operation) || input.operation as string === 'STOCK_OPNAME') throw new Error('Invalid WMS operation');
      key = [boundedText(input.reference, 'WMS reference', 100)]; break;
    case 'SCRAP':
      if (!['SCRAP_INCOMING', 'SCRAP_OUTGOING'].includes(input.operation)) throw new Error('Invalid Scrap operation');
      key = [sourceId(input.sourceId), boundedText(input.actionKey, 'Scrap action key', 100)]; break;
    case 'COMPANY_BALANCE':
      if (!['SALDO_AWAL', 'FINAL_REGISTRATION'].includes(input.operation)) throw new Error('Invalid balance operation');
      key = [boundedText(input.balanceSet, 'balance set', 200)]; break;
    default: throw new Error('Invalid identity shape');
  }
  return {
    key: boundedText(JSON.stringify(['insw-v1', input.companyCode, input.operation, input.kind, ...key, revision, date]), 'canonical identity', 2000),
    companyCode: input.companyCode, operation: input.operation as InswQueueOperation, revision, businessDate: date,
  };
}

// Accept JSON values only. Sorting object keys makes insertion order irrelevant.
export function freezePayload(value: unknown): { payload: Prisma.InputJsonValue; sha256: string } {
  const seen = new Set<object>();
  function canonical(v: unknown, depth: number): string {
    if (depth > 100) throw new Error('Payload nesting exceeds limit');
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return JSON.stringify(v);
    if (typeof v === 'number' && Number.isFinite(v)) return JSON.stringify(v);
    if (typeof v !== 'object' || v === null || seen.has(v)) throw new Error('Payload must be acyclic JSON');
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) throw new Error('Payload must be plain JSON');
    seen.add(v);
    const result = Array.isArray(v)
      ? `[${Array.from(v, item => canonical(item, depth + 1)).join(',')}]`
      : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k], depth + 1)}`).join(',')}}`;
    seen.delete(v);
    return result;
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Payload must be a JSON object');
  const json = canonical(value, 0);
  return { payload: JSON.parse(json), sha256: createHash('sha256').update(json).digest('hex') };
}

export function retryAllowed(retryIndex: number, maxAutoRetry: number, delivery: string): boolean {
  integer(retryIndex, 'retry index', 0, 2147483646);
  integer(maxAutoRetry, 'maximum retries', 0, 2147483646);
  return delivery === 'KNOWN_FAILURE' && retryIndex < maxAutoRetry;
}
