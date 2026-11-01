import { test, expect } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalIdentity, freezePayload, retryAllowed, TransmissionIdentity } from '../lib/insw-queue/contracts';
import { readPolicy, validatePolicy } from '../lib/insw-queue/policy.repository';

const base = { companyCode: 1370, revision: 'revision-1', businessDate: '2026-10-22' };
test('all source identity shapes, revisions, dates and company scoping are explicit', () => {
  const identities: TransmissionIdentity[] = [
    { ...base, kind: 'SOURCE_HEADER', operation: 'INCOMING', sourceId: 1 },
    { ...base, kind: 'SOURCE_HEADER', operation: 'STOCK_OPNAME', sourceId: BigInt('9007199254740993') },
    { ...base, kind: 'WMS_REFERENCE', operation: 'CAPITAL_OUTGOING', reference: 'WMS-1' },
    { ...base, kind: 'SCRAP', operation: 'SCRAP_INCOMING', sourceId: 1, actionKey: 'explicit-send-v1' },
    { ...base, kind: 'SCRAP', operation: 'SCRAP_OUTGOING', sourceId: 1, actionKey: 'explicit-send-v1' },
    { ...base, kind: 'COMPANY_BALANCE', operation: 'SALDO_AWAL', balanceSet: 'set-1' },
    { ...base, kind: 'COMPANY_BALANCE', operation: 'FINAL_REGISTRATION', balanceSet: 'set-1' },
  ];
  expect(new Set(identities.map(i => canonicalIdentity(i).key)).size).toBe(identities.length);
  const header = identities[0];
  expect(canonicalIdentity({ ...header, companyCode: 2 }).key).not.toBe(canonicalIdentity(header).key);
  expect(canonicalIdentity({ ...header, revision: 'revision-2' }).key).not.toBe(canonicalIdentity(header).key);
  expect(canonicalIdentity({ ...header, businessDate: '2026-10-21' }).key).not.toBe(canonicalIdentity(header).key);
  expect(canonicalIdentity(identities[1]).key).toContain('9007199254740993');
  expect(canonicalIdentity({ ...base, kind: 'SOURCE_HEADER', operation: 'INCOMING', sourceId: BigInt(1) }).key).toBe(canonicalIdentity(header).key);
});

test('ambiguous identities, invalid operations, unsafe numeric IDs and dates are rejected', () => {
  const valid = { ...base, kind: 'SOURCE_HEADER', operation: 'INCOMING', sourceId: 1 };
  for (const invalid of [
    { ...valid, revision: '' }, { ...valid, businessDate: '2026-02-30' },
    { ...valid, sourceId: Number.MAX_SAFE_INTEGER + 1 }, { ...valid, sourceId: '01' },
    { ...valid, sourceId: '-1' }, { ...valid, operation: 'WIP' }, { ...valid, companyCode: 0 },
    { ...base, kind: 'COMPANY_BALANCE', operation: 'SALDO_AWAL' },
    { ...base, kind: 'WMS_REFERENCE', operation: 'STOCK_OPNAME', reference: 'x' },
  ]) expect(() => canonicalIdentity(invalid as TransmissionIdentity)).toThrow();
});

test('payload canonicalization freezes content, rejects non-JSON and verifies integrity', () => {
  const input = { b: [1, { x: true }], a: 'business-data' };
  const frozen = freezePayload(input);
  expect(frozen.sha256).toBe(freezePayload({ a: 'business-data', b: input.b }).sha256);
  input.b[0] = 2;
  expect(freezePayload(input).sha256).not.toBe(frozen.sha256);
  expect(frozen.sha256).toMatch(/^[a-f0-9]{64}$/);
  for (const value of [null, [], { x: undefined }, { x: BigInt(1) }, { x: NaN }, { x: new Date() }]) expect(() => freezePayload(value)).toThrow();
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  expect(() => freezePayload(cyclic)).toThrow();
});

test('policy validation and retry-after-initial budget fail closed', async () => {
  expect(validatePolicy({ min_processing_interval_ms: 3600, max_auto_retry: 0 })).toBeTruthy();
  for (const bad of [-1, 0, 0.5, NaN, Infinity, '3600', 2147483648]) expect(() => validatePolicy({ min_processing_interval_ms: bad as number, max_auto_retry: 0 })).toThrow();
  for (const bad of [-1, 0.5, NaN, '0', 2147483647]) expect(() => validatePolicy({ min_processing_interval_ms: 1, max_auto_retry: bad as number })).toThrow();
  expect(retryAllowed(0, 0, 'KNOWN_FAILURE')).toBe(false);
  expect(retryAllowed(2, 3, 'KNOWN_FAILURE')).toBe(true);
  expect(retryAllowed(3, 3, 'KNOWN_FAILURE')).toBe(false);
  for (const state of ['NOT_STARTED', 'POSSIBLY_STARTED', 'KNOWN_SUCCESS']) expect(retryAllowed(0, 3, state)).toBe(false);
  const db = (row: unknown) => ({ insw_transmission_policy: { findUnique: async () => row } }) as unknown as Parameters<typeof readPolicy>[0];
  await expect(readPolicy(db(null))).rejects.toThrow('missing');
  await expect(readPolicy(db({ min_processing_interval_ms: 0, max_auto_retry: 0, version: 1 }))).rejects.toThrow();
});

