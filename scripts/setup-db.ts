// ============================================================================
// FILE: scripts/setup-db.ts
// Script untuk local development
// ============================================================================

import { setupCompleteDatabase, verifyDatabaseSetup, cleanupPool } from '../lib/db-setup-complete';

async function main() {
  try {
    // Run complete setup
    await setupCompleteDatabase();
    
    // Verify
    console.log('\n');
    await verifyDatabaseSetup();
    
    console.log('✅ Setup completed successfully!\n');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Setup failed:', error);
    process.exit(1);
  } finally {
    await cleanupPool();
  }
}

main();