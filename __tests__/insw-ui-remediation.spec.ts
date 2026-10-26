import { test, expect, chromium } from '@playwright/test';
import { PrismaClient, type InswQueueStatus, type InswDeliveryState } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { encode } from 'next-auth/jwt';
import ExcelJS from 'exceljs';
import { operationalLogPage } from '../lib/insw-queue/operational-logs';
import { deliveryLabel } from '../lib/insw-queue/operational-state';
import { resendWmsLog, wmsLogResendEligibility } from '../lib/insw-queue/wms-coordination';
import { resolveMenuGrants } from '../lib/menu-auth';
import { logResendEligibility } from '../lib/insw-log-actions';
import { canonicalIdentity, freezePayload } from '../lib/insw-queue/contracts';

const url = process.env.INSW_UI_TEST_DATABASE_URL;
const base = 'http://127.0.0.1:3109';
const secret = 'fixture-only-secret-for-insw-ui-remediation-2026';
test.skip(!url, 'Explicit isolated fixture database required');
test.describe.configure({ mode: 'serial' });
let db: PrismaClient;
let querySql: string[] = [];
let queryEvents: { query: string; params: string }[] = [];
let viewer = ''; let denied = ''; let other = ''; let operator = '';
const actors: Record<string, { cookie: string; id: string; role: string; view: boolean; create: boolean; edit: boolean; company: number }> = {};
let manualIncomingId = 0; let manualOutgoingId = 0;
let browserResendLog = ''; let browserQueueId = '';
let settingsMenuId = '';
let stockLog = ''; let legacyLog = ''; let exhaustedLog = '';
const ref = `UI-${Date.now()}`;
const queueIds: Record<string, string> = {};
let deniedUserId = '';
let adjustmentId = 0;
let parentId = '';
let menuId = '';
const originalFetch = globalThis.fetch;

async function cookie(id: string, companyCode = 1370, role = 'USER') {
  const token = await encode({ secret, token: { id, role, companyCode: String(companyCode), name: id, email: `${id}@fixture.test` } });
  return `next-auth.session-token=${token}`;
}
async function api(path: string, auth = viewer, init: RequestInit = {}) {
  return originalFetch(`${base}/api/insw/${path}`, { ...init, headers: { ...init.headers, ...(auth ? { Cookie: auth } : {}) } });
}
async function queue(name: string, status: InswQueueStatus, delivery: InswDeliveryState, retry = 0, log = true, operation: 'INCOMING' | 'OUTGOING' = 'INCOMING') {
  const identity = canonicalIdentity({ kind: 'WMS_REFERENCE', operation, companyCode: 1370,
    reference: `${ref}-${name}`, businessDate: '2026-10-26', revision: 'ACCEPTED_WMS_ID' }).key;
  const frozen = freezePayload({ data: [name] });
  const q = await db.insw_queue_cycle.create({ data: { company_code: 1370, operation, identity_key: identity,
    source_revision: 'ACCEPTED_WMS_ID', business_date: '2026-10-26', wms_reference: `${ref}-${name}`, cycle: 1,
    intent: 'SOURCE_COMMIT', requested_by: 'fixture', frozen_payload: frozen.payload, payload_sha256: frozen.sha256,
    max_auto_retry_snapshot: status === 'FAILED' ? 0 : 2, status, delivery_state: delivery, retry_index: retry,
    ...(status === 'HELD' && { hold_reason: 'DELIVERY_UNKNOWN', error_message: 'Fixture uncertain delivery' }),
    ...(['SUCCEEDED', 'FAILED'].includes(status) && { completed_at: new Date() }),
    ...(status === 'CLAIMED' && { owner_token: randomUUID(), lease_until: new Date(Date.now() + 60000), claimed_at: new Date() }),
  } });
  queueIds[name] = q.id;
  if (!log && status !== 'CLAIMED') return;
  const a = await db.insw_queue_attempt.create({ data: { queue_id: q.id, retry_index: retry, owner_token: randomUUID(), delivery_state: delivery,
    started_at: new Date(), ...(status !== 'CLAIMED' && { completed_at: new Date() }) } });
  if (!log) return;
  const l = await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: operation.toLowerCase(), wms_id: `${ref}-${name}`,
    insw_status: status === 'SUCCEEDED' ? 'SUCCESS' : 'FAILED', queue_attempt_id: a.id, sent_at: new Date() } });
  if (name === 'exhausted') exhaustedLog = l.id.toString();
}

