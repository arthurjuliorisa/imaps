import { PrismaClient } from '@prisma/client';
import { seedMenus } from '../prisma/seeders/menu.seeder';

const prisma = new PrismaClient();

async function main() {
  console.log('🗂️  Running menu seeder only...\n');
  await seedMenus();
  console.log('\n✅ Menu seeding completed!');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
