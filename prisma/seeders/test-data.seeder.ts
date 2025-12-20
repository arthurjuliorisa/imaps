import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Comprehensive test seeder for all Lap. per Dokumen and LPJ Mutasi menus
 * This seeder creates data for testing purposes only
 */
export async function seedTestData() {
  console.log('🧪 Seeding test data for all menus...');

  const COMPANY_CODE = 1310;
  const TEST_DATE = new Date('2026-12-15');

  // Clean up existing test data first
  console.log('  🗑️  Cleaning up existing test data...');
  await cleanupTestData();

  // 1. CREATE BEGINNING BALANCES (Opening stock for all item types)
  console.log('  📊 Creating beginning balances...');

  const BALANCE_DATE = new Date('2026-12-01');

  const beginningBalances = [
    // Raw Materials (ROH)
    {
      company_code: COMPANY_CODE,
      item_type: 'ROH',
      item_code: 'RM-1310-001',
      item_name: 'Polyester Yarn 150D White',
      qty: 5000,
      uom: 'KG',
      balance_date: BALANCE_DATE,
    },
    {
      company_code: COMPANY_CODE,
      item_type: 'ROH',
      item_code: 'RM-1310-002',
      item_name: 'Cotton Thread 40s',
      qty: 2000,
      uom: 'KG',
      balance_date: BALANCE_DATE,
    },
    // WIP (HALB)
    {
      company_code: COMPANY_CODE,
      item_type: 'HALB',
      item_code: 'WIP-1310-001',
      item_name: 'Semi-Finished Fabric Roll',
      qty: 100,
      uom: 'ROLL',
      balance_date: BALANCE_DATE,
    },
    // Finished Goods (FERT)
    {
      company_code: COMPANY_CODE,
      item_type: 'FERT',
      item_code: 'FG-1310-001',
      item_name: 'Finished Fabric Roll Grade A',
      qty: 200,
      uom: 'ROLL',
      balance_date: BALANCE_DATE,
    },
    // Capital Goods - Machinery (HIBE_M)
    {
      company_code: COMPANY_CODE,
      item_type: 'HIBE_M',
      item_code: 'CG-MACH-001',
      item_name: 'Weaving Machine Type A',
      qty: 5,
      uom: 'UNIT',
      balance_date: BALANCE_DATE,
    },
    // Capital Goods - Equipment (HIBE_E)
    {
      company_code: COMPANY_CODE,
      item_type: 'HIBE_E',
      item_code: 'CG-EQUIP-001',
      item_name: 'Quality Control Equipment',
      qty: 10,
      uom: 'UNIT',
      balance_date: BALANCE_DATE,
    },
    // Scrap (SCRAP)
    {
      company_code: COMPANY_CODE,
      item_type: 'SCRAP',
      item_code: 'SCRAP-1310-001',
      item_name: 'Fabric Waste Grade B',
      qty: 50,
      uom: 'KG',
      balance_date: BALANCE_DATE,
    },
  ];

  await prisma.beginning_balances.createMany({
    data: beginningBalances,
  });
  console.log(`  ✅ Created ${beginningBalances.length} beginning balances`);

  // 2. INCOMING GOODS (BC23 - Pemasukan)
  console.log('  📥 Creating incoming goods...');

  const incoming1 = await prisma.incoming_goods.create({
    data: {
      wms_id: 'INC-1310-20261215-001',
      company_code: COMPANY_CODE,
      owner: COMPANY_CODE,
      customs_document_type: 'BC23',
      ppkek_number: 'PPKEK-1310-2026-001',
      customs_registration_date: new Date('2026-12-14'),
      incoming_evidence_number: 'SJ-IN-20261215-001',
      incoming_date: TEST_DATE,
      invoice_number: 'INV-IMP-001',
      invoice_date: new Date('2026-12-10'),
      shipper_name: 'PT Supplier Materials Indonesia',
      timestamp: new Date(),
    },
  });

  await prisma.incoming_good_items.createMany({
    data: [
      {
        incoming_good_id: incoming1.id,
        incoming_good_company: incoming1.company_code,
        incoming_good_date: incoming1.incoming_date,
        item_type: 'ROH',
        item_code: 'RM-1310-001',
        item_name: 'Polyester Yarn 150D White',
        hs_code: '5402.46.00',
        uom: 'KG',
        qty: 1000,
        currency: 'USD',
        amount: 5000,
      },
      {
        incoming_good_id: incoming1.id,
        incoming_good_company: incoming1.company_code,
        incoming_good_date: incoming1.incoming_date,
        item_type: 'ROH',
        item_code: 'RM-1310-002',
        item_name: 'Cotton Thread 40s',
        hs_code: '5204.11.00',
        uom: 'KG',
        qty: 500,
        currency: 'USD',
        amount: 2500,
      },
    ],
  });

  // Incoming for Capital Goods
  const incoming2 = await prisma.incoming_goods.create({
    data: {
      wms_id: 'INC-1310-20261215-002',
      company_code: COMPANY_CODE,
      owner: COMPANY_CODE,
      customs_document_type: 'BC27',
      ppkek_number: 'PPKEK-1310-2026-002',
      customs_registration_date: new Date('2026-12-14'),
      incoming_evidence_number: 'SJ-IN-20261215-002',
      incoming_date: TEST_DATE,
      invoice_number: 'INV-CAP-001',
      invoice_date: new Date('2026-12-10'),
      shipper_name: 'Machinery Supplier Co Ltd',
      timestamp: new Date(),
    },
  });

  await prisma.incoming_good_items.create({
    data: {
      incoming_good_id: incoming2.id,
      incoming_good_company: incoming2.company_code,
      incoming_good_date: incoming2.incoming_date,
      item_type: 'HIBE_M',
      item_code: 'CG-MACH-001',
      item_name: 'Weaving Machine Type A',
      hs_code: '8446.10.00',
      uom: 'UNIT',
      qty: 2,
      currency: 'USD',
      amount: 50000,
    },
  });

  console.log('  ✅ Created 2 incoming goods documents');

  // 3. MATERIAL USAGE (Pemakaian Bahan Baku)
  console.log('  🔧 Creating material usage...');

  const materialUsage = await prisma.material_usages.create({
    data: {
      wms_id: 'MAT-1310-20261215-001',
      company_code: COMPANY_CODE,
      work_order_number: 'WO-1310-20261215-001',
      internal_evidence_number: 'INT-MAT-20261215-001',
      transaction_date: TEST_DATE,
      timestamp: new Date(),
    },
  });

  await prisma.material_usage_items.createMany({
    data: [
      {
        material_usage_id: materialUsage.id,
        material_usage_company: materialUsage.company_code,
        material_usage_date: materialUsage.transaction_date,
        item_type: 'ROH',
        item_code: 'RM-1310-001',
        item_name: 'Polyester Yarn 150D White',
        uom: 'KG',
        qty: 300,
        ppkek_number: 'PPKEK-1310-2026-001',
      },
      {
        material_usage_id: materialUsage.id,
        material_usage_company: materialUsage.company_code,
        material_usage_date: materialUsage.transaction_date,
        item_type: 'ROH',
        item_code: 'RM-1310-002',
        item_name: 'Cotton Thread 40s',
        uom: 'KG',
        qty: 100,
        ppkek_number: 'PPKEK-1310-2026-001',
      },
    ],
  });

  console.log('  ✅ Created material usage');

  // 4. PRODUCTION OUTPUT (Hasil Produksi)
  console.log('  🏭 Creating production output...');

  const production = await prisma.production_outputs.create({
    data: {
      wms_id: 'PROD-1310-20261215-001',
      company_code: COMPANY_CODE,
      internal_evidence_number: 'INT-PROD-20261215-001',
      transaction_date: TEST_DATE,
      timestamp: new Date(),
    },
  });

  await prisma.production_output_items.createMany({
    data: [
      {
        production_output_id: production.id,
        production_output_company: production.company_code,
        production_output_date: production.transaction_date,
        item_type: 'FERT',
        item_code: 'FG-1310-001',
        item_name: 'Finished Fabric Roll Grade A',
        uom: 'ROLL',
        qty: 50,
        work_order_numbers: ['WO-1310-20261215-001'],
      },
      {
        production_output_id: production.id,
        production_output_company: production.company_code,
        production_output_date: production.transaction_date,
        item_type: 'SCRAP',
        item_code: 'SCRAP-1310-001',
        item_name: 'Fabric Waste Grade B',
        uom: 'KG',
        qty: 25,
        work_order_numbers: ['WO-1310-20261215-001'],
      },
    ],
  });

  console.log('  ✅ Created production output');

  // 5. WIP BALANCE
  console.log('  ⚙️  Creating WIP balance...');

  await prisma.wip_balances.create({
    data: {
      wms_id: 'WIP-1310-20261215-001',
      company_code: COMPANY_CODE,
      item_type: 'HALB',
      item_code: 'WIP-1310-001',
      item_name: 'Semi-Finished Fabric Roll',
      stock_date: TEST_DATE,
      uom: 'ROLL',
      qty: 110,
      timestamp: new Date(),
    },
  });

  console.log('  ✅ Created WIP balance');

  // 6. OUTGOING GOODS (Pengeluaran)
  console.log('  📤 Creating outgoing goods...');

  const outgoing = await prisma.outgoing_goods.create({
    data: {
      wms_id: 'OUT-1310-20261215-001',
      company_code: COMPANY_CODE,
      owner: COMPANY_CODE,
      customs_document_type: 'BC30',
      ppkek_number: 'PPKEK-1310-2026-003',
      customs_registration_date: new Date('2026-12-14'),
      outgoing_evidence_number: 'SJ-OUT-20261215-001',
      outgoing_date: TEST_DATE,
      invoice_number: 'INV-EXP-001',
      invoice_date: new Date('2026-12-13'),
      recipient_name: 'Global Textile Buyers Inc',
      timestamp: new Date(),
    },
  });

  await prisma.outgoing_good_items.create({
    data: {
      outgoing_good_id: outgoing.id,
      outgoing_good_company: outgoing.company_code,
      outgoing_good_date: outgoing.outgoing_date,
      item_type: 'FERT',
      item_code: 'FG-1310-001',
      item_name: 'Finished Fabric Roll Grade A',
      production_output_wms_ids: ['PROD-1310-20261215-001'],
      hs_code: '5407.42.00',
      uom: 'ROLL',
      qty: 30,
      currency: 'USD',
      amount: 4500,
    },
  });

  console.log('  ✅ Created outgoing goods');

  console.log('  🎉 Test data seeding completed!\n');
  console.log('  📊 Summary:');
  console.log('     - Beginning Balances: 7 items');
  console.log('     - Incoming Goods: 2 documents (3 items)');
  console.log('     - Material Usage: 1 document (2 items)');
  console.log('     - Production Output: 1 document (2 items - FG + Scrap)');
  console.log('     - WIP Balance: 1 record');
  console.log('     - Outgoing Goods: 1 document (1 item)');
}