async function recoveryFixture(name: string) {
  await queue(name, 'FAILED', 'KNOWN_FAILURE');
  const q = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: queueIds[name] } });
  const source = await db.incoming_goods.create({ data: { company_code: 1370, owner: 1370, wms_id: q.wms_reference!, incoming_date: new Date('2026-10-26'), ppkek_number: 'FIXTURE', incoming_evidence_number: 'FIXTURE', shipper_name: 'Fixture', timestamp: new Date() } });
  const log = await db.insw_tracking_log.findFirstOrThrow({ where: { wms_id: q.wms_reference! } });
  await db.insw_tracking_log.update({ where: { id: log.id }, data: { transaction_id: source.id } });
  return { q, log };
}

test.beforeAll(async () => {
  const parsed = new URL(url!);
  if (parsed.hostname !== '127.0.0.1' || parsed.port !== '55439' || parsed.pathname !== '/imaps_ui_remediation_test') throw new Error('UNSAFE_FIXTURE_DATABASE');
  const client = new PrismaClient({ datasources: { db: { url } }, log: [{ emit: 'event', level: 'query' }] });
  client.$on('query', e => { querySql.push(e.query); queryEvents.push({ query: e.query, params: e.params }); });
  db = client;
  globalThis.fetch = async (input, init) => {
    if (!String(input).startsWith(`${base}/`)) throw new Error('NO_EXTERNAL_HTTP');
    return originalFetch(input, init);
  };
  await db.companies.createMany({ data: [1370, 1380].map(code => ({ code, name: `UI Fixture ${code}`, company_type: 'SEZ' })), skipDuplicates: true });
  await db.menus.updateMany({ where: { menu_path: '/insw/logs' }, data: { is_active: false } });
  parentId = (await db.menus.create({ data: { menu_name: ref } })).id;
  menuId = (await db.menus.create({ data: { menu_name: `${ref}-INSW Logs`, menu_path: '/insw/logs', parent_id: parentId } })).id;
  for (const [name, company, view, create, edit, role] of [
    ['view', 1370, true, false, false, 'USER'], ['none', 1370, false, false, false, 'USER'],
    ['foreign', 1380, true, true, true, 'USER'], ['combined', 1370, true, true, true, 'USER'],
    ['create', 1370, false, true, false, 'USER'], ['edit', 1370, false, false, true, 'USER'],
    ['delete', 1370, false, false, false, 'USER'], ['admin', 1370, true, true, true, 'ADMIN'],
    ['manager', 1370, false, false, false, 'USER'],
  ] as const) {
    const user = await db.users.create({ data: { username: `${ref}-${name}`, email: `${ref}-${name}@fixture.test`, password: 'NO_LOGIN', full_name: name, company_code: company, role } });
    if (role !== 'ADMIN' && (view || create || edit || name === 'delete')) {
      await db.user_access_menus.create({ data: { menu_id: menuId, user_id: user.id, can_view: view, can_create: create, can_edit: edit, can_delete: name === 'delete' } });
      if (view) await db.user_access_menus.create({ data: { menu_id: parentId, user_id: user.id, can_view: true } });
    }
    actors[name] = { cookie: await cookie(user.id, company, role), id: user.id, role, view, create, edit, company };
  }
  viewer = actors.view.cookie; denied = actors.none.cookie; other = actors.foreign.cookie; operator = actors.combined.cookie;
  deniedUserId = actors.none.id;
  settingsMenuId = (await db.menus.create({ data: { menu_name: `${ref}-Settings`, menu_path: '/settings/access-menu' } })).id;
  await db.menus.updateMany({ where: { menu_path: '/settings/access-menu', id: { not: settingsMenuId } }, data: { is_active: false } });
  await db.user_access_menus.create({ data: { menu_id: settingsMenuId, user_id: actors.manager.id, can_view: true } });
  for (const endpoint_key of ['SALDO_AWAL', 'SALDO_AWAL_FINAL', 'CAPITAL_GOODS_OUT', 'SCRAP_IN', 'SCRAP_OUT']) {
    await db.insw_integration_settings.upsert({ where: { endpoint_key }, create: { endpoint_key, endpoint_name: 'Disabled fixture', is_enabled: false }, update: { is_enabled: false } });
  }
  await queue('manual-incoming', 'READY', 'NOT_STARTED', 0, false);
  manualIncomingId = (await db.incoming_goods.create({ data: { company_code: 1370, owner: 1370, wms_id: `${ref}-manual-incoming`, incoming_date: new Date('2026-10-26'), ppkek_number: 'FIXTURE', incoming_evidence_number: 'FIXTURE', shipper_name: 'Fixture', timestamp: new Date() } })).id;
  await queue('manual-outgoing', 'READY', 'NOT_STARTED', 0, false, 'OUTGOING');
  manualOutgoingId = (await db.outgoing_goods.create({ data: { company_code: 1370, owner: 1370, wms_id: `${ref}-manual-outgoing`, outgoing_date: new Date('2026-10-26'), ppkek_number: 'FIXTURE', outgoing_evidence_number: 'FIXTURE', recipient_name: 'Fixture', timestamp: new Date(), invoice_number: 'FIXTURE', invoice_date: new Date('2026-10-26') } })).id;
  await queue('waiting', 'READY', 'NOT_STARTED', 0, false);
  await queue('active', 'CLAIMED', 'POSSIBLY_STARTED', 0, false);
  await queue('retrying', 'READY', 'NOT_STARTED', 1);
  await queue('exhausted', 'FAILED', 'KNOWN_FAILURE');
  await queue('terminal', 'FAILED', 'KNOWN_FAILURE');
  await queue('held', 'HELD', 'POSSIBLY_STARTED');
  await queue('success', 'SUCCEEDED', 'KNOWN_SUCCESS');
  const old = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: queueIds.exhausted } });
  await db.insw_queue_cycle.create({ data: { company_code: 1370, operation: 'INCOMING', identity_key: old.identity_key, cycle: 2,
    intent: 'MANUAL_RESUBMIT', requested_by: 'fixture', source_log_id: BigInt(exhaustedLog), frozen_payload: old.frozen_payload!,
    payload_sha256: old.payload_sha256, max_auto_retry_snapshot: 0, source_revision: old.source_revision, business_date: old.business_date, wms_reference: old.wms_reference } });
  legacyLog = (await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: 'incoming', wms_id: `${ref}-legacy`, insw_status: 'FAILED' } })).id.toString();
  stockLog = (await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: 'stock_opname', wms_id: `${ref}-stock`, insw_status: 'FAILED' } })).id.toString();
  const header = await db.adjustments.create({ data: { company_code: 1380, owner: 1380, wms_id: ref, internal_evidence_number: ref, transaction_date: new Date('2026-10-26'), timestamp: new Date() } });
  adjustmentId = header.id;
  await db.adjustment_items.create({ data: { adjustment_id: header.id, adjustment_company: 1380, adjustment_date: header.transaction_date,
    adjustment_type: 'GAIN', item_type: 'ROH', item_code: ref, item_name: ref, uom: 'PCS', qty: 1, stockcount_order_number: `${ref}-stock` } });
});
test.afterAll(async () => { globalThis.fetch = originalFetch; await db?.$disconnect(); });

