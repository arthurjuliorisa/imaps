import { test, expect } from '@playwright/test';
import type { Session } from 'next-auth';
import type { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { intervalSettingsAccess, intervalSettingsRequest } from '../lib/insw-queue/interval-settings-http';
import { parseIntervalUpdate } from '../lib/insw-queue/interval-settings';

const admin = { user: { id: 'test-admin', role: 'ADMIN' }, expires: '' } as Session;
const input = { intervalMs: 3600, expectedVersion: 1, reason: 'Test change' };
const forbiddenDb = new Proxy({}, { get() { throw new Error('Unexpected database access'); } }) as PrismaClient;
const request = (body: unknown = input, headers: Record<string, string> = {}) => new Request('http://localhost/api/insw/queue-settings', {
  method: 'PATCH', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('only canonical ADMIN may view or update, regardless of company or menu grants', async () => {
  expect(intervalSettingsAccess(admin)).toBe(200);
  for (const session of [null, { user: { role: 'ADMIN' } }, ...['USER', 'SUPER_ADMIN', 'SUPERADMIN', 'ADMINISTRATOR'].map(role => ({ user: { id: 'other', role, companyCode: '1370' } }))]) {
    const expected = !session?.user || !('id' in session.user) ? 401 : 403;
    for (const req of [new Request('http://localhost/api/insw/queue-settings'), request()]) {
      expect((await intervalSettingsRequest(req, session as Session | null, forbiddenDb)).status).toBe(expected);
    }
  }
});

test('mutation rejects untrusted/missing origin, cross-site forms and invalid JSON before DB access', async () => {
  const rejectedHeaders: Record<string, string>[] = [{ Origin: '' }, { Origin: 'https://untrusted.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }];
  for (const headers of rejectedHeaders) {
    expect((await intervalSettingsRequest(request(input, headers), admin, forbiddenDb)).status).toBe(403);
  }
  expect((await intervalSettingsRequest(request(input, { 'Content-Type': 'text/plain' }), admin, forbiddenDb)).status).toBe(415);
  const badJson = new Request('http://localhost/api/insw/queue-settings', { method: 'PATCH', headers: { Origin: 'http://localhost', 'Content-Type': 'application/json' }, body: '{' });
  expect((await intervalSettingsRequest(badJson, admin, forbiddenDb)).status).toBe(400);
});

test('interval validates floor, supported maximum, whole finite numeric values and audit/version bounds', () => {
  for (const intervalMs of [3600, 5000, 2147483647]) expect(parseIntervalUpdate({ ...input, intervalMs }).intervalMs).toBe(intervalMs);
  for (const intervalMs of [3599, 0, -1, 3600.5, NaN, Infinity, '3600', null, 2147483648]) {
    expect(() => parseIntervalUpdate({ ...input, intervalMs })).toThrow();
  }
  for (const extra of [{ expectedVersion: 0 }, { expectedVersion: 1.5 }, { expectedVersion: 2147483647 }, { reason: '' }, { reason: ' padded ' }, { reason: 'x'.repeat(501) }]) {
    expect(() => parseIntervalUpdate({ ...input, ...extra })).toThrow();
  }
});

test('crafted unrelated policy, retry, ownership, company and gate fields are rejected at HTTP boundary', async () => {
  for (const field of ['max_auto_retry', 'maxAutoRetry', 'updated_by', 'company_code', 'owner_token', 'gate', 'allowedCompanies']) {
    expect((await intervalSettingsRequest(request({ ...input, [field]: 9 }), admin, forbiddenDb)).status).toBe(400);
  }
  for (const body of [null, [], {}, { ...input, intervalMs: 3599 }]) {
    expect((await intervalSettingsRequest(request(body), admin, forbiddenDb)).status).toBe(400);
  }
});

test('GET projects only interval and latest audit metadata, is bounded and uncached', async () => {
  let reads = 0;
  const db = { insw_transmission_policy: { findUnique: async () => { reads++; return { id: 1, min_processing_interval_ms: 3600, max_auto_retry: 7, version: 3, updated_at: new Date('2026-11-01'), updated_by: 'admin', change_reason: 'test' }; } } } as unknown as PrismaClient;
  const response = await intervalSettingsRequest(new Request('http://localhost/api/insw/queue-settings'), admin, db);
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toEqual({ data: { intervalMs: 3600, version: 3, updatedAt: '2026-11-01T00:00:00.000Z', updatedBy: 'admin', reason: 'test' } });
  expect(reads).toBe(1);
});

test('page and routes wire shared server access, navigation is admin only, UI contains no retry controls', () => {
  const page = readFileSync('app/(authenticated)/insw/queue-settings/page.tsx', 'utf8');
  const route = readFileSync('app/api/insw/queue-settings/route.ts', 'utf8');
  expect(page).toContain('intervalSettingsAccess(await getServerSession(authOptions))');
  expect(route.match(/intervalSettingsRequest\(request, await getServerSession\(authOptions\), prisma\)/g)).toHaveLength(2);
  const ui = readFileSync('app/(authenticated)/insw/queue-settings/QueueSettings.tsx', 'utf8');
  expect(ui).not.toMatch(/retry|max_auto_retry|maxAutoRetry/i);
  const menus = readFileSync('app/api/settings/access-menu/current-user-menus/route.ts', 'utf8');
  expect(menus).toContain("menu.menu_path !== '/insw/queue-settings'");
});
