import { test, expect } from '@playwright/test';
import { resolveWorkerAllowedCompanies, validateWorkerAllowedCompanies } from '../lib/config/insw-worker-config';
import { main } from '../scripts/insw-worker';
import { runProductionDispatcher } from '../lib/insw-worker/production-dispatcher';
import { admitNext } from '../lib/insw-worker/operational.repository';
import { runIsolatedWorker } from '../lib/insw-worker/isolated-worker';

test('explicit supported subsets normalize and freeze without authorizing any default', () => {
  for (const [raw, expected] of [['1370', [1370]], ['1380', [1380]], [' 1370, 1380 ', [1370, 1380]]] as const) {
    const companies = resolveWorkerAllowedCompanies({ INSW_WORKER_ALLOWED_COMPANIES: raw });
    expect(companies).toEqual(expected);
    expect(Object.isFrozen(companies)).toBe(true);
  }
  for (const raw of [undefined, '', ' ', '1310', '1399', '1370,1310', '1370,', ',1370', '1370,,1380',
    '1370,1370', '1370 1380', '1.37e3', '01370', '1370.0', '[1370]', 'all']) {
    expect(() => resolveWorkerAllowedCompanies({ INSW_WORKER_ALLOWED_COMPANIES: raw })).toThrow('INSW_WORKER_ALLOWED_COMPANIES');
  }
  for (const values of [[], [1310], [1370, 1380, 1399], [1370, 1370], [NaN]]) {
    expect(() => validateWorkerAllowedCompanies(values)).toThrow('INSW_WORKER_ALLOWED_COMPANIES');
  }
});

test('enabled startup rejects missing or invalid authorization before opening any resources', async () => {
  for (const value of [undefined, '', '1310', '1370,1380,1310']) {
    expect(await main({ NODE_ENV: 'production', INSW_WORKER_ENABLED: 'true', DATABASE_URL: 'invalid:',
      INSW_WORKER_ALLOWED_COMPANIES: value })).toBe(78);
  }
  expect(await main({ NODE_ENV: 'test', INSW_WORKER_ALLOWED_COMPANIES: '1370' })).toBe(0);
});

test('dispatcher rejects invalid explicit lists before credentials, DB ownership or transport', async () => {
  for (const allowedCompanies of [[], [1310], [1370, 1310]]) {
    await expect(runProductionDispatcher({ db: null as any, signal: new AbortController().signal,
      allowedCompanies, transport: async () => { throw new Error('UNEXPECTED_TRANSPORT'); } }))
      .rejects.toThrow('INSW_WORKER_ALLOWED_COMPANIES');
  }
});

test('shared engine and admission also fail closed without explicit valid authorization', async () => {
  const prior = process.env.INSW_WORKER_ALLOWED_COMPANIES;
  try {
    for (const value of [undefined, '', '1310']) {
      if (value === undefined) delete process.env.INSW_WORKER_ALLOWED_COMPANIES;
      else process.env.INSW_WORKER_ALLOWED_COMPANIES = value;
      await expect(admitNext(null as any, 'unused')).rejects.toThrow('INSW_WORKER_ALLOWED_COMPANIES');
      await expect(runIsolatedWorker({ db: null as any, signal: new AbortController().signal, timeoutMs: 100,
        request: async () => { throw new Error('UNEXPECTED_TRANSPORT'); } })).rejects.toThrow('INSW_WORKER_ALLOWED_COMPANIES');
      await expect(runProductionDispatcher({ db: null as any, signal: new AbortController().signal }))
        .rejects.toThrow('INSW_WORKER_ALLOWED_COMPANIES');
    }
  } finally {
    if (prior === undefined) delete process.env.INSW_WORKER_ALLOWED_COMPANIES;
    else process.env.INSW_WORKER_ALLOWED_COMPANIES = prior;
  }
});
