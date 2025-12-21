/**
 * Manual API endpoint testing script for scrap and production transactions
 * Run with: npx tsx scripts/test-transaction-endpoints.ts
 */

import { prisma } from '../lib/prisma';

async function testEndpoints() {
  console.log('Starting endpoint validation tests...\n');

  try {
    // Test 1: Check if scrap items exist for testing
    console.log('1. Checking scrap items in database...');
    const scrapItems = await prisma.scrap_items.findMany({
      where: { is_active: true },
      take: 5,
    });
    console.log(`   Found ${scrapItems.length} active scrap items`);
    if (scrapItems.length > 0) {
      console.log(`   Example: ${scrapItems[0].scrap_code} - ${scrapItems[0].scrap_name}`);
    }

    // Test 2: Check if FERT items exist for testing
    console.log('\n2. Checking FERT items in database...');
    const fertItems = await prisma.items.findMany({
      where: {
        item_type: 'FERT',
        is_active: true,
      },
      take: 5,
    });
    console.log(`   Found ${fertItems.length} active FERT items`);
    if (fertItems.length > 0) {
      console.log(`   Example: ${fertItems[0].item_code} - ${fertItems[0].item_name}`);
    }

    // Test 3: Verify snapshot_recalc_queue table exists
    console.log('\n3. Checking snapshot_recalc_queue table...');
    const queueCount = await prisma.snapshot_recalc_queue.count();
    console.log(`   Current queue entries: ${queueCount}`);

    // Test 4: Verify incoming_goods table structure
    console.log('\n4. Checking incoming_goods table...');
    const incomingCount = await prisma.incoming_goods.count();
    console.log(`   Total incoming goods records: ${incomingCount}`);

    // Test 5: Verify outgoing_goods table structure
    console.log('\n5. Checking outgoing_goods table...');
    const outgoingCount = await prisma.outgoing_goods.count();
    console.log(`   Total outgoing goods records: ${outgoingCount}`);

    // Test 6: Check companies
    console.log('\n6. Checking companies...');
    const companies = await prisma.companies.findMany({
      where: { status: 'ACTIVE' },
    });
    console.log(`   Found ${companies.length} active companies`);
    if (companies.length > 0) {
      console.log(`   Example: Company ${companies[0].code} - ${companies[0].name}`);
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('VALIDATION SUMMARY');
    console.log('='.repeat(60));

    const checks = {
      'Scrap items available': scrapItems.length > 0,
      'FERT items available': fertItems.length > 0,
      'Queue table exists': true,
      'Incoming goods table exists': true,
      'Outgoing goods table exists': true,
      'Active companies exist': companies.length > 0,
    };

    let allPassed = true;
    for (const [check, passed] of Object.entries(checks)) {
      const status = passed ? '✓ PASS' : '✗ FAIL';
      console.log(`${status} - ${check}`);
      if (!passed) allPassed = false;
    }

    console.log('='.repeat(60));

    if (allPassed) {
      console.log('\n✓ All validation checks passed!');
      console.log('\nThe following endpoints are ready for testing:');
      console.log('  - POST /api/customs/scrap/incoming');
      console.log('  - POST /api/customs/scrap/outgoing');
      console.log('  - POST /api/customs/production/outgoing');

      if (scrapItems.length > 0) {
        console.log(`\nExample scrap code for testing: ${scrapItems[0].scrap_code}`);
      }
      if (fertItems.length > 0) {
        console.log(`Example FERT code for testing: ${fertItems[0].item_code}`);
      }
      console.log('\nExample request body for scrap incoming:');
      console.log(JSON.stringify({
        date: new Date().toISOString().split('T')[0],
        scrapCode: scrapItems[0]?.scrap_code || 'SCRAP001',
        qty: 100,
        currency: 'USD',
        amount: 1000,
        remarks: 'Test transaction'
      }, null, 2));
    } else {
      console.log('\n✗ Some validation checks failed. Please fix the issues above.');
    }

  } catch (error) {
    console.error('\n✗ Error during validation:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

testEndpoints()
  .then(() => {
    console.log('\nValidation completed successfully.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nValidation failed:', error);
    process.exit(1);
  });
