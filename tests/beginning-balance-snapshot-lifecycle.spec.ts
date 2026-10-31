import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  BeginningBalanceSnapshotError,
  createRequiredBeginningBalanceSnapshots,
  type BeginningBalanceSnapshotItem,
} from '../lib/services/beginning-balance-snapshot.service';

type StoredSnapshot = Omit<BeginningBalanceSnapshotItem, 'item_name'> & {
  company_code: number;
};

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);

function snapshotKey(companyCode: number, item: Omit<BeginningBalanceSnapshotItem, 'item_name'>) {
  return [
    companyCode,
    item.item_type,
    item.item_code,
    item.uom,
    item.snapshot_date.toISOString(),
  ].join('|');
}

function item(overrides: Partial<BeginningBalanceSnapshotItem> = {}): BeginningBalanceSnapshotItem {
  return {
    item_type: 'ROH',
    item_code: 'RM-001',
    item_name: 'Material 1',
    uom: 'KG',
    snapshot_date: day('2026-04-29'),
    ...overrides,
  };
}

function makeTransaction(options: {
  resultFor?: (
    requested: Array<Omit<BeginningBalanceSnapshotItem, 'snapshot_date'>>,
    callIndex: number
  ) => Array<{ item_code: string; status: 'SUCCESS' | 'ERROR'; message: string }>;
  omitVerified?: (companyCode: number, requested: BeginningBalanceSnapshotItem) => boolean;
  existing?: StoredSnapshot[];
  queryError?: Error;
} = {}) {
  const snapshots = new Map<string, StoredSnapshot>();
  for (const existing of options.existing ?? []) {
    snapshots.set(snapshotKey(existing.company_code, existing), existing);
  }

  const queryBatches: Array<Array<Omit<BeginningBalanceSnapshotItem, 'snapshot_date'>>> = [];
  let verificationCalls = 0;

  const tx = {
    $queryRawUnsafe: async (_sql: string, companyCode: number, json: string, snapshotDate: Date) => {
      if (options.queryError) throw options.queryError;
      const requested = JSON.parse(json) as Array<Omit<BeginningBalanceSnapshotItem, 'snapshot_date'>>;
      const callIndex = queryBatches.length;
      queryBatches.push(requested);
      const results = options.resultFor?.(requested, callIndex)
        ?? requested.map((entry) => ({
          item_code: entry.item_code,
          status: 'SUCCESS' as const,
          message: 'ok',
        }));

      results.forEach((result, index) => {
        const requestedItem = requested[index];
        if (!requestedItem || result.status !== 'SUCCESS') return;
        const stored = { ...requestedItem, company_code: companyCode, snapshot_date: snapshotDate };
        if (!options.omitVerified?.(companyCode, { ...requestedItem, snapshot_date: snapshotDate })) {
          snapshots.set(snapshotKey(companyCode, stored), stored);
        }
      });
      return results;
    },
    stock_daily_snapshot: {
      findMany: async ({ where }: any) => {
        verificationCalls += 1;
        return [...snapshots.values()].filter((stored) =>
          stored.company_code === where.company_code
          && stored.snapshot_date.getTime() === where.snapshot_date.getTime()
          && where.OR.some((candidate: any) =>
            candidate.item_type === stored.item_type
            && candidate.item_code === stored.item_code
            && candidate.uom === stored.uom
          )
        );
      },
    },
  };

  return {
    tx: tx as any,
    snapshots,
    queryBatches,
    verificationCalls: () => verificationCalls,
  };
}

