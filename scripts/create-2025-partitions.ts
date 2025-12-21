import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function createPartitions() {
  console.log('Creating 2025 Q4 partitions for company 1310...');

  try {
    // Create incoming_goods partition
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS incoming_goods_1310_2025_q4 PARTITION OF incoming_goods_1310
      FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
    `);
    console.log('✓ incoming_goods_1310_2025_q4 created');

    // Create outgoing_goods partition
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS outgoing_goods_1310_2025_q4 PARTITION OF outgoing_goods_1310
      FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
    `);
    console.log('✓ outgoing_goods_1310_2025_q4 created');

    // Create production_outputs partition
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS production_outputs_1310_2025_q4 PARTITION OF production_outputs_1310
      FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
    `);
    console.log('✓ production_outputs_1310_2025_q4 created');

    // Create wip_balances partition
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS wip_balances_1310_2025_q4 PARTITION OF wip_balances_1310
      FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
    `);
    console.log('✓ wip_balances_1310_2025_q4 created');

    // Create adjustments partition
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS adjustments_1310_2025_q4 PARTITION OF adjustments_1310
      FOR VALUES FROM ('2025-10-01') TO ('2026-01-01');
    `);
    console.log('✓ adjustments_1310_2025_q4 created');

    console.log('\n✅ All 2025 Q4 partitions created successfully!');
  } catch (error) {
    console.error('Error creating partitions:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

createPartitions()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