// These fixture baseline queries reproduce the former tracking-only and unscoped-count gaps.
test('baseline gaps: tracking-only cannot see READY; unscoped adjustment count leaks B', async () => {
  expect(await db.insw_tracking_log.count({ where: { wms_id: `${ref}-waiting` } })).toBe(0);
  expect(await db.adjustment_items.count({ where: { stockcount_order_number: `${ref}-stock`, deleted_at: null } })).toBe(1);
});

test('bounded lifecycle page preserves attempt outcomes and current successor; 10/50 use two queries', async () => {
  for (let i = 0; i < 50; i++) await queue(`perf-${i}`, 'READY', 'NOT_STARTED', 0, false);
  await new Promise(resolve => setTimeout(resolve, 30));
  for (const limit of [10, 50]) {
    querySql = [];
    queryEvents = [];
    const result = await operationalLogPage(db, { company_code: 1370, limit, offset: 0, wms_id: ref });
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(result.logs).toHaveLength(limit);
    expect(querySql).toHaveLength(2);
    expect(querySql.join(' ')).not.toContain('frozen_payload');
    expect(result.logs.every(l => !('insw_request_payload' in l) && !('insw_response' in l))).toBe(true);
    console.log(`PERF ${limit}: ${querySql.length} queries`);
  }
  const page = await operationalLogPage(db, { company_code: 1370, limit: 100, offset: 0, wms_id: ref, date_from: '2026-10-25', date_to: '2026-10-27' });
  const byName = (name: string) => page.logs.find(l => l.wms_id === `${ref}-${name}`)!;
  expect(deliveryLabel(byName('waiting').current_queue)).toContain('waiting');
  expect(deliveryLabel(byName('active').current_queue)).toContain('in flight');
  expect(deliveryLabel(byName('retrying').current_queue)).toContain('automatic retry');
  expect(byName('retrying').insw_status).toBe('FAILED');
  expect(deliveryLabel(byName('held').current_queue)).toContain('HELD');
  expect(deliveryLabel(byName('terminal').current_queue)).toBe('FAILED — KNOWN_FAILURE');
  expect(byName('success').current_queue?.status).toBe('SUCCEEDED');
  expect(byName('legacy').current_queue).toBeNull();
  const original = page.logs.find(l => l.id === exhaustedLog)!;
  expect(original.insw_status).toBe('FAILED');
  expect(original.current_queue?.intent).toBe('MANUAL_RESUBMIT');
  expect(original.current_queue?.cycle).toBe(2);
  expect(byName('waiting').sent_at).toBeNull();
  const measured = queryEvents.slice(0, 2);
  for (const event of measured) {
    const plans = await db.$queryRawUnsafe<{ 'QUERY PLAN': string }[]>('EXPLAIN (ANALYZE, BUFFERS) ' + event.query, ...JSON.parse(event.params));
    console.log('EXPLAIN measured query', plans.map(p => p['QUERY PLAN']).join('\n'));
  }
});

