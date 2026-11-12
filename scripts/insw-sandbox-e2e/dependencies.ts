import { type Entry, type Options, type Source, hash as hashReference } from './core';

const objects = (v: unknown): Source[] => Array.isArray(v)
  ? v.filter((x): x is Source => !!x && typeof x === 'object' && !Array.isArray(x)) : [];
const key = (...v: unknown[]) => JSON.stringify(v);
const reference = (v: unknown) => typeof v === 'string' && v.trim() && v.trim() !== 'N' ? v.trim() : null;
const proofSources = [
  'lib/validators/schemas/incoming-goods.schema.ts: incoming creates inventory; no upstream stock reference',
  'lib/validators/schemas/material-usage.schema.ts: traceability_data PPKEK/qty; no unique incoming identity',
  'lib/services/outgoing-goods.service.ts: validateWorkOrderAllocations permits missing/unresolved references',
  'lib/services/traceability.service.ts: PPKEK resolution requires DB/year context',
  'prisma/schema.prisma: incoming identity company/id/date; PPKEK is indexed, not unique',
];

/** Decision gate: current contracts do not prove dependent fixture edges.
 * Correlations below are diagnostics ONLY, never stock, allocation or dispatch proof.
 * No edge override/import is accepted. Cyclic/forward references cannot authorize a send.
 */
export function dependencyPlan(input: Source[], entries: Entry[], opts: Options, collisionsChecked = false) {
  type Candidate = { index: number; id: string; state: Entry['state']; uom: unknown; qty: unknown; ppkekHash: string };
  const byItem = new Map<string, Candidate[]>();
  const byUom = new Map<string, Candidate[]>();
  const byPpkek = new Map<string, Candidate[]>();
  const add = (map: Map<string, Candidate[]>, k: string, c: Candidate) => {
    const group = map.get(k); if (group) group.push(c); else map.set(k, [c]);
  };
  for (const e of entries) if (e.family === 'incoming') {
    const p = input[e.index];
    for (const item of objects(p.items)) {
      const c = { index: e.index, id: e.id, state: e.state, uom: item.uom, qty: item.qty,
        ppkekHash: reference(p.ppkek_number) ? hashReference(reference(p.ppkek_number)!) : 'ABSENT_OR_N' };
      add(byItem, key(p.company_code, item.item_code), c);
      add(byUom, key(p.company_code, item.item_code, item.uom), c);
      if (reference(p.ppkek_number)) add(byPpkek, key(p.company_code, item.item_code, item.uom, reference(p.ppkek_number)), c);
    }
  }
  // Offline policy is deliberately NOT queried. Runtime policyBudgets remains mandatory.
  const retries = opts.retries;
  const postCap = opts.explicitPosts ? opts.posts : Math.min(1000, opts.max * (1 + retries));
  const capacity = Math.min(opts.max, Math.floor(postCap / (1 + retries)));
  const selected: Entry[] = [];
  const diagnostics = entries.map(e => {
    const p = input[e.index];
    const base = { index: e.index, id: e.id, domain: e.family };
    if (e.state !== 'ELIGIBLE') return { ...base, status: e.state === 'PRE_EXISTING' ? 'BLOCKED' : 'SKIPPED',
      reason: e.state === 'PRE_EXISTING' ? 'PRE_EXISTING_PROVIDER_ACCEPTANCE_UNVERIFIED_NO_REPLAY' : e.state, issues: e.issues };
    if (e.family === 'incoming') {
      if (selected.length >= capacity) return { ...base, status: 'SKIPPED', reason: 'INSUFFICIENT_WMS_OR_POST_RETRY_BUDGET' };
      selected.push(e);
      return { ...base, status: 'SELECTED', reason: 'INCOMING_HAS_NO_UPSTREAM_TRANSACTION_PREREQUISITE',
        providerAcceptance: 'UNKNOWN', collisionVerification: collisionsChecked ? 'CHECKED' : 'NOT VERIFIED' };
    }
    const requirements = objects(p.items).map((item, itemIndex) => {
      const sameItem = byItem.get(key(p.company_code, item.item_code)) ?? [];
      const sameUom = byUom.get(key(p.company_code, item.item_code, item.uom)) ?? [];
      const refs = objects(e.family === 'material' ? item.traceability_data : item.work_order_allocations);
      return { itemIndex, item: item.item_code, uom: item.uom, qty: item.qty ?? null,
        itemCandidates: sameItem, uomCandidates: sameUom,
        references: refs.map(r => {
          const pp = reference(r.ppkek_number);
          const candidates = pp ? byPpkek.get(key(p.company_code, item.item_code, item.uom, pp)) ?? [] : [];
          return { ppkekHash: pp ? hashReference(pp) : null, workOrderHash: reference(r.work_order_number) ? hashReference(reference(r.work_order_number)!) : null,
            qty: r.qty, candidates,
            quantityCompatibleCandidates: candidates.filter(c => typeof c.qty === 'number' && typeof r.qty === 'number' && c.qty >= r.qty),
            reason: !pp ? 'MISSING_AUTHORITATIVE_INCOMING_REFERENCE' : candidates.length > 1 ? 'AMBIGUOUS_PPKEK_CANDIDATES'
              : !candidates.length ? 'MISSING_COMPANY_ITEM_UOM_PPKEK_CANDIDATE' : 'CORRELATION_ONLY_UNIQUE_SOURCE_AND_AVAILABLE_STOCK_UNPROVEN' };
        }),
        reason: sameItem.length > 1 ? 'MULTIPLE_ITEM_CANDIDATES_NOT_DEPENDENCY_PROOF' : 'ITEM_DATE_QUANTITY_MATCH_IS_NOT_DEPENDENCY_PROOF' };
    });
    return { ...base, status: 'UNRESOLVED', reason: e.family === 'production' ? 'WO_MATERIAL_ALLOCATION_AND_PROVIDER_STOCK_UNPROVEN'
      : e.family === 'adjustment' ? 'ADJUSTMENT_OR_REVERSAL_BASELINE_UNPROVEN' : 'AUTHORITATIVE_UPSTREAM_IDENTITY_AND_PROVIDER_STOCK_UNPROVEN', requirements };
  });
  return { mode: 'business-independent', capability: 'CONSERVATIVE_INDEPENDENT_ONLY',
    graph: { nodes: selected.map(e => ({ index: e.index, id: e.id, domain: e.family })), edges: [],
      ordering: 'Original input index; all selected nodes have zero upstream transaction prerequisites',
      dependentScheduling: 'BLOCKED: no authoritative fixture edges; cycle/forward references cannot authorize dispatch' },
    selected, diagnostics, proofSources, collisions: collisionsChecked ? 'CHECKED' : 'NOT VERIFIED: source-only plan',
    budgets: { wmsCap: opts.max, postCap: opts.explicitPosts ? postCap : selected.length * (1 + retries), retryCap: retries, capacity, plannedWms: selected.length,
      plannedWorstCasePosts: selected.length * (1 + retries), policy: 'NOT VERIFIED offline; runtime policyBudgets must pass; no silent expansion' },
    businessAcceptance: 'NOT RUN; schema eligibility and independent selection do not prove provider acceptance',
    missingEvidence: ['Unique authoritative source identity including company/item/UOM and applicable customs/lot/WO allocation',
      'Quantity allocation/consumption and original/reversal baseline', 'Observed upstream provider acceptance and available inventory before dependent dispatch'],
  };
}
