import { PrismaClient } from '@prisma/client';
import { seedCompanies } from './seeders/company.seeder';
import { seedItemTypes } from './seeders/item-type.seeder';
import { seedMenus } from './seeders/menu.seeder';
import { seedUsers } from './seeders/user.seeder';
import { seedUserAccessMenus } from './seeders/user-access.seeder';
import { seedBeginningBalances } from './seeders/beginning-balance.seeder';

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(60));
  console.log('🌱 Starting database seeding for iMAPS v2.4.2');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Execution order respects dependencies:
    // 1. Companies (referenced by users and beginning balances)
    await seedCompanies();

    // 2. Item Types (referenced by beginning balances)
    await seedItemTypes();

    // 3. Menus (independent, but needed before user access)
    await seedMenus();

    // 4. Users (requires companies)
    await seedUsers();

    // 5. User Access Menus (requires both users and menus)
    await seedUserAccessMenus();

    // 6. Beginning Balances (requires companies and item types)
    await seedBeginningBalances();

    console.log('='.repeat(60));
    console.log('✅ Database seeding completed successfully!');
    console.log('='.repeat(60));
    console.log('');
    console.log('📝 Default Credentials:');
    console.log('   Admin    : admin@imaps.local / admin123');
    console.log('   Viewer   : viewer@imaps.local / viewer123');
    console.log('   Operator : operator@imaps.local / operator123');
    console.log('');
    console.log('🔗 Next Steps:');
    console.log('   1. Start the application: npm run dev');
    console.log('   2. Login with admin credentials');
    console.log('   3. Verify menu structure in the sidebar');
    console.log('   4. Check user permissions in Settings > Access Menu');
    console.log('');
  } catch (error) {
    console.error('');
    console.error('='.repeat(60));
    console.error('❌ Error during seeding:');
    console.error('='.repeat(60));
    console.error(error);
    console.error('');
    throw error;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