test('legacy DIRECT Scrap visibility hides only duplicate technical claims', async () => {
  const common = { company_code: 1370, transaction_type: 'scrap_in', wms_id: `${ref}-scrap`, transaction_id: 101 };
  const claim = await db.insw_tracking_log.create({ data: { ...common, insw_status: 'PENDING',
    created_at: new Date(Date.now() - 2000), metadata: { claim: true } } });
  const actual = await db.insw_tracking_log.create({ data: { ...common, insw_status: 'SUCCESS', insw_request_payload: { fixture: true } } });
  const lifecycle = await db.insw_tracking_log.create({ data: { ...common, insw_status: 'PENDING', metadata: { claim: true, attempt_lifecycle: true } } });
  const final = await db.insw_tracking_log.create({ data: { ...common, insw_status: 'FAILED', metadata: { claim: true } } });
  const page = await operationalLogPage(db, { company_code: 1370, wms_id: `${ref}-scrap`, limit: 10, offset: 0 });
  expect(page.logs.map(l => l.id).sort()).toEqual([actual.id, lifecycle.id, final.id].map(String).sort());
  expect(page.logs.some(l => l.id === claim.id.toString())).toBe(false);
  expect(page.logs.every(l => l.current_queue === null)).toBe(true);
});

test('grant resolution plus mixed WMS/legacy eligibility has constant query count at 10/50 rows', async () => {
  for (let i = 0; i < 25; i++) {
    await queue(`grant-perf-${i}`, 'READY', 'NOT_STARTED', 1);
    await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: 'capital_goods_out',
      wms_id: `${ref}-grant-perf-capital-${i}`, insw_status: 'FAILED' } });
  }
  const counts: number[] = [];
  await new Promise(resolve => setTimeout(resolve, 30));
  for (const limit of [10, 50]) {
    querySql = [];
    const grants = await resolveMenuGrants({ user: { id: actors.combined.id, email: 'fixture@test.invalid', role: 'USER', companyCode: '1370' }, expires: '2099-01-01' }, '/insw/logs', db);
    const page = await operationalLogPage(db, { company_code: 1370, wms_id: `${ref}-grant-perf`, limit, offset: 0 });
    const eligible = await logResendEligibility(db, 1370, page.logs);
    await new Promise(resolve => setTimeout(resolve, 30));
    expect(page.logs).toHaveLength(limit);
    expect(grants.canEdit).toBe(true);
    expect(eligible.size).toBeGreaterThan(0);
    counts.push(querySql.length);
    console.log(`AUTH+PAGE+ELIGIBILITY ${limit}: ${querySql.length} queries`);
  }
  expect(counts[0]).toBe(counts[1]);
  expect(counts[0]).toBe(5); // one grant + two page/state + two eligibility queries
});

test('real HTTP/session denies anonymous and no VIEW grant on every read route', async () => {
  for (const path of ['logs', 'logs/metadata', 'logs/chart-stats', 'logs/export', `logs/${legacyLog}`, `logs/${stockLog}/check-adjustments`]) {
    expect((await api(path, '')).status, path).toBe(401);
    expect((await api(path, denied)).status, path).toBe(403);
    expect((await api(path, viewer)).status, path).toBe(200);
  }
  expect((await api(`logs/${legacyLog}`, other)).status).toBe(404);
  const foreignPage = await (await api(`logs?wms_id=${ref}`, other)).json();
  expect(foreignPage.data).toEqual([]);
  expect(foreignPage.pagination.total).toBe(0);
  expect((await api(`logs/queue:${queueIds.waiting}`, other)).status).toBe(404);
  await db.user_access_menus.create({ data: { menu_id: menuId, user_id: deniedUserId, can_view: true } });
  expect((await api('logs', denied)).status).toBe(403); // inaccessible parent
});

