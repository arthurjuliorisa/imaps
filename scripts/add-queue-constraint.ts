import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function addConstraint() {
  console.log('Adding unique constraint to snapshot_recalc_queue...');

  try {
    // Check if constraint exists
    const result = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'snapshot_recalc_queue'::regclass
      AND contype = 'u';
    `;

    console.log('Existing constraints:', result);

    // Add the unique constraint if it doesn't exist
    const hasConstraint = result.some(r =>
      r.conname === 'snapshot_recalc_queue_company_code_recalc_date_item_type_item_code_key'
    );

    if (!hasConstraint) {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE snapshot_recalc_queue
        ADD CONSTRAINT snapshot_recalc_queue_company_code_recalc_date_item_type_item_code_key
        UNIQUE (company_code, recalc_date, item_type, item_code);
      `);
      console.log('✓ Constraint added!');
    } else {
      console.log('✓ Constraint already exists');
    }

    console.log('✓ Unique constraint added successfully!');

    // Verify constraint was added
    const verifyResult = await prisma.$queryRaw<Array<{ conname: string }>>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'snapshot_recalc_queue'::regclass
      AND contype = 'u';
    `;

    console.log('Constraints after adding:', verifyResult);
  } catch (error) {
    console.error('Error adding constraint:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

addConstraint()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
