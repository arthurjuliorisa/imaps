import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedItems() {
  console.log('📋 Seeding items...');

  const items = await Promise.all([
    prisma.items.upsert({
      where: { company_code_item_code: { company_code: 1310, item_code: 'RM-1310-001' } },
      update: {},
      create: {
        company_code: 1310,
        item_code: 'RM-1310-001',
        item_name: 'Polyester Yarn 150D White',
        item_type: 'ROH',
        hs_code: '5402.46.00',
        uom: 'KG',
        is_active: true,
      },
    }),
    prisma.items.upsert({
      where: { company_code_item_code: { company_code: 1310, item_code: 'FG-1310-001' } },
      update: {},
      create: {
        company_code: 1310,
        item_code: 'FG-1310-001',
        item_name: 'Finished Fabric Roll Grade A',
        item_type: 'FERT',
        hs_code: '5407.42.00',
        uom: 'ROLL',
        is_active: true,
      },
    }),
  ]);

  console.log(`✅ Created ${items.length} items`);
  return items;
}
