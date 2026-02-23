import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const uomMappings = [
  // Piece / unit
  { wms_uom: 'PCS',     insw_uom: 'PCE', description: 'Piece' },
  { wms_uom: 'PC',      insw_uom: 'PCE', description: 'Piece (short)' },
  { wms_uom: 'UNIT',    insw_uom: 'PCE', description: 'Unit' },
  { wms_uom: 'EA',      insw_uom: 'PCE', description: 'Each' },
  // Pack / packaging
  { wms_uom: 'PACK',    insw_uom: 'PK',  description: 'Pack' },
  { wms_uom: 'PKG',     insw_uom: 'PK',  description: 'Package' },
  { wms_uom: 'PAK',     insw_uom: 'PA',  description: 'Pak' },
  // Weight
  { wms_uom: 'KG',      insw_uom: 'KGM', description: 'Kilogram' },
  { wms_uom: 'KILOGRAM',insw_uom: 'KGM', description: 'Kilogram (full)' },
  { wms_uom: 'GR',      insw_uom: 'GRM', description: 'Gram' },
  { wms_uom: 'GRAM',    insw_uom: 'GRM', description: 'Gram (full)' },
  { wms_uom: 'MG',      insw_uom: 'MGM', description: 'Milligram' },
  { wms_uom: 'TON',     insw_uom: 'TNE', description: 'Tonne' },
  { wms_uom: 'MT',      insw_uom: 'TNE', description: 'Metric Tonne' },
  // Volume
  { wms_uom: 'LT',      insw_uom: 'LTR', description: 'Litre' },
  { wms_uom: 'LITER',   insw_uom: 'LTR', description: 'Liter (US spelling)' },
  { wms_uom: 'LITRE',   insw_uom: 'LTR', description: 'Litre (UK spelling)' },
  // Length / area / volume
  { wms_uom: 'M',       insw_uom: 'MTR', description: 'Metre' },
  { wms_uom: 'METER',   insw_uom: 'MTR', description: 'Meter' },
  { wms_uom: 'METRE',   insw_uom: 'MTR', description: 'Metre (UK spelling)' },
  { wms_uom: 'M2',      insw_uom: 'MTK', description: 'Square Metre' },
  { wms_uom: 'M3',      insw_uom: 'MTQ', description: 'Cubic Metre' },
  // Packaging types
  { wms_uom: 'BOX',     insw_uom: 'BX',  description: 'Box' },
  { wms_uom: 'CTN',     insw_uom: 'CTN', description: 'Carton' },
  { wms_uom: 'CARTON',  insw_uom: 'CTN', description: 'Carton (full)' },
  { wms_uom: 'ROLL',    insw_uom: 'RO',  description: 'Roll' },
  { wms_uom: 'ROL',     insw_uom: 'RO',  description: 'Rol' },
  { wms_uom: 'SET',     insw_uom: 'SET', description: 'Set' },
  { wms_uom: 'BTL',     insw_uom: 'BO',  description: 'Bottle' },
  { wms_uom: 'BOTTLE',  insw_uom: 'BO',  description: 'Bottle (full)' },
  { wms_uom: 'BOTOL',   insw_uom: 'BO',  description: 'Botol (Indonesian)' },
  { wms_uom: 'BAG',     insw_uom: 'BAG', description: 'Bag' },
  { wms_uom: 'DRUM',    insw_uom: 'DRM', description: 'Drum' },
  { wms_uom: 'JAR',     insw_uom: 'JR',  description: 'Jar' },
  { wms_uom: 'BOLT',    insw_uom: 'BT',  description: 'Bolt' },
];

export async function seedINSWUomMapping() {
  console.log('  Seeding INSW UOM Mappings...');

  let upsertCount = 0;
  for (const mapping of uomMappings) {
    await prisma.insw_uom_mapping.upsert({
      where: { wms_uom: mapping.wms_uom },
      update: {
        insw_uom: mapping.insw_uom,
        description: mapping.description,
        is_active: true,
      },
      create: {
        wms_uom: mapping.wms_uom,
        insw_uom: mapping.insw_uom,
        description: mapping.description,
        is_active: true,
      },
    });
    upsertCount++;
  }

  console.log(`  ${upsertCount} INSW UOM mappings seeded`);
}