test('independent VIEW/CREATE/EDIT/DELETE and established ADMIN bypass on real HTTP sessions', async () => {
  for (const [name, actor] of Object.entries(actors).filter(([name]) => name !== 'manager')) {
    for (const path of ['logs', 'logs/metadata', 'logs/chart-stats', 'logs/export', `logs/${legacyLog}`, `logs/${stockLog}/check-adjustments`, `logs/queue:${queueIds.waiting}`]) {
      const status = (await api(path, actor.cookie)).status;
      expect(status, `${name}: ${path}`).toBe(actor.view ? (actor.company === 1380 && [
        `logs/${legacyLog}`, `logs/${stockLog}/check-adjustments`, `logs/queue:${queueIds.waiting}`,
      ].includes(path) ? 404 : 200) : 403);
    }
    const submitBody = JSON.stringify({ ids: [manualIncomingId], company_code: 1380 });
    const incoming = await api('post/pemasukan', actor.cookie, { method: 'POST', body: submitBody });
    expect(incoming.status, `${name}: incoming`).toBe(!actor.create ? 403 : actor.company === 1380 ? 409 : 202);
    const outgoing = await api('post/pengeluaran', actor.cookie, { method: 'POST', body: JSON.stringify({ ids: [manualOutgoingId], company_code: 1380 }) });
    expect(outgoing.status, `${name}: outgoing`).toBe(!actor.create ? 403 : actor.company === 1380 ? 400 : 202);
    if (incoming.status === 202) {
      const result = await incoming.json();
      expect(result.status).toBe('already_pending');
      expect(result.message).toContain('not remote INSW delivery');
    }
    for (const path of ['post/saldo-awal', 'post/saldo-awal-final']) {
      expect((await api(path, actor.cookie, { method: 'POST' })).status, `${name}: ${path}`).toBe(actor.create ? 200 : 403);
    }
    const { q, log } = await recoveryFixture(`policy-${name}`);
    const before = await db.insw_queue_cycle.count({ where: { identity_key: q.identity_key } });
    const response = await api(`logs/${log.id}/resend`, actor.cookie, { method: 'POST' });
    expect(response.status, `${name}: resend`).toBe(!actor.edit ? 403 : actor.company === 1380 ? 404 : 202);
    const cycles = await db.insw_queue_cycle.findMany({ where: { identity_key: q.identity_key }, orderBy: { cycle: 'asc' } });
    expect(cycles.length).toBe(before + (actor.edit && actor.company === 1370 ? 1 : 0));
    if (response.status === 202) {
      expect((await response.json()).status).toBe('accepted');
      expect(cycles[1].frozen_payload).toEqual(q.frozen_payload);
      expect(cycles[1].payload_sha256).toBe(q.payload_sha256);
  expect(freezePayload(cycles[1].frozen_payload).sha256).toBe(cycles[1].payload_sha256);
      expect((await db.insw_tracking_log.findUniqueOrThrow({ where: { id: log.id } })).metadata).toMatchObject({ manual_resend: { operator: actor.id } });
      expect((await api(`logs/${log.id}/resend`, actor.cookie, { method: 'POST' })).status).toBe(409);
    }
  }
  for (const path of [`logs/${exhaustedLog}/resend`, 'post/pemasukan', 'post/pengeluaran', 'post/saldo-awal', 'post/saldo-awal-final']) {
    expect((await api(path, '', { method: 'POST' })).status).toBe(401);
  }
});

test('server action affordance combines EDIT with current eligibility, including legacy DIRECT', async () => {
  const { log } = await recoveryFixture('eligible-ui');
  browserResendLog = log.id.toString(); browserQueueId = queueIds['eligible-ui'];
  for (const auth of [operator, actors.admin.cookie]) {
    const row = await (await api(`logs/${log.id}`, auth)).json();
    expect(row.data.can_resend).toBe(true);
    const page = await (await api(`logs?wms_id=${ref}-eligible-ui`, auth)).json();
    expect(page.data.find((r: { id: string }) => r.id === log.id.toString()).can_resend).toBe(true);
  }
  expect((await (await api(`logs/${log.id}`, viewer)).json()).data.can_resend).toBe(false);
  expect((await api(`logs/${log.id}`, actors.edit.cookie)).status).toBe(403);
  for (const fixture of ['held', 'success', 'retrying', 'active']) {
    const page = await (await api(`logs?wms_id=${ref}-${fixture}`, operator)).json();
    expect(page.data.every((r: { can_resend: boolean }) => r.can_resend === false)).toBe(true);
    const id = page.data.find((r: { id: string }) => !r.id.startsWith('queue:'))?.id;
    if (id) expect((await api(`logs/${id}/resend`, operator, { method: 'POST' })).status).toBe(409);
  }
  const legacy = await db.insw_tracking_log.create({ data: { company_code: 1370, transaction_type: 'capital_goods_out', wms_id: `${ref}-capital`, insw_status: 'FAILED' } });
  expect((await (await api(`logs/${legacy.id}`, operator)).json()).data.can_resend).toBe(true);
  expect((await api(`logs/${legacy.id}/resend`, viewer, { method: 'POST' })).status).toBe(403);
  expect((await api(`logs/${legacy.id}/resend`, actors.edit.cookie, { method: 'POST' })).status).toBe(200); // fixture endpoint disabled
  const scrap = await db.insw_tracking_log.findFirstOrThrow({ where: { wms_id: `${ref}-scrap`, insw_status: 'FAILED' } });
  expect((await (await api(`logs/${scrap.id}`, operator)).json()).data.can_resend).toBe(false); // same source has SUCCESS
  expect((await api(`logs/${scrap.id}/resend`, actors.edit.cookie, { method: 'POST' })).status).toBe(409);
});

