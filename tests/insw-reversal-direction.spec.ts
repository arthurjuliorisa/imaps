import { test, expect } from '@playwright/test';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { INSWIntegrationRepository } from '../lib/repositories/insw-integration.repository';
import { INSWIntegrationService } from '../lib/services/insw-integration.service';
import { INSWTransmissionService } from '../lib/services/insw-transmission.service';

const COMPANY = 1370;
type Kind = 'material_usage' | 'production_output';
type Row = Record<string, unknown>;

function row(id: number, reversal: string | null): Row {
  return {
    transaction_id: id,
    wms_id: `WMS-${id}`,
    reversal,
    company_code: COMPANY,
    company_name: 'Test Company',
    transaction_date: new Date('2026-07-10T00:00:00.000Z'),
    internal_evidence_number: `EVIDENCE-${id}`,
    item_type: 'ROH',
    item_code: `ITEM-${id}`,
    item_name: `Item ${id}`,
    uom: 'PCS',
    qty: new Prisma.Decimal(100),
    amount: new Prisma.Decimal(50),
  };
}

async function withMocks<T>(kind: Kind, rows: Row[], run: (state: {
  posts: Array<{ method: string; payload: any }>;
  logs: any[];
  queries: string[];
}) => Promise<T>): Promise<T> {
  const db = prisma as any;
  const originalQuery = db.$queryRawUnsafe;
  const originalMaterial = db.material_usages.findMany;
  const originalProduction = db.production_outputs.findMany;
  const originalLog = db.insw_tracking_log.create;
  const prototype = INSWIntegrationService.prototype as any;
  const originalUom = prototype.loadUomMappings;
  const originalIncoming = prototype.postPemasukan;
  const originalOutgoing = prototype.postPengeluaran;
  const envKeys = ['INSW_1370_USE_TEST_MODE', 'INSW_1370_API_KEY', 'INSW_1370_UNIQUE_KEY_TEST'];
  const env = envKeys.map((key) => process.env[key]);
  const posts: Array<{ method: string; payload: any }> = [];
  const logs: any[] = [];
  const queries: string[] = [];

  try {
    process.env.INSW_1370_USE_TEST_MODE = 'true';
    process.env.INSW_1370_API_KEY = 'test-key';
    process.env.INSW_1370_UNIQUE_KEY_TEST = 'test-unique';
    db.$queryRawUnsafe = async (query: string) => {
      queries.push(query);
      return rows;
    };
    const headers = rows.map((item) => ({ id: item.transaction_id, wms_id: item.wms_id }));
    db.material_usages.findMany = async () => headers;
    db.production_outputs.findMany = async () => headers;
    db.insw_tracking_log.create = async ({ data }: any) => { logs.push(data); return data; };
    prototype.loadUomMappings = async () => new Map([['PCS', 'PCE']]);
    prototype.postPemasukan = async (payload: any) => {
      posts.push({ method: 'postPemasukan', payload });
      return { status: true, message: 'OK', code: '200', data: [] };
    };
    prototype.postPengeluaran = async (payload: any) => {
      posts.push({ method: 'postPengeluaran', payload });
      return { status: true, message: 'OK', code: '200', data: [] };
    };
    return await run({ posts, logs, queries });
  } finally {
    db.$queryRawUnsafe = originalQuery;
    db.material_usages.findMany = originalMaterial;
    db.production_outputs.findMany = originalProduction;
    db.insw_tracking_log.create = originalLog;
    prototype.loadUomMappings = originalUom;
    prototype.postPemasukan = originalIncoming;
    prototype.postPengeluaran = originalOutgoing;
    envKeys.forEach((key, index) => {
      if (env[index] === undefined) delete process.env[key];
      else process.env[key] = env[index];
    });
  }
}

test('INSW repository selects persisted reversal in both existing joined reads', async () => {
  for (const kind of ['material_usage', 'production_output'] as const) {
    await withMocks(kind, [row(1, 'Y')], async ({ queries }) => {
      const repository = new INSWIntegrationRepository();
      const result = kind === 'material_usage'
        ? await repository.getMaterialUsageByIds(COMPANY, [1])
        : await repository.getProductionOutputByIds(COMPANY, [1]);
      expect(result[0].reversal).toBe('Y');
      expect(queries).toHaveLength(1);
      expect(queries[0]).toContain(kind === 'material_usage' ? 'mu.reversal' : 'po.reversal');
      expect(queries[0]).toContain('company_code = $1');
    });
  }
});

