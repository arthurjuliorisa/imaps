import { PrismaClient } from '@prisma/client';
import { cleanupTestData } from '../prisma/seeders/test-data.seeder';

const prisma = new PrismaClient();

async function main() {
  console.log('🗑️  Cleaning up test data...\n');

  try {
    await cleanupTestData();
    console.log('\n✅ Test data cleaned up successfully!');
  } catch (error) {
    console.error('❌ Error cleaning up test data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