test('permission editor API enforces existing page access and company scope; round-trip preserves independent grants', async () => {
  const target = actors.create;
  const endpoint = `${base}/api/settings/access-menu/user-permissions`;
  const get = async (auth: string, userId = target.id) => originalFetch(`${endpoint}?userId=${userId}`, { headers: { Cookie: auth } });
  const post = async (auth: string, permissions: unknown, userId = target.id) => originalFetch(endpoint, { method: 'POST', headers: { Cookie: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, permissions }) });
  expect((await get('')).status).toBe(401);
  expect((await post('', [])).status).toBe(401);
  for (const auth of [viewer, denied, actors.edit.cookie]) {
    expect((await get(auth)).status).toBe(403);
    expect((await post(auth, [])).status).toBe(403);
  }
  const manager = actors.manager.cookie;
  expect((await get(manager, actors.foreign.id)).status).toBe(404);
  expect((await post(manager, [{ menuId, canView: false, canCreate: false, canEdit: false, canDelete: false }], actors.foreign.id)).status).toBe(404);
  const before = await (await get(manager)).json();
  expect(before.find((p: any) => p.menuId === menuId)).toMatchObject({ canView: false, canCreate: true, canEdit: false, canDelete: false });
  expect((await post(manager, before)).status).toBe(200);
  expect(await (await get(manager)).json()).toEqual(before);
  const changed = before.map((p: any) => p.menuId === menuId ? { ...p, canDelete: true } : p);
  expect((await post(manager, changed)).status).toBe(200);
  expect(await (await get(manager)).json()).toEqual(changed);
  expect((await get(actors.admin.cookie)).status).toBe(200);
  // Undo the single test edit without changing any other flag.
  expect((await post(manager, before)).status).toBe(200);
});

test('own grant metadata exposes independent CREATE to existing Saldo Awal controls without log access', async () => {
  for (const actor of Object.values(actors)) {
    const response = await originalFetch(`${base}/api/settings/access-menu/current-user-menus?grantsFor=/insw/logs`, { headers: { Cookie: actor.cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ canView: actor.view, canCreate: actor.create, canEdit: actor.edit });
  }
});

test('two-company adjustments and parent/item visibility through real HTTP', async () => {
  expect((await (await api(`logs/${stockLog}/check-adjustments`)).json()).hasAdjustments).toBe(false);
  expect((await api(`logs/${stockLog}/check-adjustments`, other)).status).toBe(404);
  const own = await db.adjustments.create({ data: { company_code: 1370, owner: 1370, wms_id: ref, internal_evidence_number: ref, transaction_date: new Date('2026-10-26'), timestamp: new Date() } });
  const item = await db.adjustment_items.create({ data: { adjustment_id: own.id, adjustment_company: 1370, adjustment_date: own.transaction_date,
    adjustment_type: 'GAIN', item_type: 'ROH', item_code: ref, item_name: ref, uom: 'PCS', qty: 1, stockcount_order_number: `${ref}-stock` } });
  expect((await (await api(`logs/${stockLog}/check-adjustments`)).json()).hasAdjustments).toBe(true);
  await db.adjustments.update({ where: { company_code_id_transaction_date: { company_code: 1370, id: own.id, transaction_date: own.transaction_date } }, data: { deleted_at: new Date() } });
  expect((await (await api(`logs/${stockLog}/check-adjustments`)).json()).hasAdjustments).toBe(false);
  await db.adjustments.updateMany({ where: { id: own.id, company_code: 1370 }, data: { deleted_at: null } });
  await db.adjustment_items.update({ where: { id: item.id }, data: { deleted_at: new Date() } });
  expect((await (await api(`logs/${stockLog}/check-adjustments`)).json()).hasAdjustments).toBe(false);
});

test('Excel forwards WMS filter and discloses truncation; null sent_at included', async () => {
  const response = await api(`logs/export?wms_id=${ref}-legacy`);
  expect(response.status).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as any);
  expect(workbook.getWorksheet('INSW Logs')!.rowCount).toBe(2);
  expect(workbook.getWorksheet('INSW Logs')!.getRow(2).getCell(4).value).toBe(`${ref}-legacy`);
  expect(workbook.getWorksheet('Export Info')!.getRow(4).getCell(2).value).toBe('NO');
});

