import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedItemTypes() {
  console.log('🏷️  Seeding item types...');

  const itemTypes = await Promise.all([
    prisma.item_types.upsert({
      where: { item_type_code: 'ROH' },
      update: {},
      create: {
        item_type_code: 'ROH',
        name_en: 'Raw Materials',
        name_de: 'Rohstoffe',
        name_id: 'Bahan Baku',
        category: 'MATERIAL',
        description: 'Raw materials directly consumed in production',
        sort_order: 1,
      },
    }),
    prisma.item_types.upsert({
      where: { item_type_code: 'HALB' },
      update: {},
      create: {
        item_type_code: 'HALB',
        name_en: 'Semifinished Goods',
        name_de: 'Halbfabrikat',
        name_id: 'Barang Setengah Jadi',
        category: 'MATERIAL',
        description: 'Work-in-progress and semifinished goods',
        sort_order: 2,
      },
    }),
    prisma.item_types.upsert({
      where: { item_type_code: 'FERT' },
      update: {},
      create: {
        item_type_code: 'FERT',
        name_en: 'Finished Goods',
        name_de: 'Fertigerzeugnisse',
        name_id: 'Barang Jadi',
        category: 'MATERIAL',
        description: 'Completed products ready for sale',
        sort_order: 3,
      },
    }),
    prisma.item_types.upsert({
      where: { item_type_code: 'HIBE' },
      update: {},
      create: {
        item_type_code: 'HIBE',
        name_en: 'Operating Supplies',
        name_de: 'Hilfsbetriebsstoffe',
        name_id: 'Bahan Penolong',
        category: 'MATERIAL',
        description: 'General operating supplies for production support',
        sort_order: 4,
      },
    }),
    prisma.item_types.upsert({
      where: { item_type_code: 'HIBE-M' },
      update: {},
      create: {
        item_type_code: 'HIBE-M',
        name_en: 'Capital Goods - Machine',
        name_de: 'Hilfsbetriebsstoffe - Mesin',
        name_id: 'Barang Modal - Mesin',
        category: 'CAPITAL_GOODS',
        description: 'Machinery and production equipment',
        sort_order: 5,
      },
    }),
    prisma.item_types.upsert({
      where: { item_type_code: 'HIBE-E' },
      update: {},
      create: {
        item_type_code: 'HIBE-E',
        name_en: 'Capital Goods - Engineering',
        name_de: 'Hilfsbetriebsstoffe - Teknik',
        name_id: 'Barang Modal - Teknik',
        category: 'CAPITAL_GOODS',
        description: 'Engineering equipment and tools',
        sort_order: 6,
      },
    }),
    prisma.item_types.upsert({
      where: { item_type_code: 'HIBE-T' },
      update: {},
      create: {
        item_type_code: 'HIBE-T',
        name_en: 'Capital Goods - Tools',
        name_de: 'Hilfsbetriebsstoffe - Alat',
        name_id: 'Barang Modal - Alat',
        category: 'CAPITAL_GOODS',
        description: 'Tools and instruments',
        sort_order: 7,
      },
    }),
    prisma.item_types.upsert({
      where: { item_type_code: 'DIEN' },
      update: {},
      create: {
        item_type_code: 'DIEN',
        name_en: 'Services',
        name_de: 'Dienstleistungen',
        name_id: 'Jasa',
        category: 'SERVICES',
        description: 'Service items',
        sort_order: 8,
      },
    }),
    prisma.item_types.upsert({
      where: { item_type_code: 'SCRAP' },
      update: {},
      create: {
        item_type_code: 'SCRAP',
        name_en: 'Scrap and Waste',
        name_de: 'Schrott',
        name_id: 'Limbah',
        category: 'WASTE',
        description: 'Production waste and rejected materials',
        sort_order: 9,
      },
    }),
  ]);

  console.log(`✅ Created ${itemTypes.length} item types`);
  return itemTypes;
}
