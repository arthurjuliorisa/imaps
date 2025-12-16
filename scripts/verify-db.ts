// ============================================================================
// FILE: scripts/verify-db.ts
// Script untuk verifikasi setup
// ============================================================================

import { verifyDatabaseSetup, cleanupPool } from '../lib/db-setup-complete';

async function main() {
  try {
    await verifyDatabaseSetup();
    process.exit(0);
  } catch (error) {
    console.error('Verification failed:', error);
    process.exit(1);
  } finally {
    await cleanupPool();
  }
}

main();