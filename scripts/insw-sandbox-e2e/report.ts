import { providerOutcome } from './provider-outcome';
import { type Entry, type Assertion, type Start, domains, spacing, csv } from './core';
import type { Observation } from './database';
import type { Evidence } from './evidence';
export function reports(e: Evidence, entries: Entry[], records: Record<string, { state: string; http?: number }>,
  observation: Observation | undefined, starts: Start[], complete: boolean, physical: boolean,
  preserved?: boolean, duplicate?: boolean, blocker?: string, selectionMode = 'transport') {
  const o = observation;
  const rows = entries.map(entry => {
    const q = o?.queue.filter(q => q.wms_reference === entry.id) ?? [];
    const a = o?.attempts.filter(a => q.some(q => q.id === a.queue_id)) ?? [];
    const l = o?.logs.filter(l => l.wms_id === entry.id) ?? [];
    const src = o?.sources.filter(s => s.wms_id === entry.id && s.table === domains[entry.family!]?.table) ?? [];
    const wms = o?.wmsLogs.filter(l => l.wms_id === entry.id) ?? [];
    const status = records[entry.id]?.state;
    const state = status === 'WMS_REJECTED' ? status : !src.length ? status === 'ACCEPTED' ? 'WMS_PERSISTENCE_MISSING' : 'NOT_OBSERVED'
      : !q.length ? 'NOT_ENQUEUED' : q.some(q => q.status === 'HELD') ? 'ON_HOLD'
      : q.every(q => q.status === 'SUCCEEDED') ? 'SUCCEEDED'
      : l.some(l => l.classification === 'PERMANENT_FAILURE') ? 'PROVIDER_REJECTED'
      : q.some(q => q.status === 'FAILED' && q.delivery_state === 'KNOWN_FAILURE') ? 'FAILED_RETRYABLE'
      : a.some(a => a.started_at) ? 'POST_STARTED' : 'QUEUED';
    // Provider business outcome is independent of local HELD/FAILED lifecycle.
    const providerResult = l.length && l.every(log => log.classification === 'KNOWN_REMOTE_SUCCESS' && log.provider_status === true
      && log.http_code !== null && log.http_code >= 200 && log.http_code < 300) ? 'ACCEPTED'
      : l.length && l.every(log => log.classification === 'PERMANENT_FAILURE' && log.reason_code === 'MISSING_ITEM_VALIDATION'
        && log.http_code === 400 && log.provider_status === false) ? 'REJECTED'
      : status === 'WMS_REJECTED' && !a.length && !l.length ? 'NOT_SENT' : 'UNKNOWN';
    const dispatch = l.some(l => l.queue_attempt_id && l.http_code !== null && a.some(a =>
      a.id === l.queue_attempt_id && a.started_at && starts.some(s => s.attempt_id === a.id && s.queue_id === a.queue_id)))
      ? 'RESPONSE_OBSERVED' : a.some(a => a.started_at) ? 'POST_STARTED' : q.length ? 'QUEUED' : 'NOT_OBSERVED';
    const sourceContract = src.length === 1 && !!entry.checks && src[0].reversal === entry.checks.reversal
      && src[0].work_order_hash === entry.checks.workOrderHash && src[0].item_hash === entry.checks.itemsHash;
    return { source_contract_matches: sourceContract, wms_id: entry.id, family: entry.family, state, wms_submission: status ?? 'UNKNOWN', dispatch_observation: dispatch, provider_business_result: providerResult, provider_acceptance: providerOutcome(l), wms_http: records[entry.id]?.http,
      source_ids: src.map(s => s.id).join(';'), source_item_count: src.reduce((n,s) => n+s.item_count,0), expected_item_count: entry.checks?.sourceItemCount ?? entry.items,
      wms_log_ids: wms.map(l => l.id).join(';'), queue_ids: q.map(q => q.id).join(';'), attempt_ids: a.map(a => a.id).join(';'),
      tracking_log_ids: l.map(l => l.id).join(';'), local_status: q.map(q => q.status).join(';'), local_delivery_state: q.map(q => q.delivery_state).join(';'),
      provider_http: l.map(l => l.http_code).join(';'), provider_status: l.map(l => l.provider_status).join(';'),
      retry_index: q.map(q => q.retry_index).join(';'), frozen_hash: q.map(q => q.payload_sha256).join(';') };
  });
  const timing = spacing(starts, complete && !!o && o.attempts.filter(a => a.started_at).length === starts.length
    && starts.every(s => o.attempts.some(a => a.id === s.attempt_id && a.queue_id === s.queue_id && a.started_at)));
  const assertions: Assertion[] = Array.from({ length: 10 }, (_,n) => ({ scenario: `R${String(n+1).padStart(2,'0')}`,
    status: physical && blocker ? 'BLOCKED' : 'NOT RUN', reason: blocker ?? 'Real local database/provider execution not performed.' }));
  const set = (n: number, status: Assertion['status'], reason: string) => { assertions[n-1] = { scenario: `R${String(n).padStart(2,'0')}`, status, reason }; };
  set(2, 'NOT VERIFIED', 'No complete live sender invocation telemetry.');
  let r06Checks: Record<string, Assertion['status']> | undefined;
  if (physical && o) {
    const linked = entries.every(entry => {
      const qs = o.queue.filter(q => q.wms_reference === entry.id);
      const sources = o.sources.filter(s => s.wms_id === entry.id && s.table === domains[entry.family!]?.table);
      return qs.length === 1 && sources.length === 1 && o.wmsLogs.some(l => l.wms_id === entry.id && l.transmission_status === 'SUCCESS')
        && o.logs.some(l => l.wms_id === entry.id && l.transaction_id === sources[0].id && l.transaction_type === qs[0].operation.toLowerCase()
          && l.queue_attempt_id && o.attempts.some(a => a.id === l.queue_attempt_id && a.queue_id === qs[0].id)
          && starts.some(s => s.attempt_id === l.queue_attempt_id));
    });
    set(1, linked && rows.some(r => r.state === 'SUCCEEDED') ? 'PASS' : 'FAIL',
      'Requires complete WMS/source/log/queue/attempt/sender linkage for selected rows and at least one domain success; rejection remains visible per row.');
    set(2, timing.status, JSON.stringify(timing));
    const retries = o.attempts.filter(a => a.retry_index > 0);
    const provenRetries = complete && retries.length > 0 && retries.every(a => {
      const q = o.queue.find(q => q.id === a.queue_id);
      const prior = o.attempts.find(p => p.queue_id === a.queue_id && p.retry_index === a.retry_index - 1);
      return q && a.retry_index <= q.max_auto_retry_snapshot && a.started_at && a.completed_at && prior?.completed_at
        && a.started_at >= prior.completed_at && prior.delivery_state === 'KNOWN_FAILURE'
        && starts.some(s => s.attempt_id === a.id && s.queue_id === a.queue_id)
        && starts.some(s => s.attempt_id === prior.id && s.queue_id === prior.queue_id)
        && o.logs.some(l => l.queue_attempt_id === a.id && l.insw_status === 'SUCCESS' && l.payload_sha256 === q.payload_sha256)
        && o.logs.some(l => l.queue_attempt_id === prior.id && l.http_code === 429 && l.reason_code === 'RATE_LIMIT_REJECTION'
          && l.classification === 'TRANSIENT_FAILURE' && l.payload_sha256 === q.payload_sha256);
    });
    set(3, provenRetries ? 'PASS' : 'NOT RUN',
      'Only complete sender-linked, policy-bounded retry traces following a known-safe rate-limit rejection establish auto retry. No deterministic injection; ambiguous delivery remains held under Option B.');
    const held = o.queue.filter(q => q.status === 'HELD' && q.delivery_state === 'POSSIBLY_STARTED');
    set(4, held.length ? (held.every(q => o.attempts.filter(a => a.queue_id === q.id).length === q.retry_index+1) ? 'PASS' : 'FAIL') : 'NOT RUN',
      'Natural ambiguous outcomes only; no response-loss injection or deliberate remote duplicate.');
    const permanent = o.logs.filter(l => l.classification === 'PERMANENT_FAILURE');
    set(5, permanent.length ? permanent.every(l => {
      const a = o.attempts.find(a => a.id === l.queue_attempt_id);
      return a && !o.attempts.some(b => b.queue_id === a.queue_id && b.retry_index > a.retry_index);
    }) ? 'PASS' : 'FAIL' : 'NOT RUN', 'Natural permanent provider rejection only; no deliberately malformed provider input.');
    const frozen = o.logs.every(l => !l.queue_attempt_id || o.queue.some(q => q.payload_sha256 === l.payload_sha256
      && o.attempts.some(a => a.id === l.queue_attempt_id && a.queue_id === q.id)));
    r06Checks = {
      preservation: preserved === undefined ? 'NOT VERIFIED' : preserved ? 'PASS' : 'FAIL',
      frozen_hashes: !o.logs.length ? 'NOT VERIFIED' : frozen ? 'PASS' : 'FAIL',
      source_contract: !rows.length ? 'NOT VERIFIED' : rows.every(r => r.source_item_count === r.expected_item_count && r.source_contract_matches) ? 'PASS' : 'FAIL',
      duplicate_probe: duplicate === undefined ? 'NOT RUN' : duplicate ? 'PASS' : 'FAIL',
      retry_coverage: retries.length ? 'PASS' : 'NOT RUN',
    };
    set(6, Object.values(r06Checks).includes('FAIL') ? 'FAIL'
      : Object.values(r06Checks).every(s => s === 'PASS') ? 'PASS' : 'NOT VERIFIED',
      `Checks=${JSON.stringify(r06Checks)}; unrelated source headers/items preserved=${preserved}; frozen hashes consistent=${frozen}; duplicate 409/no-extra-queue-attempt=${duplicate === undefined ? 'NOT RUN (no probe result recorded)' : duplicate}; actual retries=${retries.length}. Source contract mismatches=${rows.filter(r => !r.source_contract_matches || r.source_item_count !== r.expected_item_count).map(r => r.wms_id).join(',') || 'none'}. Header reversal/WO and sorted item code/UOM/quantity/WO/planned-quantity digests checked; derived allocation totals remain outside this check.`);
    set(8, entries.length > 0 && rows.every(r => ['SUCCEEDED','ON_HOLD','PROVIDER_REJECTED','FAILED_RETRYABLE','WMS_REJECTED'].includes(r.state)) ? 'PASS' : 'FAIL',
      'Bounded batch polling; unfinished sources/queue/backlog are included in transmissions.csv.');
    set(9, blocker ? 'BLOCKED' : 'PASS', blocker ?? 'Server PID/environment/listener, database, global gate, policy, test keys, Sandbox destination and isolation acknowledgement verified before starting owned worker.');
    set(10, complete ? 'PASS' : 'NOT VERIFIED', complete ? 'Owned child drained and reaped; reports preserved; no queue history deleted.' : 'Sender observation incomplete; sticky ownership requires review.');
  }
  set(7, 'NOT RUN', 'Physical restart/crash/clock jump tests intentionally excluded; no existing PM2 process is touched.');
  e.write('transmissions.csv', csv(rows, ['wms_id','family','state','wms_submission','dispatch_observation','provider_business_result','wms_http','source_ids','source_item_count','expected_item_count','source_contract_matches','wms_log_ids','queue_ids','attempt_ids','tracking_log_ids','local_status','provider_http','provider_status','retry_index','frozen_hash','provider_acceptance','local_delivery_state']));
  const attemptRows = o?.attempts.map(a => { const log = o.logs.find(l => l.queue_attempt_id === a.id);
    return { ...a, tracking_log_id: log?.id, provider_http: log?.http_code, provider_status: log?.provider_status,
      classification: log?.classification, reason_code: log?.reason_code, frozen_hash: log?.payload_sha256 }; }) ?? [];
  e.write('attempts.csv', csv(attemptRows, ['id','queue_id','retry_index','started_at','completed_at','delivery_state','tracking_log_id','provider_http','provider_status','classification','reason_code','frozen_hash']));
  e.write('sender-post-starts.csv', csv(starts, ['wms_id','queue_id','attempt_id','monotonic_ns','boot_id','active','wall_time']));
  e.write('business-acceptance.json', { selectionMode, physical: physical ? 'OPERATOR_OPT_IN' : 'NOT RUN',
    status: selectionMode === 'transport' ? 'NOT RUN' : !physical || !o ? 'NOT RUN'
      : entries.length > 0 && rows.every(r => r.provider_acceptance === 'ACCEPTED') ? 'PASS' : 'UNMET',
    reason: 'Business mode requires observed provider acceptance for every selected fixture. Expected rejection still leaves acceptance unmet; queue states remain unchanged.',
    rows: rows.map(r => ({ wms_id: r.wms_id, providerAcceptance: r.provider_acceptance, localStatus: r.local_status, localDeliveryState: r.local_delivery_state,
      dispatch: r.dispatch_observation, wmsSubmission: r.wms_submission })) });
  e.write('assertions.json', { assertions, r06Checks, timing, realSandboxPostsObserved: starts.length, injection: 'NONE', observationComplete: complete });
  e.write('summary.md', `# INSW Sandbox acceptance\n\nPhysical execution: ${physical ? 'operator opt-in' : 'NOT RUN (no physical Sandbox execution)'}\n\nObserved real Sandbox POST starts: ${starts.length}. Injection: none. Assertion PASS counts are test checks, not provider business acceptances.\n\nProvider business results: ${rows.filter(r => r.provider_business_result === 'ACCEPTED').length} ACCEPTED, ${rows.filter(r => r.provider_business_result === 'REJECTED').length} REJECTED, ${rows.filter(r => r.provider_business_result === 'UNKNOWN').length} UNKNOWN, ${rows.filter(r => r.provider_business_result === 'NOT_SENT').length} NOT_SENT. Local queue states are retained independently in transmissions.csv.\n\n| Scenario | Result | Reason |\n|---|---|---|\n${assertions.map(a => `| ${a.scenario} | ${a.status} | ${a.reason.replace(/\|/g,'/')} |`).join('\n')}\n\nSelected WMS IDs: ${entries.map(e => JSON.stringify(e.id)).join(', ')}\n\nQueue history is retained. No Sandbox Cleanup/DELETE performed.\n`);
  return assertions;
}

