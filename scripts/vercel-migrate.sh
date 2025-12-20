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
    echo "Running Prisma migrations..."

    if [ "$VERCEL_ENV" = "production" ]; then
        echo "Production mode: Using prisma migrate deploy"
        npx prisma migrate deploy
    else
        echo "Non-production mode: Using prisma db push"
        npx prisma db push --skip-generate
    fi
}

# Function to check if custom SQL needs to run
needs_custom_sql() {
    # Check if partitions are set up (check for incoming_goods_1370 partition)
    psql "$DATABASE_URL" -tc "SELECT 1 FROM information_schema.tables WHERE table_name='incoming_goods_1370'" | grep -q 1

    if [ $? -eq 0 ]; then
        echo "Partitions already exist, skipping partitioning setup"
        return 1
    else
        echo "Partitions not found, will run partitioning setup"
        return 0
    fi
}

# Function to run custom SQL (partitions, functions, views)
run_custom_sql() {
    echo "Running custom SQL scripts..."

    # Only run if partitions don't exist yet
    if needs_custom_sql; then
        echo "Applying partitions for traceability tables..."
        psql "$DATABASE_URL" -f scripts/sql/01_setup_partitions.sql || echo "Warning: Partitions may already exist"

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
