import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { INSW_ENDPOINTS } from '../../lib/types/insw-api.types';

export const domains = {
  incoming: { route: 'incoming-goods', table: 'incoming_goods', operation: 'INCOMING' },
  outgoing: { route: 'outgoing-goods', table: 'outgoing_goods', operation: 'OUTGOING' },
  material: { route: 'material-usage', table: 'material_usages', operation: 'MATERIAL_USAGE' },
  production: { route: 'production-output', table: 'production_outputs', operation: 'PRODUCTION_OUTPUT' },
  adjustment: { route: 'adjustments', table: 'adjustments', operation: 'ADJUSTMENT' },
} as const;
export type Family = keyof typeof domains;
export type Source = Record<string, unknown>;
export type Entry = { index: number; id: string; family: Family | null; state: 'ELIGIBLE' | 'INVALID' | 'UNSUPPORTED' | 'PRE_EXISTING'; issues: string[]; items: number; checks?: { reversal: string | null; workOrderHash: string | null; itemsHash: string; sourceItemCount?: number } };
export type Assertion = { scenario: string; status: 'PASS' | 'FAIL' | 'BLOCKED' | 'NOT RUN' | 'NOT VERIFIED'; reason: string };
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function requireSafe(condition: unknown, code: string): asserts condition { if (!condition) throw new Error(code); }
export function options(args: string[]) {
  const { values: v } = parseArgs({ args, strict: true, options: {
    help: { type: 'boolean' }, 'payload-file': { type: 'string', default: process.env.INSW_SANDBOX_PAYLOAD_FILE || join(homedir(), '.local/share/imaps-insw-sandbox/payloads.json') }, 'evidence-root': { type: 'string', default: process.env.INSW_SANDBOX_EVIDENCE_ROOT || join(homedir(), '.local/share/imaps-insw-sandbox/evidence') },
    db: { type: 'string', default: 'imaps_db_vps' }, company: { type: 'string', default: '1370' },
    profile: { type: 'string', default: 'smoke' }, 'max-transmissions': { type: 'string' },
    'max-sandbox-posts': { type: 'string' }, 'timeout-minutes': { type: 'string', default: '15' },
    'max-retries': { type: 'string' }, resume: { type: 'string' },
    'preflight-only': { type: 'boolean' }, 'allow-real-sandbox': { type: 'boolean' },
    'verify-local-state': { type: 'boolean' }, 'stop-on-unsafe': { type: 'boolean', default: true },
    'app-url': { type: 'string', default: process.env.INSW_SANDBOX_APP_URL || 'http://127.0.0.1:3000' }, 'app-pid': { type: 'string', default: process.env.INSW_SANDBOX_APP_PID },
  } });
  const number = (value: string | undefined, fallback: number, max: number) => {
    requireSafe(value === undefined || /^[1-9]\d*$/.test(value), 'POSITIVE_INTEGER_REQUIRED');
    const n = Number(value ?? fallback); requireSafe(Number.isSafeInteger(n) && n <= max, 'LIMIT_OUT_OF_RANGE'); return n;
  };
  requireSafe(['smoke', 'core', 'full'].includes(v.profile!), 'UNKNOWN_PROFILE');
  requireSafe(v.company === '1370' && v.db === 'imaps_db_vps', 'EXACT_COMPANY_AND_DATABASE_REQUIRED');
  requireSafe(v['max-retries'] === undefined || /^(0|[1-9]|10)$/.test(v['max-retries']), 'RETRY_LIMIT_INVALID');
  requireSafe(!v.resume || v['allow-real-sandbox'], 'RESUME_REQUIRES_REAL_OPT_IN');
  const max = number(v['max-transmissions'], v.profile === 'smoke' ? 3 : v.profile === 'core' ? 10 : 363, 1000);
  requireSafe([v['preflight-only'], v['verify-local-state'], v['allow-real-sandbox']].filter(Boolean).length <= 1, 'CONFLICTING_MODE');
  requireSafe(!v.resume || /^[a-zA-Z0-9_-]{1,80}$/.test(v.resume), 'INVALID_RUN_ID');
  return { ...v, max, posts: number(v['max-sandbox-posts'], max, 1000), retries: Number(v['max-retries'] ?? 0), explicitPosts: v['max-sandbox-posts'] !== undefined, explicitRetries: v['max-retries'] !== undefined,
    timeoutMs: number(v['timeout-minutes'], 15, 1440) * 60000, real: v['allow-real-sandbox'] === true };
}
export type Options = ReturnType<typeof options>;
// Allowances only: never update the policy or manufacture eligibility.
export function policyBudgets(opts: Options, count: number, policy?: { max_auto_retry: number; min_processing_interval_ms: number } | null) {
  const blockers: string[] = [];
  const valid = !!policy && Number.isInteger(policy.max_auto_retry) && policy.max_auto_retry >= 0
    && policy.max_auto_retry <= 10 && policy.min_processing_interval_ms >= 3600;
  if (!valid) blockers.push('POLICY_UNSAFE_OR_UNSUPPORTED');
  const requiredRetries = valid ? policy.max_auto_retry : 0;
  const retries = opts.explicitRetries ? opts.retries : requiredRetries;
  const requiredPosts = count * (1 + requiredRetries);
  const suggestedPosts = count * (1 + retries);
  const posts = opts.explicitPosts ? opts.posts : Math.min(1000, suggestedPosts);
  if (valid && (retries < requiredRetries || posts < requiredPosts)) blockers.push('POLICY_EXCEEDS_RUN_BUDGET');
  if (!opts.explicitPosts && suggestedPosts > 1000) blockers.push('POST_BUDGET_CEILING_EXCEEDED');
  return { retries, posts, requiredRetries, requiredPosts, ceiling: 1000, blockers,
    action: !valid ? 'Review the missing/unsupported policy through existing controls: interval >=3600ms, max_auto_retry 0..10. Runner never changes policy.' : requiredPosts > 1000 ? `Reduce --max-transmissions to at most ${Math.floor(1000 / (1 + requiredRetries))}.`
      : `Supply --max-retries ${requiredRetries} --max-sandbox-posts ${requiredPosts} (or omit both overrides).`,
    source: 'Existing DB policy; retry eligibility remains Option B; no policy mutation.' };
}
export function classify(p: Source): Family | null {
  const items = Array.isArray(p.items) ? p.items : [];
  const has = (key: string) => items.some(i => i && typeof i === 'object' && key in i);
  const candidates: Family[] = [];
  if ('incoming_date' in p) candidates.push('incoming');
  if ('outgoing_date' in p) candidates.push('outgoing');
  if ('transaction_date' in p && 'work_order_number' in p && has('traceability_data')) candidates.push('material');
  if ('transaction_date' in p && has('planned_production_qty')) candidates.push('production');
  if (typeof p.wms_doc_type === 'string' && ['daily_adjustment', 'sto_adjustment', 'revise_adjustment'].includes(p.wms_doc_type)) candidates.push('adjustment');
  return candidates.length === 1 ? candidates[0] : null;
}
export function itemHash(items: Source[]) {
  const tuples = items.map(i => [i.item_code, i.uom, Number(i.qty), i.work_order_number ?? null,
    i.planned_production_qty === undefined || i.planned_production_qty === null ? null : Number(i.planned_production_qty)]);
  return hash(JSON.stringify(tuples.map(t => JSON.stringify(t)).sort()));
}
export async function inventory(input: unknown): Promise<Entry[]> {
  requireSafe(Array.isArray(input) && input.length > 0 && input.length <= 10000, 'JSON_ARRAY_REQUIRED_MAX_10000');
  // Actual schemas only; safeParse never calls their separate DB validators.
  const [i, o, m, p, a] = await Promise.all([
    import('../../lib/validators/schemas/incoming-goods.schema'), import('../../lib/validators/schemas/outgoing-goods.schema'),
    import('../../lib/validators/schemas/material-usage.schema'), import('../../lib/validators/schemas/production-output.schema'),
    import('../../lib/validators/schemas/adjustment.schema'),
  ]);
  const schemas = { incoming: i.incomingGoodRequestSchema, outgoing: o.outgoingGoodRequestSchema,
    material: m.materialUsageBatchRequestSchema, production: p.productionOutputBatchRequestSchema, adjustment: a.adjustmentBatchRequestSchema };
  const counts = new Map<string, number>();
  for (const raw of input) if (raw && typeof raw.wms_id === 'string') counts.set(raw.wms_id, (counts.get(raw.wms_id) ?? 0) + 1);
  return input.map((raw, index) => {
    const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Source : {};
    const family = classify(obj); const id = typeof obj.wms_id === 'string' ? obj.wms_id : '';
    const issues: string[] = [];
    if (!id || id.length > 100 || /[\x00-\x1f\x7f]/.test(id) || id.trim() !== id) issues.push('WMS_ID_INVALID');
    if ((counts.get(id) ?? 0) > 1) issues.push('DUPLICATE_INPUT_ID');
    if (obj.company_code !== 1370 || obj.owner !== 1370) issues.push('WRONG_COMPANY_OR_OWNER');
    let checks: Entry['checks'];
    if (family) {
      const parsed = schemas[family].safeParse(obj);
      if (!parsed.success) issues.push(...parsed.error.issues.map(e => `${e.path.join('.')}:${e.code}`));
      else {
        const data = parsed.data as Source;
        // Material persistence expands each trace entry into its own item row;
        // its schema intentionally strips item-level qty. Mirror that projection.
        const persistedItems = family === 'material'
          ? (data.items as Source[]).flatMap(item => (item.traceability_data as Source[]).map(trace => ({ ...item, qty: trace.qty })))
          : data.items as Source[];
        checks = { reversal: typeof data.reversal === 'string' ? data.reversal : null,
          workOrderHash: typeof data.work_order_number === 'string' ? hash(data.work_order_number) : null,
          itemsHash: itemHash(persistedItems), sourceItemCount: persistedItems.length };
      }
      // Do not dispatch parsed.data: Zod transformations must not rewrite source.
    }
    return { index, id, family, state: issues.length ? 'INVALID' : family ? 'ELIGIBLE' : 'UNSUPPORTED', issues,
      items: Array.isArray(obj.items) ? obj.items.length : 0, checks };
  });
}
export function select(entries: Entry[], max: number, profile: string): Entry[] {
  const eligible = entries.filter(e => e.state === 'ELIGIBLE');
  if (profile === 'full') return eligible.slice(0, max);
  const selected: Entry[] = [];
  // Round robin retains input order within each family and controls coverage.
  const groups = Object.keys(domains).map(f => eligible.filter(e => e.family === f));
  for (let n = 0; selected.length < max; n++) {
    const row = groups.flatMap(g => g[n] ? [g[n]] : []);
    if (!row.length) break;
    selected.push(...row.slice(0, max - selected.length));
  }
  return selected;
}
export function databaseEnvironment(env: NodeJS.ProcessEnv, opts: Options) {
  const blockers: string[] = [];
  const check = (condition: unknown, code: string) => { if (!condition) blockers.push(code); };
  check(['development', 'staging'].includes(env.DATABASE_PHASE ?? ''), 'TRUSTED_DATABASE_PHASE_REQUIRED');
  check(!env.NEXT_PUBLIC_ENVIRONMENT_PHASE || env.NEXT_PUBLIC_ENVIRONMENT_PHASE === env.DATABASE_PHASE, 'PUBLIC_PHASE_MISMATCH');
  let url: URL; let role: string;
  try { url = new URL(env.DATABASE_URL ?? 'invalid:'); role = decodeURIComponent(url.username); }
  catch { return { blockers: [...blockers, 'LOCAL_DATABASE_URL_INVALID'] }; }
  check(['postgres:', 'postgresql:'].includes(url.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    && url.pathname === `/${opts.db}` && !url.hash && role && !/prod/i.test(role), 'LOCAL_DATABASE_IDENTITY_MISMATCH');
  check([...url.searchParams.keys()].every(k => ['schema', 'connection_limit', 'sslmode'].includes(k))
    && (!url.searchParams.has('schema') || url.searchParams.get('schema') === 'public'), 'DATABASE_PARAMETERS_UNVERIFIED');
  return { blockers, target: { database: opts.db, host: url.hostname, port: url.port || '5432', company: 1370, role,
    phase: env.DATABASE_PHASE, destination: INSW_ENDPOINTS.transaksi.temp } };
}
export const credentialKeys = ['API_KEY', 'INSW_1370_API_KEY', 'INSW_1370_UNIQUE_KEY_TEST'] as const;
export function dispatchBlockers(env: NodeJS.ProcessEnv): string[] {
  const blockers = credentialKeys.filter(k => !env[k]?.trim()).map(k => `MISSING_${k}`);
  if (env.INSW_1370_USE_TEST_MODE !== 'true') blockers.push('SANDBOX_TEST_MODE_REQUIRED');
  if (env.INSW_1370_UNIQUE_KEY_TEST && env.INSW_1370_UNIQUE_KEY_TEST === env.INSW_1370_UNIQUE_KEY_REAL) blockers.push('SANDBOX_REAL_KEY_COLLISION');
  // Local process checks cannot prove absence of remote WMS producers or credential provenance.
  if (env.INSW_SANDBOX_OPERATOR_ACK !== 'dedicated-local-no-other-producers-test-credentials-verified') blockers.push('OPERATOR_ISOLATION_AND_CREDENTIAL_ACK_REQUIRED');
  if (['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'].some(k => env[k])) blockers.push('PROXY_ENDPOINT_NOT_VERIFIED');
  return blockers;
}
export function environment(env: NodeJS.ProcessEnv, opts: Options) {
  const config = databaseEnvironment(env, opts);
  const blockers = [...config.blockers, ...dispatchBlockers(env)];
  requireSafe(!blockers.length && config.target, blockers[0] ?? 'UNVERIFIED_ENVIRONMENT');
  return config.target;
}
export type Start = { queue_id: string; attempt_id: string; wms_id: string; monotonic_ns: string; boot_id: string; active: number; wall_time: string };
export function spacing(starts: Start[], complete: boolean) {
  const sorted = [...starts].sort((a,b) => BigInt(a.monotonic_ns) < BigInt(b.monotonic_ns) ? -1 : 1);
  const gaps = sorted.slice(1).map((s,n) => BigInt(s.monotonic_ns) - BigInt(sorted[n].monotonic_ns));
  const violations = gaps.filter(n => n < BigInt(3600000000)).length;
  const maxActive = Math.max(0, ...starts.map(s => s.active));
  const comparable = new Set(starts.map(s => s.boot_id)).size === 1;
  return { status: !complete || starts.length < 2 || !comparable ? 'NOT VERIFIED' : violations || maxActive > 1 ? 'FAIL' : 'PASS',
    count: starts.length, min_ns: gaps.length ? String(gaps.reduce((a,b) => a < b ? a : b)) : null,
    max_ns: gaps.length ? String(gaps.reduce((a,b) => a > b ? a : b)) : null, violations, maxActive,
    complete, gaps_ns: gaps.map(String) } as const;
}
export function csv(rows: Record<string, unknown>[], columns: string[]) {
  const cell = (v: unknown) => { const s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v); return `"${s.replace(/"/g, '""')}"`; };
  return [columns.map(cell).join(','), ...rows.map(r => columns.map(k => cell(r[k])).join(','))].join('\n') + '\n';
}
