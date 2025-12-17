#!/bin/bash

# ============================================================================
# Vercel Build Script
# ============================================================================
# This script runs during Vercel build process
# Order: install -> build -> this script (if configured)
# ============================================================================

set -e

echo "========================================"
echo "Starting Vercel Build Process..."
echo "========================================"

# Environment info
echo "Node version: $(node --version)"
echo "NPM version: $(npm --version)"
echo "Environment: ${VERCEL_ENV:-unknown}"

# Step 1: Run migrations (if DATABASE_URL is available)
if [ -n "$DATABASE_URL" ]; then
    echo ""
    echo "Database URL found, running migrations..."
    chmod +x scripts/vercel-migrate.sh
    ./scripts/vercel-migrate.sh
else
    echo ""
    echo "WARNING: DATABASE_URL not set, skipping migrations"
    echo "This is expected for build preview without database"
fi

# Step 2: Build Next.js application
echo ""
echo "Building Next.js application..."
npm run build

# Step 3: Seed database (if needed)
if [ -n "$DATABASE_URL" ]; then
    echo ""
    echo "Seeding database..."
    npm run seed || echo "Seeding skipped or already completed"
else
    echo ""
    echo "Skipping database seeding (no DATABASE_URL)"
fi

echo ""
echo "========================================"
echo "Vercel Build Completed Successfully!"
echo "========================================"
