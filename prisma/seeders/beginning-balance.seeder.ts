import { PrismaClient, ItemTypeCode } from '@prisma/client';

const prisma = new PrismaClient();

export async function seedBeginningBalances() {
  console.log('📊 Seeding Sample Beginning Balances...');

  const beginningBalances = [
    {
      company_code: 'ACME',
      item_code: 'RM-STEEL-A36',
      item_name: 'Steel Plate A36 - 10mm',
      item_type_code: ItemTypeCode.ROH,
      uom: 'KG',
      balance_qty: 5000.0,
      balance_date: new Date('2026-01-01'),
    },
    {
      company_code: 'ACME',
      item_code: 'WIP-FRAME-001',
      item_name: 'Machine Frame Assembly',
      item_type_code: ItemTypeCode.HALB,
      uom: 'PCS',
      balance_qty: 50.0,
      balance_date: new Date('2026-01-01'),
    },
    {
      company_code: 'ACME',
      item_code: 'FG-MACHINE-X100',
      item_name: 'Industrial Machine X100',
      item_type_code: ItemTypeCode.FERT,
      uom: 'UNIT',
      balance_qty: 10.0,
      balance_date: new Date('2026-01-01'),
    },
  ];

  let createdCount = 0;
  for (const balance of beginningBalances) {
    await prisma.beginning_balances.upsert({
      where: {
        company_code_item_code_balance_date: {
          company_code: balance.company_code,
          item_code: balance.item_code,
          balance_date: balance.balance_date,
        },
      },
      update: {
        item_name: balance.item_name,
        item_type_code: balance.item_type_code,
        uom: balance.uom,
        balance_qty: balance.balance_qty,
      },
      create: balance,
    });
    console.log(
      `  ✓ Created/Updated Beginning Balance: ${balance.item_code} - ${balance.balance_qty} ${balance.uom}`
    );
    createdCount++;
  }

  console.log(`Completed: ${createdCount} beginning balances seeded\n`);
}
