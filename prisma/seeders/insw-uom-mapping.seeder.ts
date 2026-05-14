import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const uomMappings = [
  // Packaging
  { wms_uom: 'BAG',  insw_uom: 'BG',  description: 'Bag' },
  { wms_uom: 'BOK',  insw_uom: 'D63', description: 'Book' },
  { wms_uom: 'BOT',  insw_uom: 'BO',  description: 'Bottle' },
  { wms_uom: 'BOX',  insw_uom: 'BB',  description: 'Base box' },
  { wms_uom: 'BRR',  insw_uom: 'B4',  description: 'Barrel' },
  { wms_uom: 'BT',   insw_uom: 'BO',  description: 'Bottle' },
  { wms_uom: 'CAR',  insw_uom: 'CT',  description: 'Carton' },
  { wms_uom: 'CRT',  insw_uom: 'CR',  description: 'Crate' },
  { wms_uom: 'CV',   insw_uom: 'CS',  description: 'Case' },
  { wms_uom: 'DR',   insw_uom: 'DR',  description: 'Drum' },
  { wms_uom: 'DZ',   insw_uom: 'DZN', description: 'Dozen' },
  { wms_uom: 'GRO',  insw_uom: 'GRO', description: 'Gross' },
  { wms_uom: 'HPC',  insw_uom: 'HC',  description: 'Hundred count' },
  { wms_uom: 'PAA',  insw_uom: 'PR',  description: 'Pair' },
  { wms_uom: 'PAC',  insw_uom: 'PK',  description: 'Pack' },
  { wms_uom: 'RL',   insw_uom: 'NRL', description: 'Number of rolls' },
  { wms_uom: 'ROL',  insw_uom: 'RO',  description: 'Roll' },
  { wms_uom: 'SET',  insw_uom: 'SET', description: 'Set' },
  { wms_uom: 'SHT',  insw_uom: 'ST',  description: 'Sheet' },
  
  // Count / unit
  { wms_uom: 'EA',   insw_uom: 'EA',  description: 'Each' },
  { wms_uom: 'PC',   insw_uom: 'PCE', description: 'Piece' },
  { wms_uom: 'TAI',  insw_uom: 'MA',  description: 'Machine per unit' },
  
  // Length
  { wms_uom: 'FT',   insw_uom: 'FOT', description: 'Foot' },
  { wms_uom: 'M',    insw_uom: 'LM',  description: 'Linear metre' },
  { wms_uom: 'YD',   insw_uom: 'YRD', description: 'Yard (0.9144 m)' },
  
  // Area
  { wms_uom: 'CM2',  insw_uom: 'CMK', description: 'Square centimetre' },
  { wms_uom: 'FT2',  insw_uom: 'FTK', description: 'Square foot' },
  { wms_uom: 'IN2',  insw_uom: 'INK', description: 'Square inch' },
  { wms_uom: 'M2',   insw_uom: 'MTK', description: 'Square metre' },
  { wms_uom: 'MI2',  insw_uom: 'MIK', description: 'Square mile' },
  { wms_uom: 'YD2',  insw_uom: 'YDK', description: 'Square Yard' },
  { wms_uom: 'HA',   insw_uom: 'HAR', description: 'Hectare' },
  
  // Volume
  { wms_uom: 'FT3',  insw_uom: 'FTQ', description: 'Cubic foot' },
  { wms_uom: 'IN3',  insw_uom: 'INQ', description: 'Cubic inch' },
  { wms_uom: 'L',    insw_uom: 'LTR', description: 'Litre (1 dm3)' },
  { wms_uom: 'M3',   insw_uom: 'MTQ', description: 'Cubic metre' },
  { wms_uom: 'YD3',  insw_uom: 'YDQ', description: 'Cubic yard' },
  
  // Mass / weight
  { wms_uom: 'G',    insw_uom: 'GRM', description: 'Gram' },
  { wms_uom: 'KG',   insw_uom: 'KGM', description: 'Kilogram' },
  { wms_uom: 'KT',   insw_uom: 'KTN', description: 'Kilotonne' },
  { wms_uom: 'MG',   insw_uom: 'MGM', description: 'Milligram' },
  
  // Time
  { wms_uom: 'D',    insw_uom: 'DAY', description: 'Day' },
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
  { wms_uom: 'μA',   insw_uom: 'B84', description: 'Microampere' },
  { wms_uom: 'μF',   insw_uom: '4O',  description: 'Microfarad' },
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
