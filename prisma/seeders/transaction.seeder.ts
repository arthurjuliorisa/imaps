import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedTransactions() {
  console.log('📦 Seeding transactions...');

  // 1. INCOMING GOODS
  const incomingGood = await prisma.incoming_goods.create({
    data: {
      wms_id: 'INC-1310-20251214-001',
      company_code: 1310,
      owner: 1310,
      customs_document_type: 'BC23',
      ppkek_number: 'PPKEK-1310-2025-0001',
      customs_registration_date: new Date('2026-12-10'),
      incoming_evidence_number: 'SJ-1310-IN-001',
      incoming_date: new Date('2026-12-14'),
      invoice_number: 'INV-001',
      invoice_date: new Date('2026-12-08'),
      shipper_name: 'PT Supplier Materials',
      timestamp: new Date(),
    },
  });

  await prisma.incoming_good_items.create({
    data: {
      incoming_good_id: incomingGood.id,
      incoming_good_company: incomingGood.company_code,
      incoming_good_date: incomingGood.incoming_date,
      item_type: 'ROH',
      item_code: 'RM-1310-001',
      item_name: 'Polyester Yarn 150D White',
      hs_code: '5402.46.00',
      uom: 'KG',
      qty: 1000,
      currency: 'USD',
      amount: 5000,
    },
  });

  console.log(`✅ Created incoming goods: ${incomingGood.wms_id}`);

  // 2. MATERIAL USAGE
  const materialUsage = await prisma.material_usages.create({
    data: {
      wms_id: 'MAT-1310-20251214-001',
      company_code: 1310,
      work_order_number: 'WO-1310-001',
      internal_evidence_number: 'INT-MAT-001',
      transaction_date: new Date('2026-12-14'),
      timestamp: new Date(),
    },
  });

  await prisma.material_usage_items.create({
    data: {
      material_usage_id: materialUsage.id,
      material_usage_company: materialUsage.company_code,
      material_usage_date: materialUsage.transaction_date,
      item_type: 'ROH',
      item_code: 'RM-1310-001',
      item_name: 'Polyester Yarn 150D White',
      uom: 'KG',
      qty: 300,
      ppkek_number: 'PPKEK-1310-2025-0001',
    },
  });

  console.log(`✅ Created material usage: ${materialUsage.wms_id}`);

  // 3. PRODUCTION OUTPUT
  const productionOutput = await prisma.production_outputs.create({
    data: {
      wms_id: 'PROD-1310-20251214-001',
      company_code: 1310,
      internal_evidence_number: 'INT-PROD-001',
      transaction_date: new Date('2026-12-14'),
      timestamp: new Date(),
    },
  });

  await prisma.production_output_items.create({
    data: {
      production_output_id: productionOutput.id,
      production_output_company: productionOutput.company_code,
      production_output_date: productionOutput.transaction_date,
      item_type: 'FERT',
      item_code: 'FG-1310-001',
      item_name: 'Finished Fabric Roll Grade A',
      uom: 'ROLL',
      qty: 50,
      work_order_numbers: ['WO-1310-001'],
    },
  });

  console.log(`✅ Created production output: ${productionOutput.wms_id}`);

  // 4. OUTGOING GOODS
  const outgoingGood = await prisma.outgoing_goods.create({
    data: {
      wms_id: 'OUT-1310-20251214-001',
      company_code: 1310,
      owner: 1310,
      customs_document_type: 'BC30',
      ppkek_number: 'PPKEK-1310-2025-0002',
      customs_registration_date: new Date('2026-12-12'),
      outgoing_evidence_number: 'SJ-OUT-001',
      outgoing_date: new Date('2026-12-14'),
      invoice_number: 'INV-EXP-001',
      invoice_date: new Date('2026-12-11'),
      recipient_name: 'Global Textile Buyers',
      timestamp: new Date(),
    },
  });

  await prisma.outgoing_good_items.create({
    data: {
      outgoing_good_id: outgoingGood.id,
      outgoing_good_company: outgoingGood.company_code,
      outgoing_good_date: outgoingGood.outgoing_date,
      item_type: 'FERT',
      item_code: 'FG-1310-001',
      item_name: 'Finished Fabric Roll Grade A',
      production_output_wms_ids: ['PROD-1310-20251214-001'],
      hs_code: '5407.42.00',
      uom: 'ROLL',
      qty: 30,
      currency: 'USD',
      amount: 4500,
    },
  });

  console.log(`✅ Created outgoing goods: ${outgoingGood.wms_id}`);

  return {
    incomingGood,
    materialUsage,
    productionOutput,
    outgoingGood,
  };
}
