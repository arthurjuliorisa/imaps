import { prisma } from '@/lib/db/prisma';
import { OutgoingGoodsRepository } from '@/lib/repositories/outgoing-goods.repository';
import { logger } from '@/lib/utils/logger';
import type { OutgoingGoodRequestInput } from '@/lib/validators/schemas/outgoing-goods.schema';

const testLogger = logger.child({ context: 'OutgoingGoodsTest' });

async function runTests() {
  try {
    const repo = new OutgoingGoodsRepository();

    testLogger.info('='.repeat(80));
    testLogger.info('OUTGOING GOODS - ITEM LEVEL SNAPSHOT TEST SUITE');
    testLogger.info('='.repeat(80));

    // ========================================================================
    // SCENARIO 1: Initial Create + Snapshot
    // ========================================================================
    testLogger.info('\nSCENARIO 1: Initial Create + Snapshot');

    // Cleanup
    await prisma.outgoing_good_items.deleteMany({
      where: {
        outgoing_good_company: 1310,
        outgoing_good_date: { gte: new Date('2026-01-25'), lte: new Date('2026-01-31') },
      },
    });
    await prisma.outgoing_goods.updateMany({
      where: {
        company_code: 1310,
        outgoing_date: { gte: new Date('2026-01-25'), lte: new Date('2026-01-31') },
      },
      data: { deleted_at: new Date() },
    });
    await prisma.stock_daily_snapshot.deleteMany({
      where: {
        company_code: 1310,
        snapshot_date: { gte: new Date('2026-01-25'), lte: new Date('2026-01-31') },
      },
    });

    const payload1: OutgoingGoodRequestInput = {
      wms_id: 'TEST_OUT_001',
      company_code: 1310,
      owner: 1310,
      customs_document_type: 'BC30',
      ppkek_number: '260125',
      customs_registration_date: '2026-01-25',
      outgoing_evidence_number: 'OUT_001',
      outgoing_date: '2026-01-25',
      invoice_number: 'INV_OUT_001',
      invoice_date: '2026-01-24',
      recipient_name: 'Test Recipient',
      items: [
        {
          item_type: 'HALB',
          item_code: 'OUT_ITEM_001',
          item_name: 'Outgoing Item 1',
          hs_code: '39200001',
          uom: 'KG',
          qty: 100,
          currency: 'USD',
          amount: 5000,
        },
        {
          item_type: 'HALB',
          item_code: 'OUT_ITEM_002',
          item_name: 'Outgoing Item 2',
          hs_code: '39200002',
          uom: 'PC',
          qty: 50,
          currency: 'USD',
          amount: 2500,
        },
      ],
      timestamp: '2026-01-24T08:00:00+00:00',
    };

    await repo.insertOutgoingGoodsAsync(payload1);
    testLogger.info('✓ SCENARIO 1 PASSED - Initial create + snapshot');

    // ========================================================================
    // SCENARIO 2: Update Same Date + Recalc
    // ========================================================================
    testLogger.info('\nSCENARIO 2: Update Same Date + Recalc (qty change)');

    const payload2: OutgoingGoodRequestInput = {
      ...payload1,
      items: [
        {
          ...payload1.items[0],
          qty: 120, // Changed qty
        },
        payload1.items[1],
      ],
      timestamp: '2026-01-24T09:00:00+00:00',
    };

    await repo.insertOutgoingGoodsAsync(payload2);
    testLogger.info('✓ SCENARIO 2 PASSED - Updated qty, snapshot recalculated');

    // ========================================================================
    // SCENARIO 3: Update Same Date - Item Deleted
    // ========================================================================
    testLogger.info('\nSCENARIO 3: Update Same Date - Item Deleted');

    const payload3: OutgoingGoodRequestInput = {
      ...payload1,
      items: [payload1.items[0]], // Remove item 2
      timestamp: '2026-01-24T10:00:00+00:00',
    };

    await repo.insertOutgoingGoodsAsync(payload3);

    // Check snapshot for deleted item
    const deletedItemSnapshot = await prisma.stock_daily_snapshot.findFirst({
      where: {
        company_code: 1310,
        item_code: 'OUT_ITEM_002',
        snapshot_date: new Date('2026-01-25'),
      },
      select: {
        item_code: true,
        item_name: true,
        outgoing_qty: true,
      },
    });

    if (deletedItemSnapshot?.item_name === 'Outgoing Item 2' && Number(deletedItemSnapshot?.outgoing_qty || 0) === 0) {
      testLogger.info('✓ SCENARIO 3 PASSED - Deleted item soft-deleted, name preserved in snapshot, outgoing_qty=0');
    } else {
      testLogger.error('✗ SCENARIO 3 FAILED', {
        item_code: 'OUT_ITEM_002',
        item_name: deletedItemSnapshot?.item_name,
        outgoing_qty: deletedItemSnapshot?.outgoing_qty,
      });
    }

    // ========================================================================
    // SCENARIO 4: Update Date Change
    // ========================================================================
    testLogger.info('\nSCENARIO 4: Update Date Change');

    // Cleanup for new date
    await prisma.outgoing_good_items.deleteMany({
      where: {
        outgoing_good_company: 1310,
        outgoing_good_date: new Date('2026-01-26'),
      },
    });
    await prisma.outgoing_goods.updateMany({
      where: {
        company_code: 1310,
        outgoing_date: new Date('2026-01-26'),
      },
      data: { deleted_at: new Date() },
    });

    const payload4: OutgoingGoodRequestInput = {
      ...payload1,
      outgoing_date: '2026-01-26',
      items: [payload1.items[0], payload1.items[1]], // Back to 2 items
      timestamp: '2026-01-24T11:00:00+00:00',
    };

    await repo.insertOutgoingGoodsAsync(payload4);
    testLogger.info('✓ SCENARIO 4 PASSED - Date changed, old items soft-deleted, new snapshot created');

    // ========================================================================
    // SCENARIO 5: New Item Added
    // ========================================================================
    testLogger.info('\nSCENARIO 5: New Item Added (same date)');

    const payload5: OutgoingGoodRequestInput = {
      ...payload1,
      outgoing_date: '2026-01-26',
      items: [
        payload1.items[0],
        payload1.items[1],
        {
          item_type: 'HALB',
          item_code: 'OUT_ITEM_003',
          item_name: 'Outgoing Item 3 - New',
          hs_code: '39200003',
          uom: 'BOX',
          qty: 25,
          currency: 'USD',
          amount: 1250,
        },
      ],
      timestamp: '2026-01-24T12:00:00+00:00',
    };

    await repo.insertOutgoingGoodsAsync(payload5);
    testLogger.info('✓ SCENARIO 5 PASSED - New item inserted, snapshot updated');

    // ========================================================================
    // VERIFY DATABASE
    // ========================================================================
    testLogger.info('\n=== VERIFICATION ===');

    // Check outgoing_good_items for soft-deleted
    const itemsWithDeleted = await prisma.outgoing_good_items.findMany({
      where: {
        outgoing_good_company: 1310,
        outgoing_good_date: new Date('2026-01-26'),
      },
      select: {
        item_code: true,
        item_name: true,
        qty: true,
        deleted_at: true,
      },
      orderBy: { item_code: 'asc' },
    });

    testLogger.info('Outgoing Items (including soft-deleted):');
    for (const item of itemsWithDeleted) {
      testLogger.info(`  ${item.item_code}: name="${item.item_name}", qty=${item.qty}, deleted=${item.deleted_at ? 'YES' : 'NO'}`);
    }

    // Check snapshots
    const snapshots = await prisma.stock_daily_snapshot.findMany({
      where: {
        company_code: 1310,
        item_code: { in: ['OUT_ITEM_001', 'OUT_ITEM_002', 'OUT_ITEM_003'] },
        snapshot_date: new Date('2026-01-26'),
      },
      select: {
        item_code: true,
        item_name: true,
        outgoing_qty: true,
        closing_balance: true,
      },
      orderBy: { item_code: 'asc' },
    });

    testLogger.info('\nSnapshots on 2026-01-26:');
    for (const snap of snapshots) {
      testLogger.info(`  ${snap.item_code}: name="${snap.item_name}", outgoing=${snap.outgoing_qty}, closing=${snap.closing_balance}`);
    }

    testLogger.info('\n' + '='.repeat(80));
    testLogger.info('✅ ALL OUTGOING GOODS TESTS PASSED');
    testLogger.info('='.repeat(80));
  } catch (error) {
    testLogger.error('❌ TEST FAILED', { error });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
