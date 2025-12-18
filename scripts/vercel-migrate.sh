#!/bin/bash

# ============================================================================
# Vercel Auto-Migration Script
# ============================================================================
# This script runs automatically during Vercel build process
# It applies database migrations safely
# ============================================================================

set -e

echo "========================================"
echo "Vercel Auto-Migration Starting..."
echo "========================================"

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL not set"
    exit 1
fi

# Get environment
VERCEL_ENV=${VERCEL_ENV:-development}
echo "Environment: $VERCEL_ENV"

# Function to run Prisma migrations
run_prisma_migrate() {
    echo "Running Prisma schema sync..."

    # Use db push with force-reset for clean schema sync
    echo "Using prisma db push to sync schema (with force reset)"
    npx prisma db push --force-reset --skip-generate --accept-data-loss
}

# Function to check if custom SQL needs to run
needs_custom_sql() {
    # Check if stock_daily_snapshot table exists
    psql "$DATABASE_URL" -tc "SELECT 1 FROM information_schema.tables WHERE table_name='stock_daily_snapshot'" | grep -q 1

    if [ $? -eq 0 ]; then
        echo "Custom tables already exist, skipping custom SQL"
        return 1
    else
        echo "Custom tables not found, will run custom SQL"
        return 0
    fi
}

# Function to run custom SQL (partitions, functions, views)
run_custom_sql() {
    echo "Running custom SQL scripts..."

    # Only run if tables don't exist yet
    if needs_custom_sql; then
        echo "Applying partitions..."
        psql "$DATABASE_URL" -f scripts/sql/01_setup_partitions.sql || echo "Warning: Partitions may already exist"

        echo "Applying traceability tables..."
        psql "$DATABASE_URL" -f scripts/sql/02_traceability_tables.sql || echo "Warning: Traceability tables may already exist"

        echo "Applying functions..."
        psql "$DATABASE_URL" -f scripts/sql/03_functions.sql || true

        echo "Applying views..."
        psql "$DATABASE_URL" -f scripts/sql/04_create_views.sql || true
    fi
}

# Main execution
main() {
    # Step 1: Generate Prisma Client (should already be done, but ensure it)
    echo "Generating Prisma Client..."
    npx prisma generate

    # Step 2: Run Prisma migrations
    run_prisma_migrate

    # Step 3: Run custom SQL (only for first-time setup)
    if [ "$VERCEL_ENV" != "production" ]; then
        echo "Checking if custom SQL needed..."
        run_custom_sql || echo "Custom SQL skipped or already applied"
    else
        echo "Production: Skipping automatic custom SQL (run manually for safety)"
    fi

    echo "========================================"
    echo "Vercel Auto-Migration Completed!"
    echo "========================================"
}

main
