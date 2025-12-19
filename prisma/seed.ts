import { PrismaClient } from '@prisma/client';
import { seedCompanies } from './seeders/company.seeder';
import { seedItemTypes } from './seeders/item-type.seeder';
import { seedItems } from './seeders/item.seeder';
import { seedUsers } from './seeders/user.seeder';
import { seedMenus } from './seeders/menu.seeder';
import { seedTransactions } from './seeders/transaction.seeder';

// NOTE: If you see TypeScript errors below, run `npx prisma generate` first
// This regenerates Prisma Client with updated schema types

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

async function grantDatabasePermissions() {
  console.log('\n🔐 Granting database permissions...');
  try {
    const dbUrl = process.env.DATABASE_URL || '';
    // Extract app user from DATABASE_URL (format: postgresql://user:pass@host:port/db)
    const userMatch = dbUrl.match(/postgresql:\/\/([^:]+):/);
    const appUser = userMatch ? userMatch[1] : 'appuser';

    console.log(`   📋 Target app user: ${appUser}`);

    // Grant EXECUTE on snapshot functions
    console.log('   ✓ Granting EXECUTE on snapshot functions...');
    await prisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION ensure_stock_daily_snapshot_partition(DATE) TO ${appUser}`
    ).catch(() => console.log('     (function may not exist yet, will be created)'));
    
    await prisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION calculate_stock_snapshot(INTEGER, DATE) TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION calculate_stock_snapshot_range(INTEGER, DATE, DATE) TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION queue_snapshot_recalculation(INTEGER, DATE, TEXT, TEXT, TEXT, INTEGER) TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION process_recalc_queue(INTEGER) TO ${appUser}`
    ).catch(() => null);

    // Grant EXECUTE on traceability functions
    console.log('   ✓ Granting EXECUTE on traceability functions...');
    await prisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION populate_work_order_material_consumption(TEXT) TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `GRANT EXECUTE ON FUNCTION populate_work_order_fg_production(TEXT) TO ${appUser}`
    ).catch(() => null);

    // Grant table permissions
    console.log('   ✓ Granting table permissions...');
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON stock_daily_snapshot TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON snapshot_recalc_queue TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON work_order_material_consumption TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON work_order_fg_production TO ${appUser}`
    ).catch(() => null);

    // Grant sequence permissions
    console.log('   ✓ Granting sequence permissions...');
    await prisma.$executeRawUnsafe(
      `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${appUser}`
    ).catch(() => null);

    // Set default privileges
    console.log('   ✓ Setting default privileges for future objects...');
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${appUser}`
    ).catch(() => null);
    
    await prisma.$executeRawUnsafe(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO ${appUser}`
    ).catch(() => null);

    console.log(`✅ Database permissions granted successfully for user '${appUser}'\n`);
  } catch (error: any) {
    const msg = error?.message || '';
    console.warn('⚠️  Permission grant warning:', msg.split('\n')[0]);
    console.warn('    This is usually okay if running as non-superuser.');
    console.warn('    Ask your DBA to run: psql -f scripts/sql/05_permissions.sql\n');
  }
}

async function main() {
  console.log('🌱 Starting database seeding...\n');
  console.log('ℹ️  Note: Seeding all 3 companies, but transactions only for company 1310 (development)\n');

  // Grant permissions first
  await grantDatabasePermissions();

  // Seed in order to respect dependencies
  await seedCompanies();
  await seedItemTypes();
  await seedItems();
  await seedUsers();
  await seedMenus();
  await seedTransactions();

  console.log('🎉 Database seeding completed!');
  console.log('📊 Summary:');
  console.log('   - 3 companies (1370, 1310, 1380)');
  console.log('   - 9 item types');
  console.log('   - 2 items (company 1310 only)');
  console.log('   - 3 users');
  console.log('   - 6 parent menus with children');
  console.log('   - 4 transactions (company 1310 only)');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
