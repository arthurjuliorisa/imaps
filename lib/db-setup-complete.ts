// ============================================================================
// FILE: lib/db-setup-complete.ts
// Complete database setup - no prisma push needed!
// ============================================================================

import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

// Use connection pool for better performance
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

async function executeSqlFile(filePath: string, client: any) {
  const fullPath = join(process.cwd(), filePath);
  const sql = readFileSync(fullPath, 'utf8');
  
  console.log(`\n📄 Executing: ${filePath}`);
  
  // Split by semicolon but keep transaction blocks together
  const statements = sql
    .split(/;\s*$/gm)
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  let executed = 0;
  const total = statements.length;

  for (const statement of statements) {
    if (statement.length === 0) continue;
    
    try {
      await client.query(statement + ';');
      executed++;
      
      if (executed % 20 === 0) {
        console.log(`  Progress: ${executed}/${total} statements`);
      }
    } catch (error: any) {
      // Ignore "already exists" errors for idempotency
      if (
        error.message.includes('already exists') ||
        error.message.includes('duplicate object')
      ) {
        console.log(`  ⚠️  Skipped (already exists): ${statement.substring(0, 60)}...`);
        continue;
      }
      
      console.error(`\n❌ Error executing statement:`);
      console.error(statement.substring(0, 200));
      console.error(`Error: ${error.message}`);
      throw error;
    }
  }
  
  console.log(`✅ Completed: ${filePath} (${executed} statements)`);
}

export async function setupCompleteDatabase() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Starting complete database setup...');
    console.log('This will take a few minutes...\n');
    
    const startTime = Date.now();
    
    // Step 1: Complete setup (tables + partitions + child tables + traceability)
    console.log('📊 STEP 1: Creating all tables and partitions...');
    await executeSqlFile('prisma/complete_setup.sql', client);
    
    // Step 2: Create functions
    console.log('\n⚙️  STEP 2: Creating calculation functions...');
    await executeSqlFile('prisma/08_functions.sql', client);
    
    // Step 3: Create views
    console.log('\n👁️  STEP 3: Creating reporting views...');
    await executeSqlFile('prisma/create_views.sql', client);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(70));
    console.log('✅ DATABASE SETUP COMPLETE!');
    console.log('='.repeat(70));
    console.log(`⏱️  Total time: ${duration} seconds`);
    console.log('\n📝 Next steps:');
    console.log('   1. Run seed script: npm run prisma:seed');
    console.log('   2. Verify tables: npm run db:verify');
    console.log('   3. Start your application!');
    console.log('='.repeat(70));
    
    return {
      success: true,
      duration: parseFloat(duration),
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('\n' + '='.repeat(70));
    console.error('❌ DATABASE SETUP FAILED');
    console.error('='.repeat(70));
    console.error(error);
    throw error;
  } finally {
    client.release();
  }
}

export async function verifyDatabaseSetup() {
  const client = await pool.connect();
  
  try {
    console.log('🔍 Verifying database setup...\n');
    
    // Check tables
    const tablesResult = await client.query(`
      SELECT schemaname, tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      ORDER BY tablename
    `);
    
    console.log(`✅ Total tables: ${tablesResult.rows.length}`);
    
    // Check partitions
    const partitionsResult = await client.query(`
      SELECT 
        parent.relname as parent_table,
        COUNT(*) as partition_count
      FROM pg_inherits
      JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
      JOIN pg_class child ON pg_inherits.inhrelid = child.oid
      GROUP BY parent.relname
      ORDER BY parent.relname
    `);
    
    console.log(`\n📊 Partitioned tables:`);
    partitionsResult.rows.forEach(row => {
      console.log(`   ${row.parent_table}: ${row.partition_count} partitions`);
    });
    
    // Check views
    const viewsResult = await client.query(`
      SELECT table_name 
      FROM information_schema.views 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    
    console.log(`\n👁️  Views created: ${viewsResult.rows.length}`);
    viewsResult.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
    // Check functions
    const functionsResult = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
        AND routine_type = 'FUNCTION'
      ORDER BY routine_name
    `);
    
    console.log(`\n⚙️  Functions created: ${functionsResult.rows.length}`);
    functionsResult.rows.forEach(row => {
      console.log(`   - ${row.routine_name}`);
    });
    
    console.log('\n✅ Database verification complete!\n');
    
    return {
      tables: tablesResult.rows.length,
      views: viewsResult.rows.length,
      functions: functionsResult.rows.length,
      partitions: partitionsResult.rows
    };
    
  } finally {
    client.release();
  }
}

export async function cleanupPool() {
  await pool.end();
}