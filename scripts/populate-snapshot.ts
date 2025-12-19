import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('📊 Populating stock daily snapshots for December 2025-2026...\n');

  try {
    // Calculate snapshots for company 1310, December 2025 - December 2026
    const result = await prisma.$executeRawUnsafe(`
      SELECT calculate_stock_snapshot_range(1310, '2025-12-01'::DATE, '2026-12-31'::DATE);
    `);

    console.log('✅ Snapshot calculation completed!');
    console.log('Result:', result);

    // Verify snapshots were created
    const snapshotCount = await prisma.$queryRaw`
      SELECT COUNT(*) as count
      FROM stock_daily_snapshot
      WHERE company_code = 1310
        AND snapshot_date >= '2025-12-01'::DATE
        AND snapshot_date <= '2026-12-31'::DATE;
    `;

    console.log('\n📈 Verification:');
    console.log('Snapshot records created:', snapshotCount);

    // Show sample snapshots
    const samples = await prisma.$queryRaw`
      SELECT snapshot_date, item_code, item_name, item_type,
             opening_balance, incoming_qty, outgoing_qty, closing_balance
      FROM stock_daily_snapshot
      WHERE company_code = 1310
        AND snapshot_date >= '2025-12-01'::DATE
        AND snapshot_date <= '2026-12-31'::DATE
      ORDER BY snapshot_date DESC, item_code
      LIMIT 10;
    `;

    console.log('\n📋 Sample snapshots:');
    console.table(samples);

  } catch (error) {
    console.error('❌ Error populating snapshots:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
