import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, '..', '.env') });

const SQL_DIR = join(__dirname, 'sql');

// Get DATABASE_URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

console.log(`[DEPLOY] Using database connection (user hidden)`);
console.log(`[DEPLOY] Database: ${DATABASE_URL?.split('@')[1] || 'unknown'}`);


// SQL files to execute in order (excluding 00_init_database.sql)
const SQL_FILES = [
  '01_setup_partitions.sql',
  '02_traceability_tables.sql',
  '03_functions.sql',
  '04_create_views.sql',
];

function log(message: string) {
  console.log(`[DEPLOY] ${message}`);
}

function error(message: string) {
  console.error(`[DEPLOY ERROR] ${message}`);
}

function executeSQLFile(filename: string) {
  const filePath = join(SQL_DIR, filename);

  if (!existsSync(filePath)) {
    error(`SQL file not found: ${filePath}`);
    return false;
  }

  log(`Executing ${filename}...`);

  try {
    // Execute SQL file using psql
    const command = `psql "${DATABASE_URL}" -f "${filePath}"`;
    execSync(command, {
      stdio: 'inherit',
      env: { ...process.env }
    });
    log(`✓ ${filename} executed successfully`);
    return true;
  } catch (err) {
    error(`Failed to execute ${filename}: ${err}`);
    return false;
  }
}

async function main() {
  log('Starting SQL deployment...');
  log('============================================================================');

  // Check if DATABASE_URL is set
  if (!DATABASE_URL) {
    error('DATABASE_URL environment variable is not set');
    process.exit(1);
  }

  // Check if psql is available
  try {
    execSync('psql --version', { stdio: 'ignore' });
  } catch {
    error('psql command not found. Please install PostgreSQL client tools.');
    process.exit(1);
  }

  let hasError = false;

  // Execute SQL files in order
  for (const sqlFile of SQL_FILES) {
    const success = executeSQLFile(sqlFile);
    if (!success) {
      hasError = true;
      // Continue with other files even if one fails
    }
  }

  log('============================================================================');

  if (hasError) {
    log('Deployment completed with some errors');
    log('Note: Some errors may be expected (e.g., objects already exist)');
  } else {
    log('SQL deployment completed successfully!');
  }
}

main()
  .catch((err) => {
    error(`Deployment failed: ${err}`);
    process.exit(1);
  });
