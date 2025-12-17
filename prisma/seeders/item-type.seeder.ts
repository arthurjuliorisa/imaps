import { PrismaClient, ItemTypeCode } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedItemTypes() {
  console.log('📦 Seeding Item Types...');

  const itemTypes = [
    {
      item_type_code: ItemTypeCode.ROH,
      item_type_name: 'Bahan Baku / Raw Material',
      is_capital_goods: false,
    },
    {
      item_type_code: ItemTypeCode.HALB,
      item_type_name: 'Barang Setengah Jadi / WIP',
      is_capital_goods: false,
    },
    {
      item_type_code: ItemTypeCode.FERT,
      item_type_name: 'Barang Jadi / Finished Goods',
      is_capital_goods: false,
    },
    {
      item_type_code: ItemTypeCode.HIBE,
      item_type_name: 'Barang Modal / Capital Goods (General)',
      is_capital_goods: true,
    },
    {
      item_type_code: ItemTypeCode.HIBE_M,
      item_type_name: 'Mesin / Machinery',
      is_capital_goods: true,
    },
    {
      item_type_code: ItemTypeCode.HIBE_E,
      item_type_name: 'Peralatan / Equipment',
      is_capital_goods: true,
    },
    {
      item_type_code: ItemTypeCode.HIBE_T,
      item_type_name: 'Alat Produksi / Production Tools',
      is_capital_goods: true,
    },
    {
      item_type_code: ItemTypeCode.DIEN,
      item_type_name: 'Jasa / Services',
      is_capital_goods: false,
    },
    {
      item_type_code: ItemTypeCode.SCRAP,
      item_type_name: 'Sisa/Skrap / Scrap',
      is_capital_goods: false,
    },
  ];

  let createdCount = 0;
  for (const itemType of itemTypes) {
    await prisma.item_types.upsert({
      where: { item_type_code: itemType.item_type_code },
      update: {
        item_type_name: itemType.item_type_name,
        is_capital_goods: itemType.is_capital_goods,
      },
      create: itemType,
    });
    console.log(`  ✓ Created/Updated Item Type: ${itemType.item_type_code} - ${itemType.item_type_name}`);
    createdCount++;
  }

  console.log(`Completed: ${createdCount} item types seeded\n`);
}
