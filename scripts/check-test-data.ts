import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Checking test data in database...\n');

  const companyCode = 1310;

  // Check beginning balances
  const beginningBal = await prisma.beginning_balances.count({
    where: { company_code: companyCode }
  });

  // Check incoming goods
  const incoming = await prisma.incoming_goods.count({
    where: { company_code: companyCode }
  });

  // Check outgoing goods
  const outgoing = await prisma.outgoing_goods.count({
    where: { company_code: companyCode }
  });

  // Check material usage
  const materialUsage = await prisma.material_usages.count({
    where: { company_code: companyCode }
  });

  // Check production
  const production = await prisma.production_outputs.count({
    where: { company_code: companyCode }
  });

  // Check WIP
  const wip = await prisma.wip_balances.count({
    where: { company_code: companyCode }
  });

  console.log('📊 Data Count for Company', companyCode);
  console.log('================================');
  console.log('Beginning Balances:', beginningBal);
  console.log('Incoming Goods:', incoming);
  console.log('Outgoing Goods:', outgoing);
  console.log('Material Usage:', materialUsage);
  console.log('Production Output:', production);
  console.log('WIP Balance:', wip);

  if (beginningBal === 0 && incoming === 0 && outgoing === 0) {
    console.log('\n❌ No test data found! Running seeder...');
    // Import and run seeder
    const { seedTestData } = await import('../prisma/seeders/test-data.seeder');
    await seedTestData();
  } else {
    console.log('\n✅ Test data exists!');
  }

  await prisma.$disconnect();
}

main();