test('Excel remains capped at 10000 rows and explicitly reports truncation', async () => {
  await db.$executeRaw`INSERT INTO insw_tracking_log (transaction_type, company_code, wms_id, insw_status, updated_at)
    SELECT 'incoming', 1370, ${`${ref}-truncate`}, 'FAILED', now() FROM generate_series(1, 10001)`;
  const response = await api(`logs/export?wms_id=${ref}-truncate`);
  expect(response.status).toBe(200);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as any);
  expect(workbook.getWorksheet('INSW Logs')!.rowCount).toBe(10001);
  expect(workbook.getWorksheet('Export Info')!.getRow(2).getCell(2).value).toBe(10001);
  expect(workbook.getWorksheet('Export Info')!.getRow(4).getCell(2).value).toContain('YES');
});

test('concurrent authenticated HTTP RESEND creates one frozen successor and one winner audit', async () => {
  const { q, log } = await recoveryFixture('http-race');
  const responses = await Promise.all([actors.edit, actors.combined].map(actor => api(`logs/${log.id}/resend`, actor.cookie, { method: 'POST' })));
  expect(responses.map(r => r.status).sort()).toEqual([202, 409]);
  const winner = [actors.edit, actors.combined][responses.findIndex(r => r.status === 202)];
  const cycles = await db.insw_queue_cycle.findMany({ where: { identity_key: q.identity_key }, orderBy: { cycle: 'asc' } });
  expect(cycles).toHaveLength(2);
  expect(cycles[1].frozen_payload).toEqual(q.frozen_payload);
  expect(cycles[1].payload_sha256).toBe(q.payload_sha256);
  expect(freezePayload(cycles[1].frozen_payload).sha256).toBe(cycles[1].payload_sha256);
  expect(cycles[1].requested_by).toBe(winner.id);
  expect((await db.insw_tracking_log.findUniqueOrThrow({ where: { id: log.id } })).metadata).toMatchObject({
    manual_resend: { operator: winner.id, queue_id: cycles[1].id },
  });
});

test('concurrent service RESEND creates exactly one frozen successor and audit without transport', async () => {
  await queue('race', 'FAILED', 'KNOWN_FAILURE');
  const q = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: queueIds.race } });
  const source = await db.incoming_goods.create({ data: { company_code: 1370, owner: 1370, wms_id: q.wms_reference!, incoming_date: new Date('2026-10-26'), ppkek_number: 'FIXTURE', incoming_evidence_number: 'FIXTURE', shipper_name: 'Fixture', timestamp: new Date() } });
  const log = await db.insw_tracking_log.findFirstOrThrow({ where: { wms_id: q.wms_reference! } });
  await db.insw_tracking_log.update({ where: { id: log.id }, data: { transaction_id: source.id } });
  expect((await wmsLogResendEligibility(db, 1370, [log.id])).has(log.id.toString())).toBe(true);
  expect((await wmsLogResendEligibility(db, 1380, [log.id])).size).toBe(0);
  const results = await Promise.allSettled([1, 2].map(() => resendWmsLog(db, 1370, log.id, 'fixture-operator', 'disposable race verification')));
  expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  const cycles = await db.insw_queue_cycle.findMany({ where: { identity_key: q.identity_key }, orderBy: { cycle: 'asc' } });
  expect(cycles).toHaveLength(2);
  expect(cycles[1].frozen_payload).toEqual(q.frozen_payload);
  expect(cycles[1].payload_sha256).toBe(q.payload_sha256);
  expect(freezePayload(cycles[1].frozen_payload).sha256).toBe(cycles[1].payload_sha256);
  expect(cycles[1].intent).toBe('MANUAL_RESUBMIT');
  const audit = (await db.insw_tracking_log.findUniqueOrThrow({ where: { id: log.id } })).metadata as any;
  expect(audit.manual_resend.queue_id).toBe(cycles[1].id);
  expect(audit.manual_resend.operator).toBe('fixture-operator');
  expect((await wmsLogResendEligibility(db, 1370, [log.id])).size).toBe(0);
});

