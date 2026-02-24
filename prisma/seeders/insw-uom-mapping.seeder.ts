import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const uomMappings = [
  // Packaging
  { wms_uom: 'BAG',  insw_uom: 'BG',  description: 'Bag' },
  { wms_uom: 'BT',   insw_uom: 'BO',  description: 'Bottle' },
  { wms_uom: 'CAR',  insw_uom: 'CT',  description: 'Carton' },
  { wms_uom: 'CRT',  insw_uom: 'CR',  description: 'Crate' },
  { wms_uom: 'CV',   insw_uom: 'CS',  description: 'Case' },
  { wms_uom: 'DR',   insw_uom: 'DR',  description: 'Drum' },
  { wms_uom: 'DZ',   insw_uom: 'DZN', description: 'Dozen' },
  { wms_uom: 'GRO',  insw_uom: 'GRO', description: 'Gross' },
  { wms_uom: 'PAA',  insw_uom: 'PR',  description: 'Pair' },
  { wms_uom: 'PAC',  insw_uom: 'PK',  description: 'Pack' },
  // Count / unit
  { wms_uom: 'EA',   insw_uom: 'EA',  description: 'Each' },
  { wms_uom: 'PC',   insw_uom: 'PCE', description: 'Piece' },
  // Length / area / volume
  { wms_uom: 'FT2',  insw_uom: 'FTK', description: 'Square foot' },
  { wms_uom: 'FT3',  insw_uom: 'FTQ', description: 'Cubic foot' },
  { wms_uom: 'IN2',  insw_uom: 'INK', description: 'Square inch' },
  { wms_uom: 'IN3',  insw_uom: 'INQ', description: 'Cubic inch' },
  { wms_uom: 'MI2',  insw_uom: 'MIK', description: 'Square mile' },
  { wms_uom: 'YD2',  insw_uom: 'YDK', description: 'Square Yard' },
  { wms_uom: 'YD3',  insw_uom: 'YDQ', description: 'Cubic yard' },
  { wms_uom: 'HA',   insw_uom: 'HAR', description: 'Hectare' },
  // Mass / weight
  { wms_uom: 'G',    insw_uom: 'GRM', description: 'Gram' },
  { wms_uom: 'KG',   insw_uom: 'KGM', description: 'Kilogram' },
  { wms_uom: 'KT',   insw_uom: 'KTN', description: 'Kilotonne' },
  { wms_uom: 'MG',   insw_uom: 'MGM', description: 'Milligram' },
  // Time
  { wms_uom: 'H',    insw_uom: 'HUR', description: 'Hour' },
  { wms_uom: 'MIN',  insw_uom: 'MIN', description: 'Minute' },
  { wms_uom: 'MIS',  insw_uom: 'B98', description: 'Microsecond' },
  { wms_uom: 'MSE',  insw_uom: 'C26', description: 'Millisecond' },
  { wms_uom: 'NS',   insw_uom: 'C47', description: 'Nanosecond' },
  { wms_uom: 'PS',   insw_uom: 'H70', description: 'Picosecond' },
  // Pressure / force
  { wms_uom: 'KPA',  insw_uom: 'KPA', description: 'Kilopascal' },
  { wms_uom: 'MN',   insw_uom: 'B73', description: 'Meganewton' },
  { wms_uom: 'NI',   insw_uom: 'B47', description: 'Kilonewton' },
  { wms_uom: 'PAS',  insw_uom: 'C65', description: 'Pascal second' },
  // Energy
  { wms_uom: 'GJ',   insw_uom: 'GV',  description: 'Gigajoule' },
  { wms_uom: 'MEJ',  insw_uom: '3B',  description: 'Megajoule' },
  // Electrical
  { wms_uom: 'GOH',  insw_uom: 'A87', description: 'Gigaohm' },
  { wms_uom: 'MHV',  insw_uom: 'B78', description: 'Megavolt' },
  { wms_uom: 'RF',   insw_uom: 'C10', description: 'Millifarad' },
  { wms_uom: 'R-U',  insw_uom: 'C41', description: 'Nanofarad' },
  { wms_uom: '\u03bcA', insw_uom: 'B84', description: 'Microampere' },
  { wms_uom: '\u03bcF', insw_uom: '4O',  description: 'Microfarad' },
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
