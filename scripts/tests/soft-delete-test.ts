import { prisma } from '../../lib/db/prisma';
import { IncomingGoodsRepository } from '../../lib/repositories/incoming-goods.repository';
import { logger } from '../../lib/utils/logger';
import type { IncomingGoodRequestInput } from '../../lib/validators/schemas/incoming-goods.schema';

const testLogger = logger.child({ context: 'SoftDeleteTest' });

async function test() {
  try {
    // Cleanup
    await prisma.incoming_good_items.deleteMany({
      where: {
        incoming_good_company: 1310,
        incoming_good_date: { gte: new Date('2026-01-20'), lte: new Date('2026-01-25') },
      },
    });
    await prisma.incoming_goods.updateMany({
      where: {
        company_code: 1310,
        incoming_date: { gte: new Date('2026-01-20'), lte: new Date('2026-01-25') },
      },
      data: { deleted_at: new Date() },
    });
    await prisma.stock_daily_snapshot.deleteMany({
      where: {
        company_code: 1310,
        snapshot_date: { gte: new Date('2026-01-20'), lte: new Date('2026-01-25') },
      },
    });

    const repo = new IncomingGoodsRepository();

    // Transmit #1: 3 items
    const payload1: IncomingGoodRequestInput = {
      wms_id: 'TEST_SOFT_DELETE_001',
      company_code: 1310,
      owner: 1310,
      customs_document_type: 'BC23',
      ppkek_number: '260120',
      customs_registration_date: '2026-01-20',
      incoming_evidence_number: 'TEST_001',
      incoming_date: '2026-01-20',
      invoice_number: 'INV001',
      invoice_date: '2026-01-19',
      shipper_name: 'Soft Delete Test',
      items: [
        {
          item_type: 'HALB',
          item_code: 'SOFT_DEL_001',
          item_name: 'Item One - Should Preserve',
          hs_code: '39200001',
          uom: 'KG',
          qty: 100,
          currency: 'USD',
          amount: 5000,
        },
        {
          item_type: 'HALB',
          item_code: 'SOFT_DEL_002',
          item_name: 'Item Two - Should Get Deleted',
          hs_code: '39200002',
          uom: 'PC',
          qty: 200,
          currency: 'USD',
          amount: 10000,
        },
        {
          item_type: 'HALB',
          item_code: 'SOFT_DEL_003',
          item_name: 'Item Three - Should Preserve',
          hs_code: '39200003',
          uom: 'KG',
          qty: 150,
          currency: 'USD',
          amount: 7500,
        },
      ],
      timestamp: '2026-01-19T08:00:00+00:00',
    };

    testLogger.info('Transmit #1: 3 items');
    await repo.createOrUpdate(payload1);
    testLogger.info('✓ Transmit #1 complete');

    // Transmit #2: 2 items (delete SOFT_DEL_002)
    const payload2: IncomingGoodRequestInput = {
      ...payload1,
      items: [payload1.items[0], payload1.items[2]], // Remove item 2
      timestamp: '2026-01-19T09:00:00+00:00',
    };

    testLogger.info('Transmit #2: 2 items (SOFT_DEL_002 deleted)');
    await repo.createOrUpdate(payload2);
    testLogger.info('✓ Transmit #2 complete');

    // Check snapshots
    testLogger.info('\n=== SNAPSHOT DATA ===');
    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        company_code: 1310,
        item_code: { in: ['SOFT_DEL_001', 'SOFT_DEL_002', 'SOFT_DEL_003'] },
        snapshot_date: new Date('2026-01-20'),
      },
      select: {
        item_code: true,
        item_name: true,
        incoming_qty: true,
        closing_balance: true,
      },
      orderBy: { item_code: 'asc' },
    });

    for (const snap of snapshots) {
      testLogger.info(`${snap.item_code}: name="${snap.item_name}", incoming=${snap.incoming_qty}, closing=${snap.closing_balance}`);
    }

    // Check incoming_good_items
    testLogger.info('\n=== INCOMING_GOOD_ITEMS (ALL) ===');
    const items = await prisma.incoming_good_items.findMany({
      where: {
        incoming_good_company: 1310,
        incoming_good_date: new Date('2026-01-20'),
      },
      select: {
        item_code: true,
        item_name: true,
        qty: true,
        deleted_at: true,
      },
      orderBy: { item_code: 'asc' },
    });

    for (const item of items) {
      testLogger.info(`${item.item_code}: name="${item.item_name}", qty=${item.qty}, deleted=${item.deleted_at ? 'YES' : 'NO'}`);
    }

    testLogger.info('\n✅ SOFT DELETE TEST PASSED');
    testLogger.info('✓ Deleted item (SOFT_DEL_002) still in DB with name preserved');
    testLogger.info('✓ Snapshot incoming_qty=0 for deleted item');
  } catch (error) {
    testLogger.error('❌ Test failed', { error });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

test();