test('authenticated browser lifecycle, filtering, denied actions and refresh feedback', async () => {
  let browser;
  try { browser = await chromium.launch({ headless: true }); }
  catch (error) { console.log(`Browser NOT TESTED: ${String(error).split('\n')[0]}`); test.skip(true, `Browser NOT TESTED: ${String(error).split('\n')[0]}`); return; }
  try {
    const context = await browser.newContext();
    const [name, value] = viewer.split('=');
    await context.addCookies([{ name, value, url: base }]);
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await page.goto(`${base}/insw/logs`);
    await expect(page.getByRole('button', { name: 'Kirim Ulang' })).toHaveCount(0);
    const search = page.getByRole('textbox', { name: 'Search WMS ID' });
    for (const [fixture, label] of [
      ['waiting', 'READY — waiting'], ['active', 'CLAIMED — in flight'],
      ['retrying', 'READY — automatic retry pending'], ['terminal', 'FAILED — KNOWN_FAILURE'],
      ['held', 'HELD — investigate (DELIVERY_UNKNOWN)'], ['success', 'SUCCEEDED — KNOWN_SUCCESS'],
      ['legacy', 'Legacy DIRECT / unlinked history'],
    ]) {
      await search.fill(`${ref}-${fixture}`);
      const loaded = page.waitForResponse(r => r.url().includes('/api/insw/logs?') && r.url().includes(`${ref}-${fixture}`));
      await search.press('Enter'); await loaded;
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/insw/logs?**', async route => { await pending; await route.abort(); });
    const refresh = page.getByRole('button', { name: 'Refresh', exact: true });
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(page.getByText('INSW logs refreshed', { exact: true })).toHaveCount(0);
    release();
    await expect(page.getByText('Refresh incomplete; a request failed or was superseded.')).toBeVisible();
    await expect(refresh).toBeEnabled();
    await context.close();

    const editContext = await browser.newContext();
    const [editName, editValue] = operator.split('=');
    await editContext.addCookies([{ name: editName, value: editValue, url: base }]);
    const editPage = await editContext.newPage();
    await editPage.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await editPage.goto(`${base}/insw/logs`);
    await editPage.getByRole('textbox', { name: 'Search WMS ID' }).fill(`${ref}-eligible-ui`);
    await editPage.getByRole('textbox', { name: 'Search WMS ID' }).press('Enter');
    await editPage.getByRole('button', { name: 'Kirim Ulang', exact: true }).click();
    const confirm = editPage.getByRole('dialog', { name: 'Konfirmasi Kirim Ulang' }).getByRole('button', { name: 'Kirim Ulang', exact: true });
    let resendPosts = 0; let releaseResend!: () => void;
    const delayed = new Promise<void>(resolve => { releaseResend = resolve; });
    await editPage.route(`**/api/insw/logs/${browserResendLog}/resend`, async route => { resendPosts++; await delayed; await route.continue(); });
    await confirm.evaluate((element: HTMLElement) => { element.click(); element.click(); });
    await expect.poll(() => resendPosts).toBe(1);
    await expect(editPage.getByRole('button', { name: 'Kirim Ulang', exact: true })).toBeDisabled();
    await expect(editPage.getByText('Frozen WMS delivery cycle accepted in queue; not yet delivered to INSW.')).toHaveCount(0);
    const admitted = editPage.waitForResponse(response => response.url().endsWith(`/logs/${browserResendLog}/resend`));
    releaseResend();
    expect((await admitted).status()).toBe(202);
    await expect(editPage.getByText('Frozen WMS delivery cycle accepted in queue; not yet delivered to INSW.')).toBeVisible();
    expect(resendPosts).toBe(1);
    const original = await db.insw_queue_cycle.findUniqueOrThrow({ where: { id: browserQueueId } });
    expect(await db.insw_queue_cycle.count({ where: { identity_key: original.identity_key } })).toBe(2);
    await editContext.close();

    const managerContext = await browser.newContext();
    const [managerName, managerValue] = actors.manager.cookie.split('=');
    await managerContext.addCookies([{ name: managerName, value: managerValue, url: base }]);
    const managerPage = await managerContext.newPage();
    await managerPage.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await managerPage.goto(`${base}/settings/access-menu?userId=${actors.create.id}&username=${ref}-create`);
    const create = managerPage.getByRole('checkbox', { name: `${ref}-INSW Logs CREATE`, exact: true });
    const edit = managerPage.getByRole('checkbox', { name: `${ref}-INSW Logs EDIT`, exact: true });
    await expect(create).toBeChecked();
    await expect(edit).not.toBeChecked();
    await expect(managerPage.getByRole('checkbox', { name: `${ref}-INSW Logs VIEW`, exact: true })).not.toBeChecked();
    await edit.check();
    await managerPage.getByRole('button', { name: 'Save Permissions', exact: true }).click();
    await expect(managerPage.getByText(`Permissions updated successfully for ${ref}-create!`)).toBeVisible();
    await managerPage.reload();
    await expect(edit).toBeChecked();
    await expect(create).toBeChecked();
    await edit.uncheck();
    await managerPage.getByRole('button', { name: 'Save Permissions', exact: true }).click();
    await expect(managerPage.getByText(`Permissions updated successfully for ${ref}-create!`)).toBeVisible();
    await managerContext.close();
  } finally { await browser.close(); }
});
