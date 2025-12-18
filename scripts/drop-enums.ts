import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function dropEnums() {
  console.log('Dropping existing ENUM types...');

  const enums = [
    'Currency',
    'ItemCategory',
    'TransactionType',
    'UserRole',
    'calculation_method',
    'recalc_status'
  ];

  for (const enumType of enums) {
    try {
      await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "${enumType}" CASCADE;`);
      console.log(`  ✓ Dropped ${enumType}`);
    } catch (error) {
      console.log(`  - ${enumType} doesn't exist (ok)`);
    }
  }

  console.log('ENUM cleanup completed!');
}

dropEnums()
  .catch((e) => {
    console.error('Error dropping ENUMs:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
