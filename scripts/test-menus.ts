import { PrismaClient } from '@prisma/client';
import { seedTestData, cleanupTestData } from '../prisma/seeders/test-data.seeder';

const prisma = new PrismaClient();

async function main() {
  console.log('🧪 Testing Menu Data Seeder\n');
  console.log('================================\n');

  try {
    // Seed test data
    await seedTestData();

    console.log('\n📋 Verifying seeded data...\n');

    // Verify data counts
    const incoming = await prisma.incoming_goods.count({ where: { company_code: 1310 } });
    const outgoing = await prisma.outgoing_goods.count({ where: { company_code: 1310 } });
    const materialUsage = await prisma.material_usages.count({ where: { company_code: 1310 } });
    const production = await prisma.production_outputs.count({ where: { company_code: 1310 } });
    const wip = await prisma.wip_balances.count({ where: { company_code: 1310 } });
    const beginningBal = await prisma.beginning_balances.count({ where: { company_code: 1310 } });

    console.log('  ✅ Data verification:');
    console.log(`     - Incoming Goods: ${incoming}`);
    console.log(`     - Outgoing Goods: ${outgoing}`);
    console.log(`     - Material Usage: ${materialUsage}`);
    console.log(`     - Production Output: ${production}`);
    console.log(`     - WIP Balance: ${wip}`);
    console.log(`     - Beginning Balances: ${beginningBal}`);

    console.log('\n✅ Test data seeded successfully!');
    console.log('\n🔍 Next steps:');
    console.log('   1. Start dev server: npm run dev');
    console.log('   2. Login as user@harmoni.co.id');
    console.log('   3. Test each menu:');
    console.log('      - Lap. per Dokumen > Pemasukan Barang');
    console.log('      - Lap. per Dokumen > Pengeluaran Barang');
    console.log('      - LPJ Mutasi > Work in Progress');
    console.log('      - LPJ Mutasi > Bahan Baku/Penolong');
    console.log('      - LPJ Mutasi > Hasil Produksi');
    console.log('      - LPJ Mutasi > Barang Scrap/Reject');
    console.log('      - LPJ Mutasi > Barang Modal');
    console.log('\n⚠️  To cleanup test data, run: npm run cleanup:test-data');

  } catch (error) {
    console.error('❌ Error seeding test data:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