// Phase B originally prohibited every foundation reference while it was dormant.
// The committed rollout now exposes these specific read/admission facades. Keep
// exceptions statement- and caller-specific: no runtime/repository wildcard.
const approvedQueueStatements: Record<string, string[]> = {
  'app/(authenticated)/insw/logs/page.tsx': [
    "import { deliveryLabel, type OperationalState } from '@/lib/insw-queue/operational-state';",
  ],
  'app/api/insw/logs/route.ts': ["import { operationalLogPage } from '@/lib/insw-queue/operational-logs';"],
  'app/api/insw/logs/[id]/route.ts': [
    "import { currentQueueStates } from '@/lib/insw-queue/operational-logs';",
    "const queue = await prisma.insw_queue_cycle.findFirst({ where: { id: queueId, company_code: companyValidation.companyCode },\n        select: { id: true, operation: true, wms_reference: true, company_code: true, queued_at: true } });",
  ],
  'app/api/insw/logs/[id]/resend/route.ts': ["import { WmsAdmissionError, resendWmsLog, wmsLogTypes } from '@/lib/insw-queue/wms-coordination';"],
  'app/api/insw/post/pemasukan/route.ts': ["import { IncomingAdmissionError, submitIncomingOriginals } from '@/lib/insw-queue/incoming-coordination';"],
  'app/api/insw/post/pengeluaran/route.ts': ["import { WmsAdmissionError, submitOutgoingOriginals } from '@/lib/insw-queue/wms-coordination';"],
  'lib/insw-log-actions.ts': ["import { wmsLogResendEligibility, wmsLogTypes } from './insw-queue/wms-coordination';"],
};
function forbiddenQueueAccess(path: string, source: string) {
  for (const statement of approvedQueueStatements[path] ?? []) source = source.replace(statement, '');
  return /insw-queue|insw_queue_cycle|insw_transmission_policy/.test(source);
}

test('foundation is not imported by live code or runtime entry points beyond approved facades', () => {
  function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]);
  }
  // The isolated worker has its own live-entrypoint boundary guard.
  const paths = [...walk('app'), ...walk('lib').filter(p => !p.startsWith('lib/insw-queue/') && !p.startsWith('lib/insw-worker/')), 'ecosystem.config.js'];
  for (const path of paths.filter(p => /\.(tsx?|js)$/.test(p))) expect(forbiddenQueueAccess(path, readFileSync(path, 'utf8')), path).toBe(false);
  for (const path of walk('lib/insw-queue')) expect(readFileSync(path, 'utf8'), path).not.toMatch(/\bfetch\s*\(|setInterval\s*\(|setTimeout\s*\(|INSWIntegrationService/);
  // The sole client-facing exception must remain dependency-free presentation.
  expect(readFileSync('lib/insw-queue/operational-state.ts', 'utf8')).not.toMatch(/\bimport\b|\brequire\s*\(|\bfetch\s*\(|\bprisma\b/);
});

test('queue boundary rejects unsafe imports and DB access even in approved callers', () => {
  for (const path of [...Object.keys(approvedQueueStatements), 'app/unapproved.ts', 'ecosystem.config.js']) {
    const approved = (approvedQueueStatements[path] ?? []).join('\n');
    expect(forbiddenQueueAccess(path, approved)).toBe(false);
    for (const unsafe of [
      "import { claimNext } from '@/lib/insw-queue/claim.repository';",
      "import { dispatch } from '@/lib/insw-queue/dispatcher';",
      "import { send } from '@/lib/insw-queue/transport';",
      "export * from '@/lib/insw-queue/policy.repository';",
      "const runtime = require('@/lib/insw-queue');",
      "await import('@/lib/insw-queue/wms-coordination');",
      "await prisma.insw_queue_cycle.updateMany({});",
      "await prisma.insw_transmission_policy.findMany();",
    ]) expect(forbiddenQueueAccess(path, approved + '\n' + unsafe), `${path}: ${unsafe}`).toBe(true);
  }
  const uiImport = approvedQueueStatements['app/(authenticated)/insw/logs/page.tsx'][0];
  expect(forbiddenQueueAccess('app/unapproved.ts', uiImport)).toBe(true);
  expect(forbiddenQueueAccess('app/(authenticated)/insw/logs/page.tsx', uiImport + '\n' + uiImport)).toBe(true);
});
