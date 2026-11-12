import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync, writeFileSync, mkdirSync, symlinkSync, readdirSync, utimesSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, loadRepositoryEnv } from '../scripts/insw-sandbox-e2e';
import { options, policyBudgets, classify, inventory, select, environment, databaseEnvironment, dispatchBlockers, spacing, csv, type Entry, type Start } from '../scripts/insw-sandbox-e2e/core';
import { identityBlockers, loopbackAddress, inspect, gateReadiness } from '../scripts/insw-sandbox-e2e/database';
import { processBlockers, inspectProcesses, discoverLocalApp, verifyLocalApp, serverEnvironment, ListenerError } from '../scripts/insw-sandbox-e2e/local-app';
import type { PrismaClient } from '@prisma/client';
import { Evidence } from '../scripts/insw-sandbox-e2e/evidence';
import { submitOne } from '../scripts/insw-sandbox-e2e/submission';
import { reports } from '../scripts/insw-sandbox-e2e/report';
import { classifyTransportFailure } from '../lib/insw-worker/classification';
import { classifiedRetryDisposition } from '../lib/insw-worker/retry';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
const adjustment = { wms_id: 'OFFLINE-FIXTURE', company_code: 1370, owner: 1370, wms_doc_type: 'revise_adjustment',
  transaction_date: '2026-01-01', internal_evidence_number: 'FIXTURE', timestamp: '2026-01-01T00:00:00Z',
  items: [{ adjustment_type: 'GAIN', item_type: 'ROH', item_code: 'FIXTURE', item_name: 'fixture only', qty: 1.25, uom: 'KG' }] };
function goodEnv(): NodeJS.ProcessEnv { return { NODE_ENV: 'test', DATABASE_PHASE: 'development', DATABASE_URL: 'postgresql://app:secret@127.0.0.1:5432/imaps_db_vps',
  API_KEY: 'fixture-wms-key', INSW_1370_USE_TEST_MODE: 'true', INSW_1370_API_KEY: 'fixture-key', INSW_1370_UNIQUE_KEY_TEST: 'fixture-test',
  INSW_SANDBOX_OPERATOR_ACK: 'dedicated-local-no-other-producers-test-credentials-verified' }; }
test('CLI defaults to bounded offline smoke; rejects ambiguous/unsafe options', () => {
  const o = options([]); assert.equal(o.real, false); assert.equal(o.max, 3); assert.equal(o.posts, 3);
  for (const args of [['--company','1380'], ['--db','production'], ['--profile','other'], ['--max-transmissions','0'],
    ['--max-retries','11'], ['--resume','../x'], ['--allow-real-sandbox','--preflight-only'], ['--verify-local-state','--allow-real-sandbox'], ['--verify-local-state','--preflight-only'], ['--unknown']]) assert.throws(() => options(args));
  assert.equal(options(['--profile','full']).max,363);
});
test('classification is exclusive and revise_adjustment uses the actual adjustment schema without mutating source', async () => {
  assert.equal(classify({ incoming_date: 'x' }), 'incoming');
  assert.equal(classify({ outgoing_date: 'x' }), 'outgoing');
  assert.equal(classify({ transaction_date: 'x', work_order_number: 'w', items: [{ traceability_data: [] }] }), 'material');
  assert.equal(classify({ transaction_date: 'x', items: [{ planned_production_qty: 1 }] }), 'production');
  assert.equal(classify({ incoming_date: 'x', outgoing_date: 'x' }), null);
  assert.equal(classify({ wms_doc_type: { toString: null } }), null);
  const before = JSON.stringify(adjustment);
  const rows = await inventory([adjustment]); assert.equal(rows[0].state, 'ELIGIBLE'); assert.equal(rows[0].family,'adjustment');
  assert.equal(JSON.stringify(adjustment), before);
  const invalid = await inventory([{ ...adjustment, items: [{ ...adjustment.items[0], stockcount_order_number: 'disallowed' }] }]);
  assert.equal(invalid[0].state,'INVALID');
  assert.equal((await inventory([{ ...adjustment, owner: 1380 }]))[0].state,'INVALID');
  assert.ok((await inventory([adjustment,adjustment])).every(e => e.state === 'INVALID'));
  assert.equal((await inventory([{ wms_id: 'unknown', company_code:1370, owner:1370 }]))[0].state, 'UNSUPPORTED');
  await assert.rejects(inventory({ data: [] }));
});
test('selection respects eligibility, cross-family order and full cap', () => {
  const rows = ['incoming','incoming','outgoing','material','production','adjustment'].map((family,n) => ({
    index:n,id:String(n),family,state:'ELIGIBLE',issues:[],items:1 } as Entry));
  rows[0].state = 'PRE_EXISTING';
  assert.deepEqual(select(rows,3,'core').map(e => e.id), ['1','2','3']);
  assert.equal(select(rows,99,'full').length,5);
});
test('trusted phase, real key collision, proxy, Production and wrong DB fail closed', () => {
  assert.ok(environment(goodEnv(),options([])).destination.endsWith('/temp/transaksi'));
  for (const changes of <Partial<NodeJS.ProcessEnv>[]>[{ DATABASE_PHASE: undefined }, { INSW_1370_USE_TEST_MODE:'false' },
    { INSW_1370_UNIQUE_KEY_REAL:'fixture-test' }, { API_KEY:'' },
    { HTTPS_PROXY:'http://unknown' }, { DATABASE_URL:'postgresql://app:secret@production/imaps_db_vps' },
    { DATABASE_URL:'postgresql://app:secret@127.0.0.1/other' }, { INSW_SANDBOX_OPERATOR_ACK:'' }]) {
    assert.throws(() => environment({ ...goodEnv(), ...changes }, options([])));
  }
});
const start = (ns: string, overrides: Partial<Start> = {}): Start => ({ queue_id:'q',attempt_id:'a',wms_id:'fixture',
  monotonic_ns:ns,boot_id:'same',active:1,wall_time:'diagnostic',...overrides });
