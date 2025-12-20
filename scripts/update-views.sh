#!/bin/bash
# ============================================================================
# Update Database Views Script
# ============================================================================
# Description: Updates PostgreSQL views for iMAPS application
# Usage: ./scripts/update-views.sh
# ============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/sql/04_create_views.sql"

echo "============================================================================"
echo "iMAPS - Update Database Views"
echo "============================================================================"

# Check if SQL file exists
if [ ! -f "$SQL_FILE" ]; then
    echo "ERROR: SQL file not found at $SQL_FILE"
    exit 1
fi

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL not found"
    echo "Please set DATABASE_URL environment variable"
    echo ""
    echo "Example:"
    echo "  export DATABASE_URL='postgresql://user:pass@localhost:5432/imaps_db'"
    echo "  ./scripts/update-views.sh"
    exit 1
fi

echo "Using DATABASE_URL from environment..."

# Parse PostgreSQL URL: postgresql://user:password@host:port/database
if [[ $DATABASE_URL =~ postgresql://([^:]+):([^@]+)@([^:]+):([0-9]+)/(.+) ]]; then
    DB_USER="${BASH_REMATCH[1]}"
    DB_PASSWORD="${BASH_REMATCH[2]}"
    DB_HOST="${BASH_REMATCH[3]}"
    DB_PORT="${BASH_REMATCH[4]}"
    DB_NAME="${BASH_REMATCH[5]}"

    echo "Database: $DB_NAME"
    echo "Host: $DB_HOST:$DB_PORT"
    echo "User: $DB_USER"

    # Set PGPASSWORD environment variable
    export PGPASSWORD="$DB_PASSWORD"

    echo ""
    echo "Executing SQL script..."

    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -f "$SQL_FILE"; then
        echo ""
        echo "============================================================================"
        echo "SUCCESS: Database views updated successfully!"
        echo "============================================================================"
    else
        echo ""
        echo "============================================================================"
        echo "ERROR: Failed to update views"
        echo "============================================================================"
        exit 1
    fi

    # Clear password from environment
    unset PGPASSWORD
else
    echo "ERROR: Invalid DATABASE_URL format"
    echo "Expected format: postgresql://user:password@host:port/database"
    exit 1
fi

echo ""
echo "Done! You can now test the updated endpoints."