/**
 * Clean up all test data for company 1310
 */
export async function cleanupTestData() {
  const COMPANY_CODE = 1310;

  // Delete in reverse order of creation (respecting foreign keys)
  await prisma.outgoing_good_items.deleteMany({
    where: { outgoing_good_company: COMPANY_CODE }
  });
  await prisma.outgoing_goods.deleteMany({
    where: { company_code: COMPANY_CODE }
  });

  await prisma.wip_balances.deleteMany({
    where: { company_code: COMPANY_CODE }
  });

  await prisma.production_output_items.deleteMany({
    where: { production_output_company: COMPANY_CODE }
  });
  await prisma.production_outputs.deleteMany({
    where: { company_code: COMPANY_CODE }
  });

  await prisma.material_usage_items.deleteMany({
    where: { material_usage_company: COMPANY_CODE }
  });
  await prisma.material_usages.deleteMany({
    where: { company_code: COMPANY_CODE }
  });

  await prisma.incoming_good_items.deleteMany({
    where: { incoming_good_company: COMPANY_CODE }
  });
  await prisma.incoming_goods.deleteMany({
    where: { company_code: COMPANY_CODE }
  });

  await prisma.beginning_balances.deleteMany({
    where: { company_code: COMPANY_CODE }
  });

  console.log('  ✅ Cleaned up all test data for company 1310');
}