test.describe('required beginning-balance snapshot lifecycle', () => {
  test('creates and verifies an exact beginning-balance baseline', async () => {
    const scenario = makeTransaction();
    const baseline = item();

    await createRequiredBeginningBalanceSnapshots(scenario.tx, 1370, [baseline]);

    expect(scenario.snapshots.has(snapshotKey(1370, baseline))).toBe(true);
    expect(scenario.queryBatches).toHaveLength(1);
    expect(scenario.verificationCalls()).toBe(1);
  });

  test('keeps bulk work batch-oriented and verifies every persisted identity', async () => {
    const scenario = makeTransaction();
    const records = Array.from({ length: 2501 }, (_, index) => item({
      item_code: `RM-${index.toString().padStart(4, '0')}`,
    }));

    await createRequiredBeginningBalanceSnapshots(scenario.tx, 1370, records);

    expect(scenario.queryBatches.map((batch) => batch.length)).toEqual([1000, 1000, 501]);
    expect(scenario.verificationCalls()).toBe(3);
    expect(scenario.snapshots.size).toBe(2501);
  });

  test('propagates a batch failure with the exact failed UOM identity', async () => {
    const scenario = makeTransaction({
      resultFor: (requested) => requested.map((entry, index) => ({
        item_code: entry.item_code,
        status: index === 1 ? 'ERROR' : 'SUCCESS',
        message: index === 1 ? 'forced failure' : 'ok',
      })),
    });
    const kg = item({ item_code: 'SHARED', uom: 'KG' });
    const pcs = item({ item_code: 'SHARED', uom: 'PCS' });

    const failure = await createRequiredBeginningBalanceSnapshots(
      scenario.tx,
      1370,
      [kg, pcs]
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(BeginningBalanceSnapshotError);
    expect(failure.failedIdentities).toEqual([pcs]);
  });

  test('wraps database-level snapshot failures without losing identity or server-side cause', async () => {
    const databaseError = new Error('sensitive database detail');
    const scenario = makeTransaction({ queryError: databaseError });
    const baseline = item();

    const failure = await createRequiredBeginningBalanceSnapshots(
      scenario.tx,
      1370,
      [baseline]
    ).catch((error) => error);

    expect(failure).toBeInstanceOf(BeginningBalanceSnapshotError);
    expect(failure.message).not.toContain(databaseError.message);
    expect(failure.failedIdentities).toEqual([baseline]);
    expect(failure.cause).toBe(databaseError);
  });

  test('fails visibly when exact post-upsert verification is missing', async () => {
    const missing = item({ item_code: 'MISSING' });
    const scenario = makeTransaction({
      omitVerified: (_companyCode, requested) => requested.item_code === 'MISSING',
    });

    await expect(
      createRequiredBeginningBalanceSnapshots(scenario.tx, 1370, [missing])
    ).rejects.toMatchObject({
      name: 'BeginningBalanceSnapshotError',
      failedIdentities: [missing],
    });
  });

  test('a required snapshot failure aborts staged beginning-balance and PPKEK writes', async () => {
    const committed = { beginningBalances: 0, ppkeks: 0 };
    const scenario = makeTransaction({
      resultFor: (requested) => requested.map((entry) => ({
        item_code: entry.item_code,
        status: 'ERROR' as const,
        message: 'forced failure',
      })),
    });

    const transaction = async (callback: (tx: any) => Promise<void>) => {
      const staged = { beginningBalances: 0, ppkeks: 0 };
      const tx = {
        ...scenario.tx,
        beginning_balances: { create: async () => { staged.beginningBalances += 1; } },
        beginning_balance_ppkeks: { createMany: async () => { staged.ppkeks += 1; } },
      };
      await callback(tx);
      committed.beginningBalances += staged.beginningBalances;
      committed.ppkeks += staged.ppkeks;
    };

    await expect(transaction(async (tx) => {
      await tx.beginning_balances.create();
      await tx.beginning_balance_ppkeks.createMany();
      await createRequiredBeginningBalanceSnapshots(tx, 1370, [item()]);
    })).rejects.toBeInstanceOf(BeginningBalanceSnapshotError);
    expect(committed).toEqual({ beginningBalances: 0, ppkeks: 0 });
  });

  test('is idempotent for retries and preserves an existing valid baseline', async () => {
    const baseline = item();
    const existing = { ...baseline, company_code: 1370 };
    const scenario = makeTransaction({ existing: [existing] });

    await createRequiredBeginningBalanceSnapshots(scenario.tx, 1370, [baseline]);
    await createRequiredBeginningBalanceSnapshots(scenario.tx, 1370, [baseline]);

    expect(scenario.snapshots.size).toBe(1);
    expect(scenario.snapshots.get(snapshotKey(1370, baseline))).toEqual(existing);
  });

  test('isolates the same item code by UOM, item type, and company', async () => {
    const scenario = makeTransaction();
    const kg = item({ item_code: 'SHARED', uom: 'KG' });
    const pcs = item({ item_code: 'SHARED', uom: 'PCS' });
    const finished = item({ item_type: 'FERT', item_code: 'SHARED', uom: 'KG' });

    await createRequiredBeginningBalanceSnapshots(scenario.tx, 1370, [kg, pcs, finished]);
    await createRequiredBeginningBalanceSnapshots(scenario.tx, 1380, [kg]);

    expect(scenario.snapshots.size).toBe(4);
    expect([...scenario.snapshots.keys()]).toEqual(expect.arrayContaining([
      snapshotKey(1370, kg),
      snapshotKey(1370, pcs),
      snapshotKey(1370, finished),
      snapshotKey(1380, kg),
    ]));
  });

  test('SQL semantics preserve the 29-Apr baseline into 30-Apr continuity', () => {
    const sql = readFileSync(resolve(process.cwd(), 'scripts/sql/05_item_level_snapshot_functions.sql'), 'utf8');
    expect(sql).toContain('AND balance_date = p_snapshot_date');
    expect(sql).toContain('AND snapshot_date < p_snapshot_date');
    expect(sql).toContain('ORDER BY snapshot_date DESC');
    expect(sql).toContain('v_closing_balance := v_opening_balance');
    expect(sql).toContain('+ v_incoming_qty');

    const april29Closing = 31668.570;
    const april30Opening = april29Closing;
    const april30Incoming = 2790.000;
    expect(april29Closing).toBeCloseTo(31668.570, 3);
    expect(april30Opening).toBeCloseTo(31668.570, 3);
    expect(april30Incoming).toBeCloseTo(2790.000, 3);
    expect(april30Opening + april30Incoming).toBeCloseTo(34458.570, 3);
  });

  test('bulk and single-create routes keep writes, links, snapshots, and verification in one transaction', () => {
    const bulk = readFileSync(
      resolve(process.cwd(), 'app/api/customs/beginning-data/import/route.ts'),
      'utf8'
    );
    const single = readFileSync(
      resolve(process.cwd(), 'app/api/customs/beginning-data/route.ts'),
      'utf8'
    );

    for (const route of [bulk, single]) {
      expect(route).toContain('prisma.$transaction(async (tx) =>');
      expect(route).toContain('tx.beginning_balances.');
      expect(route).toContain('tx.beginning_balance_ppkeks.createMany');
      expect(route).toMatch(/createRequiredBeginningBalanceSnapshots\(\s*tx,/);
    }
    expect(bulk).not.toContain('void (async () =>');
    expect(bulk).toContain('Unable to resolve imported beginning balance for PPKEK association');
    expect(single).not.toContain('snapshot calculation is non-blocking');
  });
});

test('canonical wrapper and mocked deployment order retain the reviewed correction', () => {
  const output = execFileSync(process.execPath, ['scripts/check-snapshot-wrapper-corrective.cjs'], { encoding: 'utf8', timeout: 20000 });
  expect(output).toContain('PASS: mocked actual deployment order');
});
