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
  console.log('\n🔐 Verifying database permissions...');
  try {
    const dbUrl = process.env.DATABASE_URL || '';
    // Extract app user from DATABASE_URL (format: postgresql://user:pass@host:port/db)
    const userMatch = dbUrl.match(/postgresql:\/\/([^:]+):/);
    const appUser = userMatch ? userMatch[1] : 'appuser';

    // Verify permissions on stock_daily_snapshot table
    const checkPerms = await prisma.$queryRawUnsafe<Array<{tableowner: string}>>(`
      SELECT tableowner FROM pg_tables 
      WHERE tablename = 'stock_daily_snapshot' AND schemaname = 'public'
    `);
    
    if (checkPerms.length > 0) {
      const owner = checkPerms[0].tableowner;
      if (owner !== appUser) {
        console.warn(`⚠️  Table owner is '${owner}', but app user is '${appUser}'`);
        console.warn('    This will cause "must be owner of table" errors.');
        console.warn('    Run database initialization script with superuser:');
        console.warn('    psql -f scripts/sql/00_init_database.sql');
      } else {
        console.log(`✅ Table owner verified: ${owner}`);
      }
    }
  } catch (error: any) {
    const msg = error?.message || '';
    if (!msg.includes('does not exist')) {
      console.warn('⚠️  Permission check warning:', msg.split('\n')[0]);
    }
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
