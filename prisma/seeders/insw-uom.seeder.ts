import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

export async function seedINSWUOM() {
  console.log('📦 Seeding INSW UOM Reference...');
  console.log('  Current directory:', process.cwd());

  try {
    // Delete existing data
    console.log('  Deleting existing INSW UOM data...');
    const deletedCount = await prisma.insw_uom_reference.deleteMany({});
    console.log(`  ✓ Deleted ${deletedCount.count} existing records`);

    // Read UOM data
    const dataPath = join(process.cwd(), 'prisma', 'seeders', 'data', 'insw-uom-data.json');
    const uomData = JSON.parse(readFileSync(dataPath, 'utf-8'));

    console.log(`  Inserting ${uomData.length} UOM records...`);

    // Insert in batches to improve performance
    const batchSize = 100;
    let inserted = 0;

    for (let i = 0; i < uomData.length; i += batchSize) {
      const batch = uomData.slice(i, i + batchSize);

      await prisma.insw_uom_reference.createMany({
        data: batch.map((item: any) => ({
          kode: item.kode,
          uraian: item.uraian,
          is_active: true,
        })),
        skipDuplicates: true,
      });

      inserted += batch.length;
      process.stdout.write(`\r  Progress: ${inserted}/${uomData.length}`);
    }

    console.log(`\n  ✓ Inserted ${inserted} UOM records`);
    console.log('✅ INSW UOM Reference seeding completed\n');
  } catch (error) {
    console.error('❌ Error seeding INSW UOM:', error);
    throw error;
  }
}

// Run if executed directly
if (require.main === module) {
  seedINSWUOM()
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
