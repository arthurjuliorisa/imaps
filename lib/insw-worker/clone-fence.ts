import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { Prisma } from '@prisma/client';
import { ProcessIdentity } from './process-identity';

export const CLONE_ACK = 'target-nonproduction-all-producers-stopped-no-inflight-transmission-access-controlled';
// One operator record: coordinates, observed catalog identity, restore provenance
// and shutdown evidence. Never interpreted as proof of remote process death.
export type CloneManifest = {
  phase: 'development' | 'staging'; host: string; port: number; database: string; role: string;
  databaseOid: string; schemaOid: string; serverAddress: string;
  expectedToken: string; expectedIdentity: ProcessIdentity; operator: string;
  provenance: string; endpointEvidence: string; shutdownEvidence: string; acknowledgement: string;
};
export type CloneTarget = { database: string; role: string; session_role: string; database_oid: string;
  schema_name: string; schema_oid: string; port: number; server_address: string | null;
  backend_pid: number; other_sessions: number; prepared_transactions: number;
  recovery: boolean; unsafe_configuration: boolean };
export function digest(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function deny(condition: boolean, code: string): asserts condition { if (!condition) throw new Error(code); }
export function readCloneManifest(path: string): CloneManifest {
  const content = readFileSync(path);
  deny(content.length > 0 && content.length <= 16384, 'CLONE_MANIFEST_SIZE_INVALID');
  try { return JSON.parse(content.toString('utf8')) as CloneManifest; }
  catch { throw new Error('CLONE_MANIFEST_JSON_REQUIRED'); }
}
export function validIdentity(value: unknown): value is ProcessIdentity {
  if (!value || typeof value !== 'object') return false;
  const v = value as ProcessIdentity;
  return ['host', 'machine', 'boot', 'start', 'pidNamespace'].every(k => typeof v[k as keyof ProcessIdentity] === 'string'
    && String(v[k as keyof ProcessIdentity]).trim().length > 0)
    && v.host.length <= 253 && !/[\x00-\x20\x7f]/.test(v.host)
    && /^[a-f0-9]{32}$/i.test(v.machine) && /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v.boot)
    && /^\d+$/.test(v.start) && /^pid:\[\d+\]$/.test(v.pidNamespace)
    && Number.isSafeInteger(v.pid) && v.pid > 0 && Number.isSafeInteger(v.uid) && v.uid >= 0;
}
export function sameIdentity(a: ProcessIdentity, b: ProcessIdentity): boolean {
  return validIdentity(a) && validIdentity(b) && (['host', 'machine', 'boot', 'pid', 'start', 'pidNamespace', 'uid'] as const).every(k => a[k] === b[k]);
}
// Dedicated server-only opt-in and URL; no application DATABASE_URL fallback.
// Public phase/test-mode flags can veto but never grant permission. NODE_ENV is
// a Next.js build mode, not a deployment classification.
export function cloneDatabaseUrl(env: Readonly<Record<string, string | undefined>>, m: CloneManifest): string {
  deny(env.INSW_POST_RESTORE_ENABLED === 'controlled-nonproduction' && env.INSW_RECOVER_PRODUCTION !== 'true', 'CLONE_OPT_IN_REQUIRED');
  deny(['development', 'staging'].includes(m.phase) && env.DATABASE_PHASE === m.phase
    && (!env.NEXT_PUBLIC_ENVIRONMENT_PHASE || env.NEXT_PUBLIC_ENVIRONMENT_PHASE === m.phase), 'CLONE_UNSAFE_DEPLOYMENT_PHASE');
  deny(typeof m.host === 'string' && /^[a-zA-Z0-9.-]+$/.test(m.host)
    && /^[a-zA-Z0-9_]+$/.test(m.database) && /^[a-zA-Z0-9_]+$/.test(m.role)
    && Number.isInteger(m.port) && m.port > 0 && m.port <= 65535
    && /^[1-9]\d*$/.test(m.databaseOid) && /^[1-9]\d*$/.test(m.schemaOid)
    && typeof m.serverAddress === 'string' && isIP(m.serverAddress) !== 0, 'CLONE_TARGET_INPUTS_REQUIRED');
  deny(!/(^|[_.-])(prod|production)([_.-]|$)/i.test(`${m.host}_${m.database}_${m.role}`), 'CLONE_UNSAFE_PRODUCTION_TARGET');
  deny(/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(m.expectedToken) && validIdentity(m.expectedIdentity), 'CLONE_EXPECTED_OWNER_REQUIRED');
  deny(typeof m.operator === 'string' && m.operator.trim().length > 0 && m.operator.length <= 100
    && m.acknowledgement === CLONE_ACK, 'CLONE_ACKNOWLEDGEMENT_REQUIRED');
  deny([m.provenance, m.endpointEvidence, m.shutdownEvidence].every(v => typeof v === 'string'
    && v.trim().length >= 40 && v.length <= 2000 && !/^REPLACE\b/i.test(v.trim())), 'CLONE_OPERATOR_EVIDENCE_REQUIRED');
  let url: URL;
  try { url = new URL(env.INSW_POST_RESTORE_DATABASE_URL ?? ''); }
  catch { throw new Error('CLONE_DATABASE_URL_REQUIRED'); }
  deny(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === m.host
    && (url.port || '5432') === String(m.port) && decodeURIComponent(url.pathname) === `/${m.database}`
    && decodeURIComponent(url.username) === m.role && !url.hash
    && url.searchParams.get('connection_limit') === '1'
    && [...url.searchParams.keys()].every(k => ['connection_limit', 'schema', 'sslmode'].includes(k))
    && (!url.searchParams.has('schema') || url.searchParams.get('schema') === 'public')
    && (!url.searchParams.has('sslmode') || ['require', 'verify-full'].includes(url.searchParams.get('sslmode')!))
    && [...url.searchParams.keys()].length === new Set(url.searchParams.keys()).size, 'CLONE_UNSAFE_ENDPOINT_MISMATCH');
  return url.toString();
}
export function assertCloneTarget(m: CloneManifest, t: CloneTarget) {
  deny(t.database === m.database && t.role === m.role && t.session_role === m.role
    && t.database_oid === m.databaseOid && t.schema_name === 'public' && t.schema_oid === m.schemaOid
    && t.port === m.port && t.server_address === m.serverAddress
    && t.recovery === false && t.unsafe_configuration === false, 'CLONE_UNSAFE_TARGET_MISMATCH');
  deny(t.other_sessions === 0 && t.prepared_transactions === 0, 'CLONE_OTHER_CONNECTIONS_OR_PREPARED_TRANSACTIONS');
}
// Catalog/session checks work with a normal application role. Restrict session
// counts to the selected DB (including hidden/idle sessions and background
// workers); unrelated databases on a shared server are outside this boundary.
// No physical locality claim is made from loopback: endpointEvidence must record
// verified endpoint mapping and access control, including any proxy/tunnel.
export async function inspectCloneTarget(tx: Prisma.TransactionClient): Promise<CloneTarget> {
  const rows = await tx.$queryRaw<CloneTarget[]>`SELECT current_database() AS database, current_user AS role,
    session_user AS session_role, (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
    current_schema() AS schema_name, (SELECT oid::text FROM pg_namespace WHERE nspname = current_schema()) AS schema_oid,
    current_setting('port')::integer AS port, inet_server_addr()::text AS server_address,
    pg_backend_pid() AS backend_pid,
    (SELECT count(*)::integer FROM pg_stat_activity WHERE pid <> pg_backend_pid()
      AND datname = current_database()) AS other_sessions,
    (SELECT count(*)::integer FROM pg_prepared_xacts WHERE database = current_database()) AS prepared_transactions,
    pg_is_in_recovery() AS recovery,
    EXISTS (SELECT 1 FROM pg_subscription WHERE subdbid = (SELECT oid FROM pg_database WHERE datname = current_database())
      AND subenabled) AS unsafe_configuration`;
  deny(rows.length === 1, 'CLONE_AMBIGUOUS_TARGET');
  return rows[0];
}
export async function verifyCloneFence(tx: Prisma.TransactionClient, m: CloneManifest) {
  const t = await inspectCloneTarget(tx);
  assertCloneTarget(m, t);
  const [state] = await tx.$queryRaw<{ busy: boolean }[]>`SELECT
    EXISTS (SELECT 1 FROM insw_queue_cycle WHERE status IN ('CLAIMED', 'REMOTE_SUCCEEDED') OR owner_token IS NOT NULL OR lease_until IS NOT NULL
      OR delivery_state = 'POSSIBLY_STARTED' OR hold_reason = 'DELIVERY_UNKNOWN')
    OR EXISTS (SELECT 1 FROM insw_queue_attempt WHERE completed_at IS NULL OR delivery_state = 'POSSIBLY_STARTED')
    OR EXISTS (SELECT 1 FROM insw_preparation_ledger WHERE state = 'CLAIMED' OR owner_token IS NOT NULL OR lease_until IS NOT NULL) AS busy`;
  deny(state?.busy === false, 'CLONE_ACTIVE_OR_UNKNOWN_CLAIMS_REQUIRE_MANUAL_REVIEW');
  return t;
}
