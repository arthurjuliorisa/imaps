import { MissingInswUomMappingError } from '../lib/insw-uom-mapping-error';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
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
    '@/lib/insw-uom-mapping-error': { MissingInswUomMappingError },
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

for (const units of [['KG2'], ['KG2', 'BOX2']]) {
  for (const operation of ['incoming', 'outgoing', 'usage', 'output', 'adjustment', 'opname']) {
    test(`UAT3-02: ${operation}, ${units.length} missing units retain typed signal and exact public message`, async () => {
      let mappingReads = 0;
      const items = units.map(unit => ({ unit, uom: unit, doc_date: new Date('2026-11-19'),
        transaction_date: new Date('2026-11-19'), transaction_id: 1, doc_number: 'DOC',
        internal_evidence_number: 'DOC', qty: 1 }));
      const db: any = {
        insw_uom_mapping: { findMany: async () => { mappingReads++; return []; } },
        adjustments: { findFirst: async () => ({ items }) },
        wms_stock_opnames: { findFirst: async () => ({ items }) },
        material_usages: { findMany: async () => [] }, production_outputs: { findMany: async () => [] },
      };
      const service: any = new INSWIntegrationService('', '', true, db);
      service.repository = Object.fromEntries(['getLaporanPemasukanByIds', 'getLaporanPengeluaranByIds',
        'getMaterialUsageByIds', 'getProductionOutputByIds'].map(name => [name, async () => items]));
      const convert = () => operation === 'incoming' ? service.convertPemasukanToINSW(1370, [1])
        : operation === 'outgoing' ? service.convertPengeluaranToINSWByIds(1370, [1])
        : operation === 'usage' ? service.convertMaterialUsageToINSW(1370, [1])
        : operation === 'output' ? service.convertProductionOutputToINSW(1370, [1])
        : operation === 'adjustment' ? service.convertAdjustmentToINSW(1370, 1)
        : service.convertStockOpnameToINSW(1370, 1);
      const response = await route(auth, convert)(request(), params);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ success: false, code: 'MISSING_UOM_MAPPING',
        message: 'Please check INSW UoM Mapping and try again.' });
      expect(mappingReads).toBe(1);
    });
  }
}
test('UAT3-02: unrelated mapping, DB and malformed errors stay generic; explicit refusals preserved', async () => {
  for (const error of [new Error('mapping database failed'), new Error('UOM mapping tidak ditemukan untuk: KG2'),
    new Error('database query failed'), { code: 'MISSING_UOM_MAPPING' }, null]) {
    const response = await route(auth, () => { throw error; })(request(), params);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'REGENERATION_FAILED',
      message: 'Unable to regenerate INSW transmission. Please contact the system administrator.' });
  }
  for (const code of ['INVALID_ORIGIN', 'FORBIDDEN', 'NOT_FOUND', 'SOURCE_CHANGED', 'LOCAL_HISTORY_OR_SOURCE_BLOCK',
    'ADMISSION_DENIED', 'TRANSMISSION_HISTORY_EXISTS', 'ORPHAN_DELIVERY_HISTORY', 'BUSINESS_COMPLETION_REQUIRES_REVIEW']) {
    const response = await route(auth, () => { throw new RegenerationError(code, 'private', 403); })(request(), params);
    expect(response.status).toBe(403);
    expect((await response.json()).message).toBe(regenerationMessage(code));
    expect(regenerationMessage(code)).not.toContain('UoM');
  }
  expect(regenerationMessage('INVALID_ORIGIN')).toBe('Please regenerate this transmission from the application.');
});