test('INSW converters retain document number and positive quantity for all four directions', async () => {
  for (const kind of ['material_usage', 'production_output'] as const) {
    for (const reversal of [null, 'Y']) {
      await withMocks(kind, [row(1, reversal)], async () => {
        const service = new INSWIntegrationService('', '');
        const payload = kind === 'material_usage'
          ? await service.convertMaterialUsageToINSW(COMPANY, [1])
          : await service.convertProductionOutputToINSW(COMPANY, [1]);
        const expected = kind === 'material_usage'
          ? (reversal === 'Y' ? '30' : '31')
          : (reversal === 'Y' ? '31' : '30');
        expect(payload.data).toHaveLength(1);
        expect(payload.data[0].kdKegiatan).toBe(expected);
        expect(payload.data[0].dokumenKegiatan[0].nomorDokKegiatan).toBe('WMS-1');
        expect(payload.data[0].dokumenKegiatan[0].barangTransaksi[0].jumlah).toBe(100);
      });
    }
  }
});

test('mixed Material Usage and Production Output batches route once per activity and log each ID with its own payload', async () => {
  for (const kind of ['material_usage', 'production_output'] as const) {
    await withMocks(kind, [row(1, null), row(2, 'Y'), row(3, null)], async ({ posts, logs, queries }) => {
      const service = new INSWTransmissionService();
      const response = kind === 'material_usage'
        ? await service.transmitMaterialUsage(COMPANY, [1, 2, 3], ['WMS-1', 'WMS-2', 'WMS-3'], true)
        : await service.transmitProductionOutput(COMPANY, [1, 2, 3], ['WMS-1', 'WMS-2', 'WMS-3'], true);
      const normal = kind === 'material_usage' ? '31' : '30';
      const reversed = kind === 'material_usage' ? '30' : '31';
      expect(response.success_count).toBe(3);
      expect(response.failed_count).toBe(0);
      expect(queries).toHaveLength(1);
      expect(posts).toHaveLength(2);
      expect(posts.map((post) => post.payload.data[0].kdKegiatan)).toEqual([normal, reversed]);
      expect(posts.map((post) => post.method)).toEqual(
        kind === 'material_usage'
          ? ['postPengeluaran', 'postPemasukan']
          : ['postPemasukan', 'postPengeluaran']
      );
      const sent = posts.flatMap((post) => post.payload.data[0].dokumenKegiatan.map(
        (doc: any) => doc.nomorDokKegiatan
      ));
      expect(sent.sort()).toEqual(['WMS-1', 'WMS-2', 'WMS-3']);
      expect(logs).toHaveLength(3);
      for (const log of logs) {
        const expected = log.transaction_id === 2 ? reversed : normal;
        expect(log.insw_activity_code).toBe(expected);
        expect(log.insw_request_payload.data[0].kdKegiatan).toBe(expected);
      }
    });
  }
});

test('disabled Material Usage logs pending with generated activity for normal and reversal IDs', async () => {
  await withMocks('material_usage', [row(1, null), row(2, 'Y')], async ({ logs, posts }) => {
    const service = new INSWTransmissionService() as any;
    service.isEndpointEnabled = async () => false;
    const response = await service.transmitMaterialUsage(COMPANY, [1, 2], ['WMS-1', 'WMS-2']);
    expect(response.skipped_count).toBe(2);
    expect(posts).toHaveLength(0);
    expect(logs.map((log) => log.insw_activity_code)).toEqual(['31', '30']);
    expect(logs.every((log) => log.insw_activity_code === log.insw_request_payload.data[0].kdKegiatan)).toBe(true);
  });
});

test('validation and posting failures log the generated reversal activity', async () => {
  await withMocks('production_output', [{ ...row(2, 'Y'), item_code: '' }], async ({ logs, posts }) => {
    const response = await new INSWTransmissionService()
      .transmitProductionOutput(COMPANY, [2], ['WMS-2'], true);
    expect(response.failed_count).toBe(1);
    expect(posts).toHaveLength(0);
    expect(logs[0].insw_activity_code).toBe('31');
    expect(logs[0].insw_request_payload.data[0].kdKegiatan).toBe('31');
  });

  await withMocks('material_usage', [row(2, 'Y')], async ({ logs }) => {
    const prototype = INSWIntegrationService.prototype as any;
    prototype.postPemasukan = async () => ({ status: false, message: 'INSW rejected' });
    const response = await new INSWTransmissionService()
      .transmitMaterialUsage(COMPANY, [2], ['WMS-2'], true);
    expect(response.failed_count).toBe(1);
    expect(logs[0].insw_activity_code).toBe('30');
    expect(logs[0].insw_request_payload.data[0].kdKegiatan).toBe('30');
  });
});
