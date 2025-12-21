#!/usr/bin/env node

/**
 * Database Initialization Script
 * Dynamically reads DATABASE_URL from .env and initializes the database
 * 
 * Usage:
 *   node scripts/init-database.js
 * 
 * This script will:
 * 1. Parse .env to extract database credentials
 * 2. Connect to PostgreSQL as postgres superuser
 * 3. Create database, user, and set permissions
 * 4. Create extensions and configure database
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  log(`ERROR: ${message}`, 'red');
  process.exit(1);
}

function success(message) {
  log(`✓ ${message}`, 'green');
}

function info(message) {
  log(`ℹ ${message}`, 'blue');
}

function warn(message) {
  log(`⚠ ${message}`, 'yellow');
}

/**
 * Parse .env file
 */
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  
  if (!fs.existsSync(envPath)) {
    error('.env file not found');
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  
  content.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=').replace(/^"(.*)"$/, '$1');
      env[key.trim()] = value;
    }
  });

  return env;
}

/**
 * Parse DATABASE_URL to extract credentials
 * Format: postgresql://user:password@host:port/database?schema=public
 */
function parseDatabaseUrl(dbUrl) {
  try {
    const parsed = new url.URL(dbUrl);
    
    return {
      username: decodeURIComponent(parsed.username) || 'postgres',
      password: decodeURIComponent(parsed.password) || '',
      host: parsed.hostname || 'localhost',
      port: parsed.port || 5432,
      database: parsed.pathname.replace(/^\//, '') || 'imaps_db',
    };
  } catch (err) {
    error(`Invalid DATABASE_URL format: ${err.message}`);
  }
}

/**
 * Execute SQL command
 */
function executeSql(sql, options = {}) {
  const {
    host = 'localhost',
    port = 5432,
    user = 'postgres',
    password = '',
    database = 'postgres',
  } = options;

  let cmd = `PGPASSWORD="${password}" psql -h ${host} -p ${port} -U ${user} -d ${database}`;
  
  try {
    execSync(`echo "${sql.replace(/"/g, '\\"')}" | ${cmd}`, {
      stdio: 'inherit',
      shell: '/bin/bash',
    });
  } catch (err) {
    throw err;
  }
}

/**
 * Main initialization function
 */
async function initializeDatabase() {
  log('\n========================================', 'cyan');
  log('  iMAPS Database Initialization', 'cyan');
  log('========================================\n', 'cyan');

  // Load environment variables
  info('Reading .env file...');
  const env = loadEnv();
  const dbUrl = env.DATABASE_URL;

  if (!dbUrl) {
    error('DATABASE_URL not found in .env file');
  }

  info(`Database URL: ${dbUrl}`);

  // Parse database credentials
  const dbCredentials = parseDatabaseUrl(dbUrl);
  info(`Parsed credentials:`);
  info(`  Host: ${dbCredentials.host}`);
  info(`  Port: ${dbCredentials.port}`);
  info(`  Database: ${dbCredentials.database}`);
  info(`  User: ${dbCredentials.username}`);

  const {
    host,
    port,
    username: appUser,
    password: appPassword,
    database: dbName,
  } = dbCredentials;

  // Prepare SQL initialization script
  const sqlScript = `
-- ============================================================================
-- iMAPS DATABASE INITIALIZATION SCRIPT (AUTO-GENERATED)
-- ============================================================================
-- Generated from: .env DATABASE_URL
-- Generated at: ${new Date().toISOString()}
-- ============================================================================

\\c postgres

-- ============================================================================
-- 1. DROP EXISTING DATABASE (CAUTION: This deletes all data!)
-- ============================================================================

SELECT pg_terminate_backend(pg_stat_activity.pid)
FROM pg_stat_activity
WHERE pg_stat_activity.datname = '${dbName}'
  AND pid <> pg_backend_pid();

DROP DATABASE IF EXISTS ${dbName};
DROP USER IF EXISTS ${appUser};

-- ============================================================================
-- 2. CREATE APPLICATION USER
-- ============================================================================

CREATE USER ${appUser} WITH PASSWORD '${appPassword.replace(/'/g, "''")}'';
ALTER USER ${appUser} CREATEDB;

-- ============================================================================
-- 3. CREATE DATABASE
-- ============================================================================

CREATE DATABASE ${dbName}
    WITH 
    OWNER = ${appUser}
    ENCODING = 'UTF8'
    LC_COLLATE = 'C.UTF-8'
    LC_CTYPE = 'C.UTF-8'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1
    TEMPLATE = template0;

COMMENT ON DATABASE ${dbName} IS 'iMAPS - Integrated Material and Production System for Bonded Zone compliance';

-- ============================================================================
-- 4. CONNECT TO NEW DATABASE AND SETUP EXTENSIONS
-- ============================================================================

\\c ${dbName}

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ============================================================================
-- 5. GRANT SCHEMA PRIVILEGES
-- ============================================================================

GRANT ALL ON SCHEMA public TO ${appUser};
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${appUser};
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${appUser};
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO ${appUser};

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL ON TABLES TO ${appUser};

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL ON SEQUENCES TO ${appUser};

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL ON FUNCTIONS TO ${appUser};

REASSIGN OWNED BY postgres TO ${appUser};

-- ============================================================================
-- 6. SETUP DATABASE PARAMETERS
-- ============================================================================

ALTER DATABASE ${dbName} SET timezone = 'Asia/Jakarta';

-- ============================================================================
-- 7. VERIFY SETUP
-- ============================================================================

SELECT 
    datname as database,
    pg_encoding_to_char(encoding) as encoding,
    datcollate as collate,
    datctype as ctype,
    pg_size_pretty(pg_database_size(datname)) as size
FROM pg_database
WHERE datname = '${dbName}';

SELECT * FROM pg_extension WHERE extname IN ('uuid-ossp', 'pg_trgm');

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

\\echo ''
\\echo '========================================================================='
\\echo 'DATABASE INITIALIZATION COMPLETED SUCCESSFULLY!'
\\echo '========================================================================='
\\echo ''
\\echo 'Database:     ${dbName}'
\\echo 'Owner:        ${appUser}'
\\echo 'Host:         ${host}'
\\echo 'Port:         ${port}'
\\echo 'Encoding:     UTF8'
\\echo 'Timezone:     Asia/Jakarta'
\\echo ''
\\echo 'Next steps:'
\\echo '  1. Run: npx prisma generate'
\\echo '  2. Run: npx prisma db push --force-reset'
\\echo '  3. Run: sudo -u postgres psql -d ${dbName} -f scripts/sql/01_setup_partitions.sql'
\\echo '  4. Run: sudo -u postgres psql -d ${dbName} -f scripts/sql/03_functions.sql'
\\echo '  5. Run: sudo -u postgres psql -d ${dbName} -f scripts/sql/04_create_views.sql'
\\echo '  6. Run: sudo -u postgres psql -d ${dbName} -f scripts/sql/05_permissions.sql'
\\echo '  7. Run: npm run seed'
\\echo ''
\\echo '========================================================================='
\\echo ''
  `;

  // Save the generated SQL script temporarily
  const tmpSqlFile = path.join(process.cwd(), '.tmp-init-database.sql');
  fs.writeFileSync(tmpSqlFile, sqlScript);
  info(`Generated SQL script: ${tmpSqlFile}`);

  try {
    // Execute the SQL script
    info('Executing database initialization...');
    const cmd = `sudo -u postgres psql -h ${host} -p ${port} -f ${tmpSqlFile}`;
    execSync(cmd, { stdio: 'inherit' });
    
    success('Database initialization completed!');
    
  } catch (err) {
    error(`Database initialization failed: ${err.message}`);
  } finally {
    // Clean up temporary file
    if (fs.existsSync(tmpSqlFile)) {
      fs.unlinkSync(tmpSqlFile);
      info('Cleaned up temporary SQL file');
    }
  }

  log('\n========================================', 'cyan');
  log('  Database is ready for next steps', 'cyan');
  log('========================================\n', 'cyan');
}

// Run the initialization
initializeDatabase().catch(err => {
  error(err.message);
});