export function readinessRows(blockers: string[], context: { state?: unknown; processes?: unknown; app?: unknown; budgets?: unknown; appUrl: string }) {
  const state = context.state as { gate?: unknown; counts?: unknown; policy?: unknown } | undefined;
  const budgets = context.budgets as { action?: string } | undefined;
  let origin = 'http://127.0.0.1:3000';
  try { const url = new URL(context.appUrl); if (url.protocol === 'http:' && url.hostname === '127.0.0.1') origin = url.origin; } catch { /* Never echo arbitrary URLs/credentials. */ }
  const cleanup = `${origin}/settings/database-cleanup (INSW Cleanup, company 1370)`;
  const row = (blocker: string) => {
    let evidence: unknown = 'Independent readiness check failed; see preflight.json.';
    let action = 'Correct the named configuration/check in the dedicated local environment, then rerun read-only preflight.';
    if (blocker === 'OPERATOR_ISOLATION_AND_CREDENTIAL_ACK_REQUIRED') {
      evidence = 'Operator acknowledgement MISSING; local checks cannot prove remote producer isolation or credential provenance.';
      action = 'After verifying all other producers stopped and test credentials approved, set once in local .env: INSW_SANDBOX_OPERATOR_ACK=dedicated-local-no-other-producers-test-credentials-verified';
    } else if (/PROCESS|COMPETING/.test(blocker)) {
      evidence = context.processes;
      action = 'Inspect the listed PID(s): ps -o pid,ppid,lstart,comm -p <PID> and readlink /proc/<PID>/cwd; resolve unknown ownership. Only after verifying no in-flight/busy/unfinished work: pm2 stop imaps-insw-worker; confirm stopped. Never stop a busy sender.';
    } else if (/APP_/.test(blocker)) {
      evidence = context.app;
      const candidates = (context.app as { candidates?: { pid: number; verified: boolean }[] } | undefined)?.candidates ?? [];
      const verified = candidates.filter(c => c.verified);
      const override = verified.length === 1 ? `--app-pid ${verified[0].pid}` : '--app-pid <verified-listener-PID>';
      action = `Use the listed socket owner PID/cwd/port and refusal reason; resolve its config, then use ${override} if discovery remains ambiguous. A supervisor PID is insufficient.`;
    } else if (/POLICY|BUDGET/.test(blocker)) {
      evidence = { policy: state?.policy, budgets: context.budgets };
      action = budgets?.action || 'Review the existing policy: interval must be >=3600ms and retry cap within 0..10. No policy update is performed by this runner.';
    } else if (/GATE|ATTEMPT|QUEUE_OWNER|BACKLOG/.test(blocker)) {
      evidence = { gate: state?.gate, counts: state?.counts };
      action = `Review/drain active work first. For an authorized stale test-state discard only, use ${cleanup}; existing Admin attests stopped producers/no active transmissions and types RESET 1370. This performs real Sandbox DELETE and discards local test history. Busy/unknown ownership may require specialist review; never edit the gate to bypass it.`;
    } else if (blocker.startsWith('MISSING_')) {
      evidence = 'MISSING (credential values are withheld)'; action = `Configure ${blocker.slice(8)} once in the local app/runner environment using approved test credentials.`;
    } else if (/DATABASE|OBSERVED_|PHASE/.test(blocker)) {
      evidence = 'Configured or observed local database identity/phase could not be verified.';
      action = 'Use only loopback imaps_db_vps and development/staging with the matching app phase; resolve the named identity/query failure before dispatch.';
    }
    return { blocker, evidence: typeof evidence === 'string' ? evidence : JSON.stringify(evidence ?? 'No verifiable evidence'), action };
  };
  return [...new Set(blockers)].map(row);
}
export function readinessTable(rows: ReturnType<typeof readinessRows>) {
  const cell = (s: string) => s.replace(/[\r\n\t|\x00-\x1f\x7f]/g, ' ');
  return ['| BLOCKER | EVIDENCE | ONE ACTION TO RESOLVE |', '|---|---|---|',
    ...rows.map(r => `| ${cell(r.blocker)} | ${cell(r.evidence)} | ${cell(r.action)} |`),
    ...(rows.length ? [] : ['| none | All evaluated checks ready | Real traffic still requires --allow-real-sandbox |'])].join('\n');
}
