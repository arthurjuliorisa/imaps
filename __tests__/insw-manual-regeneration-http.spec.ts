import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { regenerationMessage, REGENERATION_INCONCLUSIVE } from '../lib/insw-regeneration-messages';
import { NextResponse } from 'next/server';
import { RegenerationError, validateRegenerationRequest } from '../lib/insw-queue/manual-regeneration';

function route(auth: unknown, recover: (...args: unknown[]) => unknown) {
  const exports: { POST?: (request: Request, params: unknown) => Promise<Response> } = {};
  const imports: Record<string, unknown> = {
    '@/lib/insw-regeneration-messages': { regenerationMessage },
    'next/server': { NextResponse }, '@/lib/menu-auth': { checkMenuAuth: async () => auth }, '@/lib/prisma': { prisma: {} },
    '@/lib/insw-queue/manual-regeneration': { regenerateWmsInsw: recover, RegenerationError, validateRegenerationRequest },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync('app/api/settings/wms-transmission-logs/[id]/regenerate-insw/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, { exports, require: (name: string) => imports[name], URL, console: { warn() {} } });
  return exports.POST!;
}
const session = { user: { id: 'actor-from-session', role: 'USER', companyCode: 1370 } };
const auth = { authenticated: true, session, grants: { canView: true, canEdit: true } };
const params = { params: Promise.resolve({ id: '123' }) };
function request(body: unknown = { reason: 'Recover missing queue' }, origin = 'https://imaps.invalid') {
  return new Request('https://imaps.invalid/api/settings/wms-transmission-logs/123/regenerate-insw', {
    method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
test('VIEW/authentication, EDIT, origin and crafted authority fields stop before coordinator', async () => {
  let calls = 0;
  const recover = () => { calls++; return {}; };
  for (const status of [401, 403]) expect((await route({ authenticated: false, response: NextResponse.json({}, { status }) }, recover)(request(), params)).status).toBe(status);
  expect((await route({ ...auth, grants: { canView: true, canEdit: false } }, recover)(request(), params)).status).toBe(403);
  expect((await route(auth, recover)(request({}, 'https://evil.invalid'), params)).status).toBe(403);
  for (const field of ['companyCode', 'actor', 'environment', 'sourceId', 'payload', 'revision']) {
    expect((await route(auth, recover)(request({ reason: 'Recover missing queue', [field]: 'crafted' }), params)).status).toBe(400);
  }
  expect(calls).toBe(0);
});
test('only session principal and exact audit ID are passed; result is queue acceptance', async () => {
  const response = await route(auth, (...args) => {
    expect(args[1]).toEqual(session.user); expect(args[2]).toBe(BigInt(123)); expect(args[3]).toEqual({ reason: 'Recover missing queue' });
    return { queue_id: 'synthetic', message: 'queue created, not transmitted' };
  })(request(), params);
  expect(response.status).toBe(202);
});
test('actionable failures retain status and no internal errors leak', async () => {
  for (const status of [403, 404, 409]) {
    const response = await route(auth, () => { throw new RegenerationError('VERIFICATION_INCONCLUSIVE', 'Review required', status); })(request(), params);
    expect(response.status).toBe(status); expect((await response.json()).message).toBe(REGENERATION_INCONCLUSIVE);
  }
  const response = await route(auth, () => { throw new Error('secret-database-detail'); })(request(), params);
  expect(JSON.stringify(await response.json())).not.toContain('secret-database-detail');
});

test('strict reason validation rejects missing, whitespace, bounds, controls and hidden authority before coordinator', async () => {
  let calls = 0;
  const post = route(auth, () => { calls++; return {}; });
  for (const body of [null, [], 'reason', {}, { reason: null }, { reason: 12 }, { reason: '' }, { reason: '   ' },
    { reason: 'x'.repeat(501) }, { reason: 'line\nbreak' }, { reason: 'bad\u007f' }, { review: {} },
    ...['review', 'destination', 'completed', 'sendersDrained', 'workerDestinationVerified'].map(field => ({ reason: 'valid', [field]: true }))]) {
    const response = await post(request(body), params);
    expect(response.status).toBe(400);
    expect(['INVALID_REQUEST', 'INVALID_REASON']).toContain((await response.json()).code);
  }
  const malformed = new Request('https://imaps.invalid/api/test', { method: 'POST', headers: { origin: 'https://imaps.invalid' }, body: '{' });
  expect((await post(malformed, params)).status).toBe(400);
  expect((await route({ ...auth, grants: { canView: false, canEdit: true } }, () => { calls++; })(request(), params)).status).toBe(403);
  const nonJson = new Request('https://imaps.invalid/api/test', { method: 'POST', headers: { origin: 'https://imaps.invalid', 'content-type': 'text/plain' }, body: JSON.stringify({ reason: 'valid' }) });
  expect((await post(nonJson, params)).status).toBe(400);
  expect(calls).toBe(0);
  expect(validateRegenerationRequest({ reason: ' x ' })).toBe('x');
  expect(validateRegenerationRequest({ reason: 'x'.repeat(500) })).toHaveLength(500);
});

test('duplicate codes map to English and hide internal safety detail', async () => {
  for (const code of ['TRANSMISSION_HISTORY_EXISTS']) {
    const response = await route(auth, () => { throw new RegenerationError(code, 'internal details'); })(request(), params);
    const body = await response.json();
    expect(body.code).toBe(code);
    expect(body.message).toBe('This transaction already has local INSW transmission history. Regeneration was cancelled.');
    expect(body.message).not.toContain('internal');
  }
});
