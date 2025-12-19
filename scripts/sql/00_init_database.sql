-- ============================================================================
-- iMAPS DATABASE INITIALIZATION SCRIPT
-- ============================================================================
-- Purpose: Complete database setup from scratch
-- Run this as postgres superuser FIRST before any other scripts
-- Usage: sudo -u postgres psql -f prisma/00_init_database.sql
-- ============================================================================

-- Connect to default postgres database to create new database
\c postgres

-- ============================================================================
-- 1. DROP EXISTING DATABASE (CAUTION: This deletes all data!)
-- ============================================================================

-- Terminate all connections to the database
SELECT pg_terminate_backend(pg_stat_activity.pid)
FROM pg_stat_activity
WHERE pg_stat_activity.datname = 'imaps_db'
  AND pid <> pg_backend_pid();

-- Drop database if exists
DROP DATABASE IF EXISTS imaps_db;

-- Drop user if exists
DROP USER IF EXISTS appuser;

-- ============================================================================
-- 2. CREATE APPLICATION USER
-- ============================================================================

-- Create user with password
CREATE USER appuser WITH PASSWORD 'devpassword';

-- Grant privileges to create databases (needed for testing)
ALTER USER appuser CREATEDB;

-- ============================================================================
-- 3. CREATE DATABASE
-- ============================================================================

-- Create database with proper settings
CREATE DATABASE imaps_db
    WITH 
    OWNER = appuser
    ENCODING = 'UTF8'
    LC_COLLATE = 'en_US.UTF-8'
    LC_CTYPE = 'en_US.UTF-8'
    TABLESPACE = pg_default
    CONNECTION LIMIT = -1
    TEMPLATE = template0;

-- Add comment
COMMENT ON DATABASE imaps_db IS 'iMAPS - Integrated Material and Production System for Bonded Zone compliance';

-- ============================================================================
-- 4. CONNECT TO NEW DATABASE AND SETUP EXTENSIONS
-- ============================================================================

\c imaps_db

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";  -- For text search optimization

-- ============================================================================
-- 5. GRANT SCHEMA PRIVILEGES
-- ============================================================================

-- Grant usage on public schema
GRANT ALL ON SCHEMA public TO appuser;

-- Grant all privileges on all objects in public schema
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO appuser;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO appuser;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO appuser;

-- Set default privileges for FUTURE objects created by any user
-- This ensures that objects created by scripts will be accessible by appuser
ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL ON TABLES TO appuser;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL ON SEQUENCES TO appuser;

ALTER DEFAULT PRIVILEGES IN SCHEMA public 
    GRANT ALL ON FUNCTIONS TO appuser;

-- IMPORTANT: Reassign ownership of ALL existing and future objects to appuser
-- This prevents "must be owner of table" errors when executing functions
-- as the appuser
REASSIGN OWNED BY postgres TO appuser;

-- ============================================================================
-- 6. CREATE CUSTOM TYPES/ENUMS (if needed before Prisma)
-- ============================================================================

-- Note: Prisma will create most enums, but we can create custom ones here if needed
-- Example:
-- CREATE TYPE custom_status AS ENUM ('pending', 'approved', 'rejected');

-- ============================================================================
-- 7. SETUP DATABASE PARAMETERS
-- ============================================================================

-- Set timezone
ALTER DATABASE imaps_db SET timezone = 'Asia/Jakarta';

-- NOTE: Other parameters below can only be set with server restart
-- Uncomment and apply if needed:
-- ALTER DATABASE imaps_db SET synchronous_commit = 'off';  -- For development only!
-- ALTER DATABASE imaps_db SET shared_buffers = '256MB';
-- ALTER DATABASE imaps_db SET effective_cache_size = '1GB';
-- ALTER DATABASE imaps_db SET maintenance_work_mem = '128MB';
-- ALTER DATABASE imaps_db SET checkpoint_completion_target = 0.9;
-- ALTER DATABASE imaps_db SET wal_buffers = '16MB';
-- ALTER DATABASE imaps_db SET default_statistics_target = 100;
-- ALTER DATABASE imaps_db SET random_page_cost = 1.1;

-- ============================================================================
-- 8. VERIFY SETUP
-- ============================================================================

-- Show database info
SELECT 
    datname as database,
    pg_encoding_to_char(encoding) as encoding,
    datcollate as collate,
    datctype as ctype,
    pg_size_pretty(pg_database_size(datname)) as size
FROM pg_database
WHERE datname = 'imaps_db';

-- Show user privileges
SELECT 
    grantee,
    privilege_type
FROM information_schema.table_privileges
WHERE grantee = 'appuser'
  AND table_schema = 'public';

-- Show installed extensions
SELECT * FROM pg_extension WHERE extname IN ('uuid-ossp', 'pg_trgm');

-- ============================================================================
-- SUCCESS MESSAGE
-- ============================================================================

\echo ''
\echo '========================================================================='
\echo 'DATABASE INITIALIZATION COMPLETED SUCCESSFULLY!'
\echo '========================================================================='
\echo ''
\echo 'Database:     imaps_db'
\echo 'Owner:        appuser'
\echo 'Password:     devpassword'
\echo 'Encoding:     UTF8'
\echo 'Timezone:     Asia/Jakarta'
\echo ''
\echo 'Next steps:'
\echo '  1. Update .env file with DATABASE_URL'
\echo '  2. Run: npx prisma generate'
\echo '  3. Run: npx prisma db push --force-reset'
\echo '  4. Run: sudo -u postgres psql -d imaps_db -f prisma/setup_partitions_fixed.sql'
\echo '  5. Run: npx prisma db push'
\echo '  6. Run: sudo -u postgres psql -d imaps_db -f prisma/05_traceability_tables.sql'
\echo '  7. Run: sudo -u postgres psql -d imaps_db -f prisma/08_functions.sql'
\echo '  8. Run: sudo -u postgres psql -d imaps_db -f prisma/create_views.sql'
\echo '  9. Run: npm run seed'
\echo ''
\echo '========================================================================='
\echo ''

-- ============================================================================
-- NOTES
-- ============================================================================

-- Production Settings (uncomment for production):
-- ALTER DATABASE imaps_db SET synchronous_commit = 'on';  -- Enable for production!
-- ALTER DATABASE imaps_db SET shared_buffers = '2GB';     -- Adjust based on server RAM
-- ALTER DATABASE imaps_db SET effective_cache_size = '6GB';
-- ALTER DATABASE imaps_db SET maintenance_work_mem = '512MB';

-- ============================================================================
-- END OF INITIALIZATION SCRIPT
-- ============================================================================