test('strict nanosecond spacing never rounds a borderline gap to pass; incomplete/different boot cannot pass', () => {
  assert.equal(spacing([start('0'),start('3599999999')],true).status,'FAIL');
  assert.equal(spacing([start('0'),start('3600000000')],true).status,'PASS');
  assert.equal(spacing([start('0'),start('3600000001',{active:2})],true).status,'FAIL');
  assert.equal(spacing([start('0'),start('3600000000')],false).status,'NOT VERIFIED');
  assert.equal(spacing([start('0'),start('3600000000',{boot_id:'new'})],true).status,'NOT VERIFIED');
  assert.equal(spacing([start('0')],true).status,'NOT VERIFIED');
});
test('actual fetch boundary is observed before invocation, preserves auth/proxy builder, and refusal prevents fetch', async () => {
  const previous = globalThis.fetch; const trace: string[] = [];
  const proxyKeys = ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'];
  const old = proxyKeys.map(k => process.env[k]); proxyKeys.forEach(k => delete process.env[k]);
  globalThis.fetch = async (url, init) => { trace.push('fetch'); assert.match(String(url), /\/temp\/transaksi$/);
    assert.equal(init?.method,'POST'); assert.equal(init?.redirect,'error'); return new Response('{"status":true}'); };
  try {
    const service = new INSWIntegrationService('offline-key','offline-unique',true);
    await service.requestFrozenTransaction('{}',new AbortController().signal,undefined,() => { trace.push('after'); },() => { trace.push('before'); });
    assert.deepEqual(trace,['before','fetch','after']);
    trace.length = 0;
    await assert.rejects(service.requestFrozenTransaction('{}',new AbortController().signal,undefined,undefined,() => { throw new Error('BUDGET_REFUSED'); }));
    assert.equal(trace.length,0);
  } finally { globalThis.fetch=previous; proxyKeys.forEach((k,n) => { if(old[n]===undefined) delete process.env[k]; else process.env[k]=old[n]; }); }
});
test('pre-send transport classification does not authorize ambiguous automatic retry', () => {
  const classification = classifyTransportFailure('CONNECTION','ECONNREFUSED');
  assert.equal(classifiedRetryDisposition({ classification, delivery:'POSSIBLY_STARTED', retryIndex:0,maxAutoRetrySnapshot:2,
    clientApprovedAmbiguousRetry:false,exclusiveStreamProven:true,priorInvocationEnded:true,outcomeDurablyRecorded:true }), 'HOLD');
});
test('submission records intent before HTTP, never replays unknown transport, and respects capped 429 backoff/collision', async () => {
  const seen: string[] = []; let calls=0; const waits: number[]=[];
  const base = { signal: new AbortController().signal,deadline:Date.now()+600000,
    record: (s:{state:string}) => seen.push(s.state),pause:async (ms:number) => { waits.push(ms); },collision:async () => false };
  await submitOne({ ...base,request:async () => { assert.equal(seen.at(-1),'SUBMISSION_INTENT'); calls++; throw Error('unknown'); } });
  assert.equal(calls,1); assert.equal(seen.at(-1),'SUBMISSION_UNKNOWN'); calls=0;
  await submitOne({ ...base,request:async () => { calls++; return new Response('',{status:calls<3?429:200}); } });
  assert.equal(calls,3); assert.deepEqual(waits,[1000,2000]); assert.equal(seen.at(-1),'ACCEPTED'); calls=0;
  await submitOne({ ...base,collision:async () => true,request:async () => { calls++; return new Response('',{status:429}); } });
  assert.equal(calls,1);
  calls=0; await submitOne({ ...base,request:async () => { calls++; return new Response('',{status:429,headers:{'retry-after':'999'}}); } });
  assert.equal(calls,1);
});
test('cancellation prevents submissions and stops retries', async () => {
  const c=new AbortController(); c.abort(); let calls=0;
  await submitOne({ signal:c.signal, deadline:Date.now()+60000, record:()=>{}, collision:async()=>false,pause:async()=>{},
    request:async()=>{calls++;return new Response('');} }); assert.equal(calls,0);
});
test('private evidence, exclusive lock, offline reports and CLI help need no DB/provider', async () => {
  const root=mkdtempSync(join(tmpdir(),'insw-offline-')); const run='fixture';
  try {
    const e=new Evidence(root,run,false);
    e.write('run-manifest.json',{fixture:true}); assert.equal(statSync(join(root,run,'run-manifest.json')).mode&0o777,0o600);
    assert.throws(()=>new Evidence(root,run,true));
    const result=reports(e,[],{},undefined,[],false,false);
    assert.ok(result.every(a => a.status !== 'PASS'));
    assert.match(readFileSync(join(root,run,'summary.md'),'utf8'),/NOT RUN/);
    assert.deepEqual(e.read('run-manifest.json'),{fixture:true});e.close();
    const next=new Evidence(root,run,true);next.close();
    let output = ''; const write = process.stdout.write;
    process.stdout.write = ((chunk: string) => { output += chunk; return true; }) as typeof write;
    try { await main(['--help']); } finally { process.stdout.write = write; }
    assert.match(output,/no network\/database access by default/);
    assert.equal(csv([{id:'a,"b'}],['id']), '"id"\n"a,""b"\n');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('whole default preflight produces all artifacts without opening DB or invoking HTTP', async () => {
  const root=mkdtempSync(join(tmpdir(),'insw-offline-command-'));
  const previousFetch=globalThis.fetch;
  globalThis.fetch=async()=>{throw Error('NETWORK_FORBIDDEN_IN_OFFLINE_TEST');};
  try {
    const payload=join(root,'source.json');writeFileSync(payload,JSON.stringify([adjustment]));
    await main(['--payload-file',payload,'--evidence-root',root,'--preflight-only']);
    const { readdirSync } = await import('node:fs');
    const dir=join(root,readdirSync(root).find(s=>s.startsWith('sandbox-'))!);
    for (const name of ['run-manifest.json','input-inventory.json','preflight.json','transmissions.csv','attempts.csv','sender-post-starts.csv','assertions.json','summary.md']) {
      assert.ok(statSync(join(dir,name)).isFile(),name);
    }
    const report=JSON.parse(readFileSync(join(dir,'assertions.json'),'utf8'));
    assert.equal(report.realSandboxPostsObserved,0);assert.ok(report.assertions.every((a:{status:string})=>a.status!=='PASS'));
    assert.equal(JSON.parse(readFileSync(join(dir,'run-manifest.json'),'utf8')).selected[0].id,adjustment.wms_id);
  } finally { globalThis.fetch=previousFetch;rmSync(root,{recursive:true,force:true}); }
});

test('resume lock accepts only a provably reaped local owner and rejects repository evidence', async () => {
  const { processIdentity } = await import('../lib/insw-worker/process-identity');
  const root=mkdtempSync(join(tmpdir(),'insw-resume-lock-'));
  try {
    const e=new Evidence(root,'run',false);e.close();
    writeFileSync(join(root,'run','.runner-lock'),JSON.stringify({ identity:{...processIdentity(),pid:2147483647} }),{mode:0o600});
    const resumed=new Evidence(root,'run',true);resumed.close();
    assert.throws(()=>new Evidence(process.cwd(),'must-not-be-created',false));
  } finally { rmSync(root,{recursive:true,force:true}); }
});
test('HTTP 200 acceptance and an empty observation cannot establish domain success or sender pacing', async () => {
  const root=mkdtempSync(join(tmpdir(),'insw-report-negative-'));
  try {
    const e=new Evidence(root,'negative',false);
    const selected=await inventory([adjustment]);
    const simulatedObservation={sources:[],queue:[],attempts:[],logs:[],wmsLogs:[],gate:null};
    const result=reports(e,selected,{[adjustment.wms_id]:{state:'ACCEPTED',http:200}},simulatedObservation,[],true,true);
    assert.equal(result.find(a=>a.scenario==='R01')!.status,'FAIL');
    assert.equal(result.find(a=>a.scenario==='R02')!.status,'NOT VERIFIED');
    assert.match(readFileSync(join(root,'negative','transmissions.csv'),'utf8'),/WMS_PERSISTENCE_MISSING/);
    e.close();
  } finally { rmSync(root,{recursive:true,force:true}); }
});

const actualIdentity = { database: 'imaps_db_vps', role: 'imapsuser', address: '127.0.0.1/32', port: 5432, recovery: false };
test('actual Prisma loopback identity passes; only exact host CIDRs are accepted', () => {
  assert.deepEqual(identityBlockers(actualIdentity, 5432), []);
  for (const address of ['127.0.0.1', '127.0.0.1/32', '::1', '::1/128']) {
    assert.ok(loopbackAddress(address)); assert.deepEqual(identityBlockers({ ...actualIdentity, address }, 5432), []);
  }
  for (const address of ['127.0.0.2', '127.0.0.1/24', '127.0.0.1/33', '::1/64', '::1/129', '::ffff:127.0.0.1', '10.0.0.1/32', '2001:db8::1', '', null]) {
    assert.equal(loopbackAddress(address), null);
    assert.deepEqual(identityBlockers({ ...actualIdentity, address }, 5432), ['OBSERVED_DATABASE_ADDRESS_NOT_LOOPBACK']);
  }
  for (const [change, code] of [
    [{ database: 'other' }, 'OBSERVED_DATABASE_NAME_MISMATCH'], [{ recovery: true }, 'OBSERVED_DATABASE_IN_RECOVERY'],
    [{ role: 'production' }, 'OBSERVED_DATABASE_ROLE_UNSAFE'], [{ role: 'unexpected' }, 'OBSERVED_DATABASE_ROLE_UNSAFE'],
    [{ port: 5433 }, 'OBSERVED_DATABASE_PORT_MISMATCH'],
  ] as const) assert.deepEqual(identityBlockers({ ...actualIdentity, ...change }, 5432), [code]);
});
test('production build and worker flag permit configuration only; credential blockers do not prevent DB config verification', () => {
  const env: NodeJS.ProcessEnv = { ...goodEnv(), NODE_ENV: 'production', DATABASE_PHASE: 'staging', NEXT_PUBLIC_ENVIRONMENT_PHASE: 'staging', INSW_WORKER_ENABLED: 'true' };
  assert.equal(environment(env, options([])).phase, 'staging');
  delete env.API_KEY;
  assert.deepEqual(databaseEnvironment(env, options([])).blockers, []);
  assert.ok(dispatchBlockers(env).includes('MISSING_API_KEY'));
  assert.throws(() => environment(env, options([])), /MISSING_API_KEY/);
  assert.ok(databaseEnvironment({ ...env, DATABASE_PHASE: 'production' }, options([])).blockers.includes('TRUSTED_DATABASE_PHASE_REQUIRED'));
});
test('dotenv loads quietly without overriding explicit environment; configured CLI defaults retain overrides', () => {
  const root = mkdtempSync(join(tmpdir(), 'insw-env-'));
  try {
    const file = join(root, '.env'); writeFileSync(file, 'API_KEY=file-secret\nDATABASE_PHASE=staging\nINSW_1370_API_KEY=server-only\n');
    const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', API_KEY: 'explicit-secret' };
    loadRepositoryEnv(file, env);
    assert.equal(env.API_KEY, 'explicit-secret'); assert.equal(env.DATABASE_PHASE, 'staging'); assert.equal(env.INSW_1370_API_KEY, 'server-only');
    const previous = process.env.INSW_SANDBOX_PAYLOAD_FILE;
    try {
      process.env.INSW_SANDBOX_PAYLOAD_FILE = '/configured/source.json';
      assert.equal(options([])['payload-file'], '/configured/source.json');
      assert.equal(options(['--payload-file', '/explicit/source.json'])['payload-file'], '/explicit/source.json');
    } finally { if (previous === undefined) delete process.env.INSW_SANDBOX_PAYLOAD_FILE; else process.env.INSW_SANDBOX_PAYLOAD_FILE = previous; }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('actual process presence blocks dispatch even with an idle gate; unreadable ownership fails closed', () => {
  const root = mkdtempSync(join(tmpdir(), 'insw-process-'));
  try {
    const base = join(root, '2147483646'); mkdirSync(base);
    writeFileSync(join(base, 'cmdline'), 'node\0PM2/ProcessContainerFork.js\0');
    writeFileSync(join(base, 'environ'), 'name=imaps-insw-worker\0pm_exec_path=/repo/scripts/insw-worker.ts\0');
    assert.deepEqual(processBlockers(root), ['COMPETING_INSW_PROCESS_ACTIVE']);
    writeFileSync(join(base, 'environ'), 'NODE_ENV=production\0INSW_WORKER_ENABLED=true\0');
    writeFileSync(join(base, 'cmdline'), 'next-server (v16)'); symlinkSync(process.cwd(), join(base, 'cwd'));
    assert.deepEqual(processBlockers(root), []);
    writeFileSync(join(base, 'cmdline'), 'node unknown-producer.js');
    assert.deepEqual(processBlockers(root), []);
    writeFileSync(join(base, 'cmdline'), 'node --import tsx /repo/scripts/insw-worker.ts');
    rmSync(join(base, 'environ')); mkdirSync(join(base, 'environ'));
    assert.deepEqual(processBlockers(root), ['PROCESS_OWNERSHIP_UNREADABLE']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('offline developer tools in the checkout do not compete, including the exact VS Code JSON server', () => {
  const root = mkdtempSync(join(tmpdir(), 'insw-editor-'));
  try {
    const base = join(root, '1655'); mkdirSync(base);
    const node = '/home/kabima/.vscode-server/bin/dcd3ad6e368fbe19d03f37054a40dbaf40d676f4/node';
    symlinkSync(process.cwd(), join(base, 'cwd')); symlinkSync(node, join(base, 'exe'));
    writeFileSync(join(base, 'environ'), 'NODE_ENV=production\0INSW_WORKER_ENABLED=true\0');
    for (const command of [
      `${node} ${node.slice(0, -5)}/extensions/json-language-features/server/dist/node/jsonServerMain --node-ipc --clientProcessId=1526`,
      `${node} /extensions/typescript-language-features/server.js --stdio`,
      'node ordinary-tool.js',
    ]) {
      writeFileSync(join(base, 'cmdline'), command);
      const result = inspectProcesses(root, join(root, 'no-pm2'));
      assert.deepEqual(result.blockers, []); assert.deepEqual(result.processes, []);
    }
    // No acknowledgement or owner recovery is inferred from ignoring the editor.
    assert.ok(dispatchBlockers({ ...goodEnv(), INSW_SANDBOX_OPERATOR_ACK: undefined }).includes('OPERATOR_ISOLATION_AND_CREDENTIAL_ACK_REQUIRED'));
    assert.equal(gateReadiness({ ...idleGate, owner_token: 'still-owned', lease_until: new Date(0) }).safe, false);
    rmSync(join(base, 'environ')); mkdirSync(join(base, 'environ'));
    assert.deepEqual(processBlockers(root), []); // No credible sender evidence.
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('offline sender launches remain blocked across wrappers, foreign cwd and editor Node binaries', () => {
  const root = mkdtempSync(join(tmpdir(), 'insw-launch-'));
  try {
    const base = join(root, '101'); mkdirSync(base);
    symlinkSync(tmpdir(), join(base, 'cwd'));
    symlinkSync('/home/user/.vscode-server/bin/version/node', join(base, 'exe'));
    for (const [command, env] of [
      ['node --import tsx /other/scripts/insw-worker.ts', ''],
      ['tsx /other/scripts/insw-worker.ts', ''],
      ['node /other/scripts/insw-isolated-worker.ts', ''],
      ['node --import tsx /other/scripts/insw-sandbox-e2e/worker.ts', ''],
      ['node PM2/ProcessContainerFork.js', 'name=imaps-insw-worker\0'],
      ['node PM2/ProcessContainerFork.js', 'pm_exec_path=/other/scripts/insw-worker.ts\0'],
      ['node npm-cli.js run sender', 'npm_lifecycle_script=node --import tsx scripts/insw-worker.ts\0'],
      ['node unknown-child.js', 'INSW_SANDBOX_CHILD=123\0'],
    ]) {
      writeFileSync(join(base, 'cmdline'), command); writeFileSync(join(base, 'environ'), env);
      const result = inspectProcesses(root, join(root, 'no-pm2'));
      assert.deepEqual(result.blockers, ['COMPETING_INSW_PROCESS_ACTIVE'], command);
      assert.equal(result.processes[0].kind, 'INSW_SENDER'); assert.equal(result.processes[0].cwd, tmpdir());
    }
    // Either surviving identity source suffices to fail closed.
    rmSync(join(base, 'cmdline')); mkdirSync(join(base, 'cmdline'));
    writeFileSync(join(base, 'environ'), 'name=imaps-insw-worker\0');
    assert.deepEqual(processBlockers(root), ['PROCESS_OWNERSHIP_UNREADABLE']);
    rmSync(join(base, 'cmdline'), { recursive: true });
    writeFileSync(join(base, 'cmdline'), 'node /other/scripts/insw-worker.ts');
    rmSync(join(base, 'environ')); mkdirSync(join(base, 'environ'));
    assert.deepEqual(processBlockers(root), ['PROCESS_OWNERSHIP_UNREADABLE']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('catalog inspection is read-only and aggregates independent gate, attempt, backlog and policy blockers', async () => {
  const statements: string[] = [];
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray) => { statements.push(sql.join('')); return 0; },
    $queryRaw: async () => [actualIdentity],
    companies: { findUnique: async () => ({ company_type: 'SEZ' }) },
    insw_dispatch_gate: { findUnique: async () => ({ owner_token: 'busy', busy_attempt_id: 'attempt' }) },
    insw_queue_attempt: { count: async () => 1 }, insw_queue_cycle: { count: async () => 1 },
    insw_transmission_policy: { findUnique: async () => ({ min_processing_interval_ms: 3600, max_auto_retry: 2 }) },
    insw_integration_settings: { findMany: async () => [] },
  };
  const db = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx) } as unknown as PrismaClient;
  const result = await inspect(db, 0);
  assert.deepEqual(statements, ['SET TRANSACTION READ ONLY']);
  assert.equal(result.identity.normalizedAddress, '127.0.0.1');
  for (const blocker of ['PRE_EXISTING_OR_UNRESOLVED_GATE_OWNER', 'UNFINISHED_PRIOR_ATTEMPT', 'PRE_EXISTING_QUEUE_OWNER', 'POLICY_EXCEEDS_RUN_BUDGET', 'PRE_EXISTING_QUEUE_BACKLOG', 'REQUIRED_ENDPOINT_SETTINGS_DISABLED_OR_MISSING']) assert.ok(result.blockers.includes(blocker));
});

test('read-only command queries catalog and collisions despite missing credentials and competing worker; no mutation or HTTP', async () => {
  const root = mkdtempSync(join(tmpdir(), 'insw-readonly-'));
  const oldExit = process.exitCode; const oldFetch = globalThis.fetch; const oldWrite = process.stdout.write;
  const changes = { ...goodEnv(), INSW_SANDBOX_OPERATOR_ACK: '', API_KEY: '', INSW_1370_API_KEY: '', NODE_ENV: 'production', DATABASE_PHASE: 'staging', NEXT_PUBLIC_ENVIRONMENT_PHASE: 'staging', INSW_WORKER_ENABLED: 'true' };
  const previous = Object.fromEntries(Object.keys(changes).map(k => [k, process.env[k]]));
  let queries = 0; let output = ''; const statements: string[] = [];
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray) => { statements.push(sql.join('')); return 0; },
    $queryRaw: async () => ++queries === 1 ? [{ ...actualIdentity, role: 'app' }] : [],
    companies: { findUnique: async () => ({ company_type: 'SEZ' }) },
    insw_dispatch_gate: { findUnique: async () => ({ owner_token: 'do-not-leak-owner', busy_attempt_id: null, process_identity: { pid: 123, host: 'do-not-leak-host' }, lease_until: new Date(0), last_started_at: null, prior_interval_ms: null }) },
    insw_queue_attempt: { count: async () => 0 },
    insw_queue_cycle: { count: async () => 0, findMany: async () => [] },
    insw_transmission_policy: { findUnique: async () => ({ min_processing_interval_ms: 3600, max_auto_retry: 2 }) },
    insw_integration_settings: { findMany: async () => Array.from({ length: 5 }, () => ({ is_enabled: true })) },
    wms_transmission_logs: { findMany: async () => [] }, insw_tracking_log: { findMany: async () => [] },
  };
  const db = { $transaction: async (fn: (value: typeof tx) => unknown) => fn(tx), $disconnect: async () => {} } as unknown as PrismaClient;
  try {
    Object.assign(process.env, changes);
    globalThis.fetch = async () => { throw Error('HTTP_FORBIDDEN'); };
    process.stdout.write = ((chunk: string) => { output += chunk; return true; }) as typeof oldWrite;
    const payload = join(root, 'source.json'); writeFileSync(payload, JSON.stringify([adjustment]));
    await main(['--payload-file', payload, '--evidence-root', root, '--verify-local-state', '--max-retries','0', '--max-sandbox-posts','1'], {
      database: () => db, processes: () => ({ blockers: ['COMPETING_INSW_PROCESS_ACTIVE', 'LOCAL_PROCESS_OWNERSHIP_UNKNOWN'], processes: [{ pid: 123, cwd: process.cwd(), kind: 'UNKNOWN', executable: '/usr/bin/node', blocker: 'LOCAL_PROCESS_OWNERSHIP_UNKNOWN' }], pm2: [] }),
      app: () => { throw new ListenerError('APP_LISTENER_NOT_UNIQUELY_VERIFIED_SET_INSW_SANDBOX_APP_PID', [{ pid: 456, cwd: process.cwd(), port:3000, verified:false, reason:'APP_SERVER_ENVIRONMENT_MISMATCH' }]); },
    });
    const { readdirSync } = await import('node:fs');
    const dir = join(root, readdirSync(root).find(s => s.startsWith('sandbox-'))!);
    const preflight = JSON.parse(readFileSync(join(dir, 'preflight.json'), 'utf8'));
    assert.equal(preflight.mode, 'READ_ONLY_DATABASE'); assert.equal(preflight.stateVerification, 'QUERIED'); assert.equal(preflight.collisions, 'CHECKED');
    for (const code of ['MISSING_API_KEY', 'MISSING_INSW_1370_API_KEY', 'COMPETING_INSW_PROCESS_ACTIVE', 'LOCAL_PROCESS_OWNERSHIP_UNKNOWN', 'OPERATOR_ISOLATION_AND_CREDENTIAL_ACK_REQUIRED', 'PRE_EXISTING_OR_UNRESOLVED_GATE_OWNER', 'POLICY_EXCEEDS_RUN_BUDGET', 'APP_LISTENER_NOT_UNIQUELY_VERIFIED_SET_INSW_SANDBOX_APP_PID']) assert.ok(preflight.blockers.includes(code));
    assert.equal(preflight.credentials.API_KEY, 'MISSING'); assert.equal(preflight.credentials.INSW_1370_UNIQUE_KEY_TEST, 'SET');
    assert.ok(queries > 1); assert.ok(statements.every(s => s === 'SET TRANSACTION READ ONLY'));
    assert.equal(JSON.parse(readFileSync(join(dir, 'assertions.json'), 'utf8')).realSandboxPostsObserved, 0);
    assert.equal(process.exitCode, 2); assert.match(output, /pm2 stop imaps-insw-worker/); assert.doesNotMatch(output, /fixture-test|fixture-wms-key|secret|do-not-leak/);
    assert.doesNotMatch(JSON.stringify(preflight), /do-not-leak/);
    assert.match(output, /BLOCKER.*EVIDENCE.*ONE ACTION TO RESOLVE/);
    assert.match(output, /--max-retries 2 --max-sandbox-posts 3/);
    assert.match(output, /settings\/database-cleanup/);
    assert.equal(preflight.budgets.posts, 1); assert.equal(preflight.budgets.retries, 0);
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    process.exitCode = oldExit; globalThis.fetch = oldFetch; process.stdout.write = oldWrite; rmSync(root, { recursive: true, force: true });
  }
});

// All tests below are OFFLINE: synthetic /proc, in-memory catalog and no provider.
test('offline policy-derived defaults and explicit hard caps never mutate retry policy', () => {
  const policy = Object.freeze({ max_auto_retry: 2, min_processing_interval_ms: 3600 });
  const core = policyBudgets(options(['--profile','core']), 10, policy);
  assert.equal(core.retries, 2); assert.equal(core.posts, 30); assert.deepEqual(core.blockers, []);
  assert.equal(policyBudgets(options([]), 3, policy).posts, 9);
  const capped = policyBudgets(options(['--max-retries','0','--max-sandbox-posts','3']), 3, policy);
  assert.equal(capped.retries, 0); assert.equal(capped.posts, 3);
  assert.ok(capped.blockers.includes('POLICY_EXCEEDS_RUN_BUDGET'));
  assert.match(capped.action, /--max-retries 2 --max-sandbox-posts 9/);
  assert.ok(policyBudgets(options(['--max-sandbox-posts','8']), 3, policy).blockers.includes('POLICY_EXCEEDS_RUN_BUDGET'));
  const ceiling = policyBudgets(options(['--profile','full']), 363, policy);
  assert.equal(ceiling.posts, 1000); assert.ok(ceiling.blockers.includes('POST_BUDGET_CEILING_EXCEEDED'));
  assert.match(ceiling.action, /--max-transmissions.*333/);
  assert.equal(policyBudgets(options([]), 2, policy).posts, 6); // actual chosen count, not profile cap
  for (const p of [null, { ...policy, max_auto_retry: 11 }, { ...policy, max_auto_retry: -1 }, { ...policy, min_processing_interval_ms: 3599 }]) {
    assert.ok(policyBudgets(options([]), 3, p).blockers.includes('POLICY_UNSAFE_OR_UNSUPPORTED'));
  }
});
const idleGate = { owner_token: null, busy_attempt_id: null, process_identity: null, lease_until: null,
  last_started_at: null, prior_interval_ms: null, recovery_barrier_at: null };
test('offline gate history preserves pacing; expired or unknown ownership and corrupt history remain blocked without secrets', () => {
  const paced = { ...idleGate, last_started_at: new Date(), prior_interval_ms: 3600 };
  assert.equal(gateReadiness(paced).safe, true);
  for (const gate of [null, { ...idleGate, owner_token: 'private-owner-token' }, { ...idleGate, busy_attempt_id: 'private-busy-id' },
    { ...idleGate, process_identity: { pid: 123, host: 'private-host' } }, { ...idleGate, lease_until: new Date(0) },
    { ...idleGate, recovery_barrier_at: new Date() }, { ...paced, prior_interval_ms: 3599 }]) {
    const summary = gateReadiness(gate); assert.equal(summary.safe, false);
    assert.doesNotMatch(JSON.stringify(summary), /private-owner-token|private-busy-id|private-host/);
  }
  assert.equal(gateReadiness({ ...idleGate, lease_until: new Date(0) }).lease, 'EXPIRED');
  assert.equal(gateReadiness({ ...idleGate, lease_until: new Date(Date.now() + 60000) }).lease, 'ACTIVE');
});
test('offline evidence creates default-shaped private root; refuses symlink parents, public root and foreign Git tree', () => {
  const root = mkdtempSync(join(tmpdir(), 'insw-private-root-'));
  try {
    const privateRoot = join(root, '.local/share/imaps-insw-sandbox/evidence');
    const e = new Evidence(privateRoot, 'run', false);
    assert.equal(statSync(privateRoot).mode & 0o777, 0o700);
    e.write('private.json', { approved: true });
    assert.equal(statSync(join(e.dir,'private.json')).mode & 0o777, 0o600); e.close();
    symlinkSync(privateRoot, join(root, 'linked'));
    assert.throws(() => new Evidence(join(root, 'linked/new'), 'run', false), /SYMLINK/);
    const publicRoot = join(root,'public'); mkdirSync(publicRoot, { mode: 0o755 });
    assert.throws(() => new Evidence(publicRoot, 'run', false), /MODE_0700/);
    const git = join(root, 'tree'); mkdirSync(join(git, '.git'), { recursive: true }); writeFileSync(join(git, '.git/HEAD'), 'ref: refs/heads/main');
    assert.throws(() => new Evidence(join(git, 'evidence'), 'run', false), /INSIDE_GIT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
function fakeProc() {
  const root = mkdtempSync(join(tmpdir(), 'insw-listener-'));
  mkdirSync(join(root,'net')); writeFileSync(join(root,'net/tcp'), 'header\n0: 0100007F:0BB8 00000000:0000 0A 0 0 0 0 0 1234\n');
  writeFileSync(join(root,'net/tcp6'), 'header\n');
  const env: NodeJS.ProcessEnv = { ...goodEnv(), NODE_ENV: 'production', DATABASE_PHASE: 'staging', NEXT_PUBLIC_ENVIRONMENT_PHASE: 'staging' };
  const add = (pid: number, command = 'next-server (v16)', values = env) => {
    const base = join(root,String(pid)); mkdirSync(join(base,'fd'), { recursive: true });
    symlinkSync('socket:[1234]', join(base,'fd/20')); symlinkSync(join(root,'net'), join(base,'net'));
    symlinkSync(process.cwd(), join(base,'cwd')); symlinkSync('/usr/bin/node', join(base,'exe'));
    writeFileSync(join(base,'cmdline'), command); writeFileSync(join(base,'environ'), Object.entries(values).map(([k,v]) => `${k}=${v}`).join('\0'));
    return base;
  };
  return { root, env, add };
}
test('offline exact listener discovery accepts staging production build, validates overrides, and refuses ambiguity', () => {
  const f = fakeProc();
  try {
    const base = f.add(101);
    assert.equal(discoverLocalApp(undefined, 'http://127.0.0.1:3000', f.env, f.root).pid, 101);
    assert.deepEqual(inspectProcesses(f.root, join(f.root, 'no-pm2')).processes.map(p => [p.kind, p.blocker]), [['NEXT_APP', undefined]]);
    assert.equal(verifyLocalApp('101', 'http://127.0.0.1:3000', f.env, f.root).environmentSource, 'INITIAL_PROCESS_ENVIRONMENT');
    f.add(102);
    assert.throws(() => discoverLocalApp(undefined, 'http://127.0.0.1:3000', f.env, f.root), (e: unknown) => {
      assert.ok(e instanceof ListenerError); assert.equal(e.candidates.length, 2);
      assert.equal(e.candidates[0].cwd, process.cwd()); assert.equal(e.candidates[0].port, 3000); return true;
    });
    assert.equal(discoverLocalApp('102', 'http://127.0.0.1:3000', f.env, f.root).pid, 102);
    unlinkSync(join(base,'fd/20'));
    assert.deepEqual(readdirSync(join(base,'fd')), []);
    assert.throws(() => verifyLocalApp('101', 'http://127.0.0.1:3000', f.env, f.root), /DOES_NOT_OWN_LISTENER/);
    assert.throws(() => verifyLocalApp('102', 'http://127.0.0.1:3000', { ...f.env, DATABASE_URL:'postgresql://app:secret@remote/imaps_db_vps' }, f.root), /ENVIRONMENT_MISMATCH/);
    assert.throws(() => verifyLocalApp('102', 'https://api.insw.go.id/api-prod/inventory/real/transaksi', f.env, f.root), /LOOPBACK/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('offline listener diagnostics retain exact refusal, never arbitrary argv or credential values', () => {
  const f = fakeProc();
  try {
    f.add(101, 'next-server (v16)', { ...f.env, API_KEY:'different-private-key' });
    assert.throws(() => discoverLocalApp(undefined, 'http://127.0.0.1:3000', f.env, f.root), (e: unknown) => {
      assert.ok(e instanceof ListenerError); assert.equal(e.candidates[0].pid,101);
      assert.equal(e.candidates[0].reason, 'APP_SERVER_ENVIRONMENT_MISMATCH');
      assert.doesNotMatch(JSON.stringify(e.candidates), /different-private-key|fixture-key|fixture-test/); return true;
    });
    assert.throws(() => discoverLocalApp('101', 'http://127.0.0.1:3000', f.env, f.root), /ENVIRONMENT_MISMATCH/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('offline PM2 child/socket verification and live vs stale metadata do not trust worker flags', () => {
  const f = fakeProc();
  try {
    const child = f.add(101, 'node PM2/ProcessContainerFork.js');
    // A verified PM2 label may identify the exec wrapper; socket ownership still required.
    writeFileSync(join(child,'environ'), Object.entries({ ...f.env, pm_exec_path:'/repo/node_modules/next/dist/bin/next' }).map(([k,v]) => `${k}=${v}`).join('\0'));
    assert.equal(discoverLocalApp(undefined, 'http://127.0.0.1:3000', f.env, f.root).pid,101);
    mkdirSync(join(f.root,'pm2')); writeFileSync(join(f.root,'pm2/dump.pm2'), JSON.stringify([{ name:'imaps-insw-worker',pid:999,status:'stopped',env:{ API_KEY:'do-not-print' } }]));
    let result = inspectProcesses(f.root, join(f.root,'pm2'));
    assert.deepEqual(result.blockers, []); assert.equal(result.pm2[0].live,false);
    writeFileSync(join(child,'environ'), 'name=imaps-insw-worker\0pm_exec_path=/repo/scripts/insw-worker.ts\0');
    result = inspectProcesses(f.root, join(f.root,'pm2'));
    assert.ok(result.blockers.includes('COMPETING_INSW_PROCESS_ACTIVE')); assert.equal(result.processes[0].pid,101);
    assert.doesNotMatch(JSON.stringify(result), /do-not-print/);
    writeFileSync(join(child,'environ'), 'INSW_WORKER_ENABLED=false\0'); writeFileSync(join(child,'cmdline'), 'node unknown.js --secret=do-not-print');
    result = inspectProcesses(f.root, join(f.root,'pm2'));
    assert.deepEqual(result.blockers, []); assert.deepEqual(result.processes, []);
    assert.doesNotMatch(JSON.stringify(result), /do-not-print/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test('offline no listener, unrelated Node socket owner and unaccounted listener cannot be selected', () => {
  const f = fakeProc();
  try {
    assert.throws(() => discoverLocalApp(undefined, 'http://127.0.0.1:3000', f.env, f.root), /NOT_UNIQUELY_VERIFIED/);
    const base = f.add(101,'node arbitrary-server.js');
    writeFileSync(join(base,'stat'), '101 (node) S 999 0');
    assert.throws(() => discoverLocalApp(undefined, 'http://127.0.0.1:3000', f.env, f.root), /NOT_UNIQUELY_VERIFIED/);
    writeFileSync(join(base,'cmdline'), 'next-server (v16)');
    writeFileSync(join(f.root,'net/tcp6'), 'header\n0: 00000000000000000000000000000000:0BB8 0:0 0A 0 0 0 0 0 5678\n');
    assert.throws(() => discoverLocalApp(undefined, 'http://127.0.0.1:3000', f.env, f.root), /NOT_UNIQUELY_VERIFIED/);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});

test('offline Next env-file verification uses startup precedence and rejects changed, expanded or unknown values', () => {
  const root = mkdtempSync(join(tmpdir(),'insw-env-source-'));
  try {
    const base = join(root, '123'); mkdirSync(base);
    const fields = Array.from({length:20}, () => '0'); fields[0] = 'S'; fields[1] = '1'; fields[19] = '10000';
    writeFileSync(join(base,'stat'), `123 (next-server) ${fields.join(' ')}`);
    writeFileSync(join(root,'stat'), 'btime 1000\n');
    const initial = { NODE_ENV: 'production' } as NodeJS.ProcessEnv;
    writeFileSync(join(root,'.env'), 'API_KEY=base\nDATABASE_PHASE=staging\n');
    writeFileSync(join(root,'.env.production.local'), 'API_KEY=highest\n');
    for (const f of ['.env','.env.production.local']) utimesSync(join(root,f), 1000,1000);
    const expected: NodeJS.ProcessEnv = { NODE_ENV: 'production', API_KEY: 'highest', DATABASE_PHASE:'staging' };
    const resolved = serverEnvironment(base, initial, 'production', expected, root, root);
    assert.equal(resolved.values.API_KEY, 'highest'); assert.equal(resolved.values.DATABASE_PHASE,'staging');
    assert.equal(resolved.source, 'NEXT_ENV_FILES_PREDATING_PROCESS');
    assert.throws(() => serverEnvironment(base, initial, undefined, expected, root, root), /MODE_NOT_VERIFIED/);
    utimesSync(join(root,'.env'), 2000,2000);
    assert.throws(() => serverEnvironment(base, initial, 'production', expected, root, root), /CHANGED_RESTART_APP/);
    writeFileSync(join(root,'.env'), 'API_KEY=$OTHER\n'); utimesSync(join(root,'.env'),1000,1000);
    writeFileSync(join(root,'.env.production.local'),''); utimesSync(join(root,'.env.production.local'),1000,1000);
    assert.throws(() => serverEnvironment(base, initial, 'production', expected, root, root), /EXPANSION_NOT_VERIFIED/);
  } finally { rmSync(root, { recursive:true,force:true }); }
});

test('offline ready read-only command computes 3 WMS/9 POST budgets but never sends, spawns or mutates', async () => {
  const root = mkdtempSync(join(tmpdir(),'insw-ready-'));
  const changes = { ...goodEnv(), DATABASE_PHASE:'staging', NEXT_PUBLIC_ENVIRONMENT_PHASE:'staging' };
  const previous = Object.fromEntries(Object.keys(changes).map(k => [k,process.env[k]]));
  const oldFetch = globalThis.fetch; const oldExit = process.exitCode; const oldWrite = process.stdout.write;
  let output = ''; let queries = 0; let requests = 0; const statements: string[] = [];
  const tx = {
    $executeRaw: async (sql: TemplateStringsArray) => { const statement=sql.join(''); statements.push(statement); assert.equal(statement,'SET TRANSACTION READ ONLY'); return 0; },
    $queryRaw: async () => ++queries === 1 ? [{ ...actualIdentity, role:'app' }] : [],
    companies: { findUnique:async () => ({ company_type:'SEZ' }) },
    insw_dispatch_gate: { findUnique:async () => idleGate },
    insw_queue_attempt: { count:async () => 0 }, insw_queue_cycle: { count:async () => 0, findMany:async () => [] },
    insw_transmission_policy: { findUnique:async () => ({ min_processing_interval_ms:3600,max_auto_retry:2 }) },
    insw_integration_settings: { findMany:async () => Array.from({length:5},() => ({is_enabled:true})) },
    wms_transmission_logs: { findMany:async () => [] }, insw_tracking_log: { findMany:async () => [] },
  };
  const db = { $transaction:async (fn:(value:typeof tx)=>unknown) => fn(tx), $disconnect:async () => {} } as unknown as PrismaClient;
  try {
    Object.assign(process.env,changes); process.exitCode=0;
    globalThis.fetch=async () => { requests++; throw Error('OFFLINE_HTTP_FORBIDDEN'); };
    process.stdout.write=((chunk:string) => { output+=chunk; return true; }) as typeof oldWrite;
    const payload=join(root,'source.json'); writeFileSync(payload,JSON.stringify([0,1,2].map(n => ({ ...adjustment,wms_id:`OFFLINE-${n}` }))));
    await main(['--payload-file',payload,'--evidence-root',join(root,'evidence'),'--verify-local-state'], {
      database:() => db, processes:() => [], app:() => ({pid:123,url:'http://127.0.0.1:3000',verified:true,environmentSource:'OFFLINE_FIXTURE'}),
    });
    const run=join(root,'evidence',readdirSync(join(root,'evidence'))[0]);
    const preflight=JSON.parse(readFileSync(join(run,'preflight.json'),'utf8'));
    const manifest=JSON.parse(readFileSync(join(run,'run-manifest.json'),'utf8'));
    assert.deepEqual(preflight.blockers,[]); assert.equal(preflight.budgets.retries,2); assert.equal(preflight.budgets.posts,9);
    assert.equal(manifest.posts,9); assert.equal(manifest.selected.length,3); assert.equal(manifest.child,undefined);
    assert.equal(manifest.token,undefined); assert.equal(requests,0); assert.equal(process.exitCode,0);
    assert.ok(statements.length>0); assert.match(output,/dispatch: READY/);
    const assertions=JSON.parse(readFileSync(join(run,'assertions.json'),'utf8'));
    assert.equal(assertions.realSandboxPostsObserved,0); assert.ok(assertions.assertions.every((a:{status:string})=>a.status!=='PASS'));
    // Same in-memory DB policy, business cap of four POSTs: one fixture at 1+2 retries.
    queries=0;
    writeFileSync(payload,JSON.stringify([0,1,2].map(n=>incomingFixture(`BUSINESS-${n}`))));
    await main(['--payload-file',payload,'--evidence-root',join(root,'business-evidence'),'--verify-local-state',
      '--selection-mode','business-independent','--max-sandbox-posts','4'], {
      database:()=>db,processes:()=>[],app:()=>({pid:123,url:'http://127.0.0.1:3000',verified:true,environmentSource:'OFFLINE_FIXTURE'}),
    });
    const businessRun=join(root,'business-evidence',readdirSync(join(root,'business-evidence'))[0]);
    const plan=JSON.parse(readFileSync(join(businessRun,'dependency-plan.json'),'utf8'));
    const businessManifest=JSON.parse(readFileSync(join(businessRun,'run-manifest.json'),'utf8'));
    assert.equal(plan.selected.length,1);assert.equal(plan.budgets.retryCap,2);assert.equal(plan.budgets.postCap,4);
    assert.equal(plan.budgets.plannedWorstCasePosts,3);
    assert.deepEqual(plan.selected,businessManifest.selected);
    assert.equal(requests,0);assert.equal(process.exitCode,0);
  } finally {
    for (const [k,v] of Object.entries(previous)) { if(v===undefined) delete process.env[k]; else process.env[k]=v; }
    globalThis.fetch=oldFetch; process.exitCode=oldExit; process.stdout.write=oldWrite; rmSync(root,{recursive:true,force:true});
  }
});

test('offline retry assertion needs complete sender-linked policy-compliant traces; policy alone never proves R03', () => {
  const root=mkdtempSync(join(tmpdir(),'insw-retry-traces-'));
  const e=new Evidence(root,'fixture',false);
  try {
    const ended=new Date(1000), started=new Date(5000);
    const observation = {
      sources:[], wmsLogs:[], gate:null,
      queue:[{id:'q',wms_reference:'fixture',operation:'ADJUSTMENT',source_log_id:null,payload_sha256:'frozen',status:'SUCCEEDED',delivery_state:'KNOWN_SUCCESS',hold_reason:null,retry_index:1,max_auto_retry_snapshot:2}],
      attempts:[{id:'first',queue_id:'q',retry_index:0,started_at:new Date(0),completed_at:ended,delivery_state:'KNOWN_FAILURE'},
        {id:'retry',queue_id:'q',retry_index:1,started_at:started,completed_at:new Date(6000),delivery_state:'KNOWN_SUCCESS'}],
      logs:[{id:1,queue_attempt_id:'first',transaction_id:1,transaction_type:'adjustment',wms_id:'fixture',insw_status:'FAILED',http_code:429,provider_status:false,classification:'TRANSIENT_FAILURE',reason_code:'RATE_LIMIT_REJECTION',payload_sha256:'frozen'},
        {id:2,queue_attempt_id:'retry',transaction_id:1,transaction_type:'adjustment',wms_id:'fixture',insw_status:'SUCCESS',http_code:200,provider_status:true,classification:'SUCCESS',reason_code:null,payload_sha256:'frozen'}],
    } as unknown as NonNullable<Parameters<typeof reports>[3]>;
    const traces=[start('0',{attempt_id:'first'}),start('3600000000',{attempt_id:'retry'})];
    const r03=(complete:boolean, starts:Start[])=>reports(e,[],{},observation,starts,complete,true).find(a=>a.scenario==='R03')!.status;
    assert.equal(r03(true,[]),'NOT RUN'); assert.equal(r03(false,traces),'NOT RUN');
    assert.equal(r03(true,traces),'PASS'); // Offline assertion logic only, not physical acceptance.
    observation.queue[0].max_auto_retry_snapshot=0; assert.equal(r03(true,traces),'NOT RUN');
    observation.queue[0].max_auto_retry_snapshot=2; observation.attempts[0].delivery_state='POSSIBLY_STARTED';
    assert.equal(r03(true,traces),'NOT RUN');
  } finally { e.close(); rmSync(root,{recursive:true,force:true}); }
});

test('offline gate process identity distinguishes a proven live local owner and refuses release', async () => {
  const { processIdentity } = await import('../lib/insw-worker/process-identity');
  const identity = processIdentity();
  const gate = { ...idleGate, owner_token:'withheld', lease_until:new Date(0), process_identity:identity };
  const live = gateReadiness(gate);
  assert.equal(live.identity.state,'VERIFIED_LOCAL_OWNER_LIVE'); assert.equal(live.safe,false);
  assert.equal(live.identity.pid,process.pid);
  const reused = gateReadiness({ ...gate, process_identity:{ ...identity,start:'wrong-start' } });
  assert.equal(reused.identity.state,'REUSED_PID'); assert.equal(reused.safe,false);
  const reaped = gateReadiness({ ...gate, process_identity:{ ...identity,pid:2147483647 } });
  assert.equal(reaped.identity.state,'REAPED_LOCAL'); assert.equal(reaped.safe,false);
  assert.doesNotMatch(JSON.stringify(live), /withheld/);
});

test('R06 splits absent duplicate coverage from source failures; provider rejection remains independent of HELD', async () => {
  const root = mkdtempSync(join(tmpdir(), 'insw-r06-components-'));
  const e = new Evidence(root, 'simulated', false);
  try {
    const entries = await inventory([adjustment]);
    const entry = entries[0];
    const observation = {
      sources: [{ table: 'adjustments', id: 1, wms_id: entry.id, item_count: 1, reversal: entry.checks!.reversal,
        work_order_hash: entry.checks!.workOrderHash, item_hash: entry.checks!.itemsHash }],
      queue: [{ id: 'queue', operation: 'ADJUSTMENT', wms_reference: entry.id, status: 'HELD', delivery_state: 'POSSIBLY_STARTED',
        payload_sha256: 'hash', retry_index: 0, max_auto_retry_snapshot: 2 }],
      attempts: [{ id: 'attempt', queue_id: 'queue', retry_index: 0, started_at: new Date(), completed_at: new Date(), delivery_state: 'POSSIBLY_STARTED' }],
      logs: [{ id: 'log', queue_attempt_id: 'attempt', transaction_id: 1, transaction_type: 'adjustment', wms_id: entry.id,
        insw_status: 'FAILED', http_code: 400, provider_status: false, classification: 'PERMANENT_FAILURE',
        reason_code: 'MISSING_ITEM_VALIDATION', payload_sha256: 'hash' }],
      wmsLogs: [{ id: 1, wms_id: entry.id, transmission_status: 'SUCCESS' }], gate: null,
    } as unknown as NonNullable<Parameters<typeof reports>[3]>;
    const starts: Start[] = [{ wms_id: entry.id, queue_id: 'queue', attempt_id: 'attempt', monotonic_ns: '1', boot_id: 'boot', active: 1, wall_time: '' }];
    const run = (duplicate?: boolean) => reports(e, entries, { [entry.id]: { state: 'ACCEPTED', http: 200 } }, observation, starts, true, true, true, duplicate);
    assert.equal(run().find(a => a.scenario === 'R06')!.status, 'NOT VERIFIED');
    const saved = JSON.parse(readFileSync(join(e.dir, 'assertions.json'), 'utf8'));
    assert.deepEqual(saved.r06Checks, { preservation: 'PASS', frozen_hashes: 'PASS', source_contract: 'PASS', duplicate_probe: 'NOT RUN', retry_coverage: 'NOT RUN' });
    assert.equal(saved.realSandboxPostsObserved, 1);
    const csv = readFileSync(join(e.dir, 'transmissions.csv'), 'utf8');
    assert.match(csv, /"ON_HOLD","ACCEPTED","RESPONSE_OBSERVED","REJECTED"/);
    assert.match(readFileSync(join(e.dir, 'summary.md'), 'utf8'), /0 ACCEPTED, 1 REJECTED/);
    reports(e, entries, { [entry.id]: { state: 'ACCEPTED', http: 200 } }, observation, starts, true, true, true, undefined, undefined, 'business-independent');
    const business = JSON.parse(readFileSync(join(e.dir, 'business-acceptance.json'), 'utf8'));
    assert.equal(business.status, 'UNMET');
    assert.equal(business.rows[0].providerAcceptance, 'EXPECTED_BUSINESS_REJECTION');
    assert.equal(business.rows[0].localStatus, 'HELD');
    assert.equal(business.rows[0].localDeliveryState, 'POSSIBLY_STARTED');
    assert.equal(run(false).find(a => a.scenario === 'R06')!.status, 'FAIL');
    assert.equal(run(true).find(a => a.scenario === 'R06')!.status, 'NOT VERIFIED'); // no actual retries
    observation.sources[0].item_hash = 'mismatched';
    assert.equal(run().find(a => a.scenario === 'R06')!.status, 'FAIL');
    const failed = JSON.parse(readFileSync(join(e.dir, 'assertions.json'), 'utf8'));
    assert.equal(failed.r06Checks.source_contract, 'FAIL');
    assert.equal(failed.r06Checks.duplicate_probe, 'NOT RUN');
    observation.logs[0].classification = 'UNKNOWN';
    run();
    assert.match(readFileSync(join(e.dir, 'transmissions.csv'), 'utf8'), /"RESPONSE_OBSERVED","UNKNOWN"/);
  } finally { e.close(); rmSync(root, { recursive: true, force: true }); }
});

test('offline Incoming route + service + duplicate guard return 409 without source/queue/attempt insertions', async () => {
  const vm = await import('node:vm');
  const ts = await import('typescript');
  const { NextResponse } = await import('next/server');
  const rows = { sources: [{ id: 7, company_code: 1370, wms_id: 'OFFLINE-EXISTING', deleted_at: null }], queues: [{ id: 'existing-queue' }], attempts: [{ id: 'existing-attempt' }] };
  const before = JSON.stringify(rows);
  let reads = 0;
  let writes = 0;
  const forbiddenWrite = () => { writes++; throw new Error('OFFLINE_WRITE_FORBIDDEN'); };
  const logger = { info() {}, warn() {}, error() {}, child() { return logger; } };
  const prisma = {
    incoming_goods: { findFirst: async (query: unknown) => {
      reads++;
      assert.deepEqual(JSON.parse(JSON.stringify(query)), { where: { company_code: 1370, wms_id: 'OFFLINE-EXISTING', deleted_at: null }, select: { id: true } });
      return rows.sources[0];
    }, create: forbiddenWrite },
    insw_queue_cycle: { create: forbiddenWrite }, insw_queue_attempt: { create: forbiddenWrite },
    $transaction: forbiddenWrite,
  };
  const noErrors = () => [];
  const stubs: Record<string, unknown> = {
    '@/lib/db/prisma': { prisma },
    '../repositories/incoming-goods.repository': { IncomingGoodsRepository: class { createOrUpdate = forbiddenWrite; } },
    '../validators/schemas/incoming-goods.schema': {
      validateIncomingGoodRequest: (data: unknown) => ({ success: true, data }), validateIncomingGoodsDates: noErrors,
      validateItemTypes: noErrors, checkIncomingGoodsDuplicates: noErrors, validateIncomingGoodsItemTypeConsistency: noErrors,
    },
    '../utils/logger': { logger },
    '@/lib/utils/logger': { createRequestLogger: () => ({ logger }), logRequest: async () => {}, logResponse() {} },
    '@/lib/utils/wms-async-failure-log': { logWmsAsyncFailure: forbiddenWrite },
    '@/lib/validators/free-movement-customs-document': { validateSezFreeMovementCustomsDocumentType: noErrors },
    '@/lib/validators/non-facility-marker.validator': { validateNonFacilityMarker: noErrors },
    '@/lib/middleware/auth.middleware': { authenticate: async () => ({ authenticated: true }) },
    '@/lib/middleware/rate-limiter.middleware': { rateLimiterMiddleware: () => ({ success: true }) },
    '@/lib/middleware/error-handler.middleware': { errorHandler: forbiddenWrite },
    '@/lib/log-activity': { logActivity: forbiddenWrite },
    'next/server': { NextResponse },
  };
  const files: Record<string, string> = {
    '@/lib/services/wms-duplicate.service': 'lib/services/wms-duplicate.service.ts',
    '@/lib/services/incoming-goods.service': 'lib/services/incoming-goods.service.ts',
    route: 'app/api/v1/incoming-goods/route.ts',
  };
  const cache: Record<string, Record<string, unknown>> = {};
  const load = (name: string): Record<string, unknown> => {
    if (name in stubs) return stubs[name] as Record<string, unknown>;
    if (cache[name]) return cache[name];
    assert.ok(files[name], `Unexpected resource import: ${name}`);
    const exports: Record<string, unknown> = {};
    cache[name] = exports;
    vm.runInNewContext(ts.transpileModule(readFileSync(files[name], 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, { exports, module: { exports }, require: load, crypto: globalThis.crypto, Date });
    return exports;
  };
  // Earlier validation is mocked; the real service's duplicate branch and the
  // real route's HTTP mapping run unchanged. No resource import can escape load.
  const service = load('@/lib/services/incoming-goods.service').IncomingGoodsService as { prototype: { validateBusiness: () => Promise<unknown[]> } };
  service.prototype.validateBusiness = async () => [];
  const route = load('route').POST as (request: unknown) => Promise<Response>;
  const response = await route({ json: async () => ({ wms_id: 'OFFLINE-EXISTING', company_code: 1370, items: [{ qty: 1 }] }) });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).errors[0].code, 'DUPLICATE_WMS_ID_NOT_ALLOWED');
  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(rows.queues.length, 1);
  assert.equal(rows.attempts.length, 1);
});

test('material source digest uses trace quantities after schema strips item qty; input row counts stay original', async () => {
  const { itemHash } = await import('../scripts/insw-sandbox-e2e/core');
  const payload = { wms_id: 'OFFLINE-MATERIAL', owner: 1370, company_code: 1370, reversal: 'Y',
    transaction_date: '2026-01-01', internal_evidence_number: 'FIXTURE', timestamp: '2026-01-01T00:00:00Z', work_order_number: 'WO-FIXTURE',
    items: [{ item_type: 'ROH', item_code: 'FIXTURE', item_name: 'fixture', qty: 3, uom: 'PC',
      traceability_data: [{ ppkek_number: null, qty: 1 }, { ppkek_number: null, qty: 2 }] }] };
  const before = JSON.stringify(payload);
  const [entry] = await inventory([payload]);
  assert.equal(entry.state, 'ELIGIBLE');
  assert.equal(entry.items, 1); // input inventory
  assert.equal(entry.checks!.sourceItemCount, 2); // persisted trace rows
  assert.equal(entry.checks!.itemsHash, itemHash([{ item_code: 'FIXTURE', uom: 'PC', qty: 1 }, { item_code: 'FIXTURE', uom: 'PC', qty: 2 }]));
  assert.equal(JSON.stringify(payload), before);
});

import { dependencyPlan } from '../scripts/insw-sandbox-e2e/dependencies';
import { providerOutcome } from '../scripts/insw-sandbox-e2e/provider-outcome';
import type { Source } from '../scripts/insw-sandbox-e2e/core';
import type { Observation } from '../scripts/insw-sandbox-e2e/database';
const incomingFixture = (id: string, overrides: Source = {}): Source => ({
  wms_id: id, company_code: 1370, owner: 1370, ppkek_number: 'PP-ONE', customs_document_type: 'BC23',
  customs_registration_date: '2026-01-01', incoming_date: '2026-01-02', incoming_evidence_number: id,
  shipper_name: 'offline', timestamp: '2026-01-02T00:00:00Z',
  items: [{ item_type: 'ROH', item_code: 'TG70M4JAJL03', item_name: 'offline', uom: 'CAR', qty: 5, currency: 'USD', amount: 1 }], ...overrides,
});
const outgoingFixture = (): Source => ({ ...incomingFixture('PMI0126070300001-01-TEST-7df9e60c'),
  customs_document_type: 'BC30', invoice_number: 'offline', invoice_date: '2026-01-01', incoming_date: undefined, outgoing_date: '2026-07-03', recipient_name: 'offline', outgoing_evidence_number: 'offline',
  items: [{ item_type: 'ROH', item_code: 'TG70M4JAJL03', item_name: 'offline', uom: 'CAR', qty: 1, currency: 'USD', amount: 1,
    work_order_allocations: [{ ppkek_number: 'N', work_order_number: null, qty: 1 }] }],
});
function outgoingSource() { const p = outgoingFixture(); delete p.incoming_date; return p; }
const businessOptions = (...args: string[]) => options(['--selection-mode', 'business-independent', ...args]);

test('business decision gate: five actual-shape candidates never prove PMI upstream; defaults unchanged', async () => {
  const data = [outgoingSource(), ...['3753e0cd','6fec3ac4','f41225d1','d8f405e6','38519f29'].map(id => incomingFixture(id))];
  const before = JSON.stringify(data); const entries = await inventory(data);
  assert.ok(entries.every(e => e.state === 'ELIGIBLE'));
  assert.equal(entries[0].family, 'outgoing');
  const plan = dependencyPlan(data, entries, businessOptions());
  assert.deepEqual(plan.selected.map(e => e.index), [1,2,3]);
  assert.deepEqual(plan.graph.edges, []);
  assert.equal(plan.diagnostics[0].status, 'UNRESOLVED');
  const diagnostic = plan.diagnostics[0]; assert.ok('requirements' in diagnostic);
  assert.equal(diagnostic.requirements[0].itemCandidates.length, 5);
  assert.equal(diagnostic.requirements[0].references[0].reason, 'MISSING_AUTHORITATIVE_INCOMING_REFERENCE');
  assert.deepEqual(select(entries,3,'smoke').map(e => e.index), [1,0,2]);
  assert.deepEqual(select(entries,3,'core').map(e => e.index), [1,0,2]);
  assert.deepEqual(select(entries,3,'full').map(e => e.index), [0,1,2]);
  assert.equal(JSON.stringify(data), before);
});

test('PPKEK/UOM/company/quantity are diagnostic boundaries, including ambiguity and missing inventory', async () => {
  const out = outgoingSource();
  (out.items as Source[])[0].qty = 6;
  (out.items as Source[])[0].work_order_allocations = [{ ppkek_number: 'PP-ONE', qty: 6 }];
  const data = [out, incomingFixture('low'), incomingFixture('duplicate-pp'),
    incomingFixture('wrong-uom', { items: [{ ...(incomingFixture('x').items as Source[])[0], uom: 'KG', qty: 100 }] }),
    incomingFixture('wrong-pp', { ppkek_number: 'OTHER' }), incomingFixture('wrong-company', { company_code: 1380, owner: 1380 })];
  const entries = await inventory(data); const plan = dependencyPlan(data,entries,businessOptions());
  const diagnostic = plan.diagnostics[0]; assert.ok('requirements' in diagnostic);
  const req = diagnostic.requirements[0];
  assert.equal(req.itemCandidates.length,4); assert.equal(req.uomCandidates.length,3);
  assert.equal(req.references[0].candidates.length,2); assert.equal(req.references[0].quantityCompatibleCandidates.length,0);
  assert.equal(req.references[0].reason,'AMBIGUOUS_PPKEK_CANDIDATES');
  const missing = dependencyPlan([out],await inventory([out]),businessOptions());
  assert.equal(missing.selected.length,0); assert.equal(missing.diagnostics[0].status,'UNRESOLVED');
  assert.deepEqual(missing.graph.edges,[]);
});

test('business budgets, duplicate eligibility and pre-existing unverified fixtures cannot authorize replay', async () => {
  const data = [incomingFixture('one'),incomingFixture('two'),incomingFixture('three')];
  const entries = await inventory(data); entries[0].state='PRE_EXISTING';
  const plan = dependencyPlan(data,entries,businessOptions('--max-retries','2','--max-sandbox-posts','4'),true);
  assert.deepEqual(plan.selected.map(e=>e.id),['two']);
  assert.equal(plan.budgets.plannedWorstCasePosts,3); assert.equal(plan.diagnostics[0].status,'BLOCKED');
  assert.equal(plan.diagnostics[2].reason,'INSUFFICIENT_WMS_OR_POST_RETRY_BUDGET');
  const zero = dependencyPlan(data,entries,businessOptions('--max-retries','2','--max-sandbox-posts','1'));
  assert.equal(zero.selected.length,0);
  const duplicate = [data[0],data[0]];
  assert.equal(dependencyPlan(duplicate,await inventory(duplicate),businessOptions()).selected.length,0);
  assert.throws(()=>businessOptions('--allow-real-sandbox','--resume','old'));
});

test('untrusted cyclic/forward references do not construct edges or make dependent/reversal fixtures eligible', async () => {
  const a = outgoingSource(); const b = { ...outgoingSource(), wms_id:'second', upstream_wms_id:a.wms_id };
  a.upstream_wms_id=b.wms_id;
  const data = [a,b,{ ...adjustment, reversal:'Y' }];
  const plan=dependencyPlan(data,await inventory(data),businessOptions());
  assert.deepEqual(plan.graph.edges,[]); assert.equal(plan.selected.length,0);
  assert.ok(plan.diagnostics.every(d=>d.status==='UNRESOLVED' || d.status==='SKIPPED'));
});

test('provider evidence is independent of actual queue hold; HTTP alone never establishes acceptance/rejection', () => {
  const log = { id:BigInt(1), queue_attempt_id:'a', transaction_id:1, transaction_type:'outgoing',wms_id:'pmi',insw_status:'FAILED',
    http_code:400, provider_status:false,classification:'PERMANENT_FAILURE',reason_code:'MISSING_ITEM_VALIDATION',payload_sha256:'hash' } as Observation['logs'][number];
  assert.equal(providerOutcome([log]),'EXPECTED_BUSINESS_REJECTION');
  assert.equal(providerOutcome([{...log,reason_code:'UNRECOGNIZED_CODE_02',classification:'UNKNOWN'}]),'UNKNOWN');
  assert.equal(providerOutcome([{...log,http_code:200}]),'UNKNOWN');
  assert.equal(providerOutcome([{...log,http_code:200,provider_status:true,classification:'KNOWN_REMOTE_SUCCESS',insw_status:'SUCCESS'}]),'ACCEPTED');
  assert.equal(providerOutcome([]),'UNKNOWN');
});

test('source-only business plan never invokes DB, process, app or network and keeps physical assertions NOT RUN', async () => {
  const root=mkdtempSync(join(tmpdir(),'insw-business-')); const previousFetch=globalThis.fetch;
  const refuse=()=>{ throw new Error('OFFLINE_BOUNDARY_CALLED'); };
  globalThis.fetch=async()=>refuse();
  try {
    const payload=join(root,'source.json');writeFileSync(payload,JSON.stringify([incomingFixture('incoming'),outgoingSource()]));
    await main(['--preflight-only','--selection-mode','business-independent','--payload-file',payload,'--evidence-root',join(root,'evidence')],
      { database:refuse, processes:refuse, app:refuse });
    const run=join(root,'evidence',readdirSync(join(root,'evidence'))[0]);
    const plan=JSON.parse(readFileSync(join(run,'dependency-plan.json'),'utf8'));
    assert.equal(plan.selected.length,1);assert.equal(plan.collisions,'NOT VERIFIED: source-only plan');
    const business=JSON.parse(readFileSync(join(run,'business-acceptance.json'),'utf8'));
    assert.equal(business.status,'NOT RUN');
    const assertions=JSON.parse(readFileSync(join(run,'assertions.json'),'utf8'));
    assert.ok(assertions.assertions.every((a:{status:string})=>a.status!=='PASS'));
  } finally {globalThis.fetch=previousFetch;rmSync(root,{recursive:true,force:true});}
});
