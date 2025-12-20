#!/bin/bash

# ============================================================================
# iMAPS Production Database Deployment Script
# ============================================================================
# Version: 1.0
# Description: Automated deployment script for iMAPS database setup
# Usage: ./scripts/deploy.sh [--env=production] [--skip-init] [--skip-seed]
# ============================================================================

set -e  # Exit on error
set -u  # Exit on undefined variable

# ============================================================================
# CONFIGURATION
# ============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
SQL_DIR="${SCRIPT_DIR}/sql"
LOG_DIR="${PROJECT_ROOT}/logs/deployment"
LOG_FILE="${LOG_DIR}/deploy_$(date +%Y%m%d_%H%M%S).log"

# Default values
ENVIRONMENT="development"
SKIP_INIT=false
SKIP_SEED=false
DB_NAME="imaps_db"
DB_USER="appuser"

# ============================================================================
# COLORS FOR OUTPUT
# ============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

log() {
    local level=$1
    shift
    local message="$@"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo -e "[${timestamp}] [${level}] ${message}" | tee -a "${LOG_FILE}"
}

info() {
    log "INFO" "${BLUE}$@${NC}"
}

success() {
    log "SUCCESS" "${GREEN}$@${NC}"
}

warning() {
    log "WARNING" "${YELLOW}$@${NC}"
}

error() {
    log "ERROR" "${RED}$@${NC}"
}

fatal() {
    error "$@"
    exit 1
}

# ============================================================================
# PARSE ARGUMENTS
# ============================================================================

parse_args() {
    for arg in "$@"; do
        case $arg in
            --env=*)
                ENVIRONMENT="${arg#*=}"
                shift
                ;;
            --skip-init)
                SKIP_INIT=true
                shift
                ;;
            --skip-seed)
                SKIP_SEED=true
                shift
                ;;
            --help)
                show_help
                exit 0
                ;;
            *)
                warning "Unknown argument: $arg"
                ;;
        esac
    done
}

show_help() {
    cat <<EOF
iMAPS Database Deployment Script

Usage: ./scripts/deploy.sh [OPTIONS]

Options:
    --env=ENV           Set environment (development|production) [default: development]
    --skip-init         Skip database initialization (use for existing databases)
    --skip-seed         Skip data seeding
    --help              Show this help message

Examples:
    # Full deployment (development)
    ./scripts/deploy.sh

    # Production deployment
    ./scripts/deploy.sh --env=production

    # Deploy without reinitializing database
    ./scripts/deploy.sh --skip-init

    # Deploy without seeding data
    ./scripts/deploy.sh --skip-seed

Environment Variables:
    DATABASE_URL        PostgreSQL connection string
    POSTGRES_USER       PostgreSQL superuser (default: postgres)
    POSTGRES_PASSWORD   PostgreSQL superuser password

EOF
}

# ============================================================================
# PREREQUISITES CHECK
# ============================================================================

check_prerequisites() {
    info "Checking prerequisites..."

    # Check if we're in the right directory
    if [[ ! -f "${PROJECT_ROOT}/package.json" ]]; then
        fatal "Error: Not in project root directory. Please run from project root."
    fi

    # Check for required commands
    local required_commands=("psql" "node" "npm")
    for cmd in "${required_commands[@]}"; do
        if ! command -v $cmd &> /dev/null; then
            fatal "Error: Required command '$cmd' not found. Please install it first."
        fi
    done

    # Check for SQL files
    local required_sql_files=(
        "00_init_database.sql"
        "01_setup_partitions.sql"
        "03_functions.sql"
        "04_create_views.sql"
    )
    for sql_file in "${required_sql_files[@]}"; do
        if [[ ! -f "${SQL_DIR}/${sql_file}" ]]; then
            fatal "Error: Required SQL file '${sql_file}' not found in ${SQL_DIR}"
        fi
    done

    # Check for .env file
    if [[ ! -f "${PROJECT_ROOT}/.env" ]]; then
        warning ".env file not found. Make sure DATABASE_URL is set in environment."
    fi

    # Check PostgreSQL connection
    if [[ -z "${DATABASE_URL:-}" ]]; then
        warning "DATABASE_URL not set. Using default connection settings."
    fi

    success "Prerequisites check passed"
}

# ============================================================================
# DATABASE INITIALIZATION
# ============================================================================

init_database() {
    if [[ "$SKIP_INIT" == true ]]; then
        warning "Skipping database initialization (--skip-init flag)"
        return 0
    fi

    info "Initializing database..."

    # Set postgres user from environment or use default
    local POSTGRES_USER="${POSTGRES_USER:-postgres}"

    # Run init script
    if PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -U "${POSTGRES_USER}" -f "${SQL_DIR}/00_init_database.sql" >> "${LOG_FILE}" 2>&1; then
        success "Database initialized successfully"
    else
        fatal "Failed to initialize database. Check ${LOG_FILE} for details."
    fi
}

# ============================================================================
# PRISMA OPERATIONS
# ============================================================================

run_prisma_generate() {
    info "Running Prisma generate..."

    if npx prisma generate >> "${LOG_FILE}" 2>&1; then
        success "Prisma client generated successfully"
    else
        fatal "Failed to generate Prisma client. Check ${LOG_FILE} for details."
    fi
}

run_prisma_push() {
    info "Running Prisma db push..."

    local prisma_args="db push"
    if [[ "$ENVIRONMENT" == "development" ]]; then
        prisma_args="$prisma_args --force-reset"
        warning "Using --force-reset (development mode)"
    else
        warning "Production mode: No force-reset. Migrations will be applied incrementally."
    fi

    if npx prisma $prisma_args >> "${LOG_FILE}" 2>&1; then
        success "Prisma schema pushed successfully"
    else
        fatal "Failed to push Prisma schema. Check ${LOG_FILE} for details."
    fi
}

# ============================================================================
# SQL SCRIPTS EXECUTION
# ============================================================================

execute_sql_script() {
    local script_name=$1
    local script_path="${SQL_DIR}/${script_name}"

    info "Executing ${script_name}..."

    if PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -U "${DB_USER}" -d "${DB_NAME}" -f "${script_path}" >> "${LOG_FILE}" 2>&1; then
        success "${script_name} executed successfully"
        return 0
    else
        error "Failed to execute ${script_name}. Check ${LOG_FILE} for details."
        return 1
    fi
}

setup_partitions() {
    info "Setting up table partitions..."
    execute_sql_script "01_setup_partitions.sql" || fatal "Failed to setup partitions"
}

create_functions() {
    info "Creating database functions..."
    execute_sql_script "03_functions.sql" || fatal "Failed to create functions"
}

create_views() {
    info "Creating database views..."
    execute_sql_script "04_create_views.sql" || fatal "Failed to create views"
}

# ============================================================================
# DATA SEEDING
# ============================================================================

seed_database() {
    if [[ "$SKIP_SEED" == true ]]; then
        warning "Skipping database seeding (--skip-seed flag)"
        return 0
    fi

    info "Seeding database..."

    if npm run seed >> "${LOG_FILE}" 2>&1; then
        success "Database seeded successfully"
    else
        fatal "Failed to seed database. Check ${LOG_FILE} for details."
    fi
}

# ============================================================================
# POST-DEPLOYMENT VERIFICATION
# ============================================================================

verify_deployment() {
    info "Verifying deployment..."

    # Check if key tables exist
    local tables=("companies" "items" "users" "incoming_goods" "outgoing_goods" "stock_daily_snapshot")
    for table in "${tables[@]}"; do
        if PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -U "${DB_USER}" -d "${DB_NAME}" -tc "SELECT 1 FROM ${table} LIMIT 1" &> /dev/null; then
            success "Table '${table}' verified"
        else
            warning "Table '${table}' may not exist or is empty"
        fi
    done

    # Check if functions exist
    local functions=("calculate_stock_snapshot" "populate_work_order_material_consumption" "populate_work_order_fg_production")
    for func in "${functions[@]}"; do
        if PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -U "${DB_USER}" -d "${DB_NAME}" -tc "SELECT 1 FROM pg_proc WHERE proname = '${func}'" &> /dev/null; then
            success "Function '${func}' verified"
        else
            warning "Function '${func}' may not exist"
        fi
    done

    # Check if views exist
    local views=("vw_laporan_pemasukan" "vw_laporan_pengeluaran" "vw_lpj_bahan_baku")
    for view in "${views[@]}"; do
        if PGPASSWORD="${POSTGRES_PASSWORD:-}" psql -U "${DB_USER}" -d "${DB_NAME}" -tc "SELECT 1 FROM pg_views WHERE viewname = '${view}'" &> /dev/null; then
            success "View '${view}' verified"
        else
            warning "View '${view}' may not exist"
        fi
    done
}

# ============================================================================
# MAIN DEPLOYMENT WORKFLOW
# ============================================================================

main() {
    info "============================================================================"
    info "iMAPS Database Deployment"
    info "============================================================================"
    info "Environment: ${ENVIRONMENT}"
    info "Skip Init: ${SKIP_INIT}"
    info "Skip Seed: ${SKIP_SEED}"
    info "Log File: ${LOG_FILE}"
    info "============================================================================"

    # Create log directory
    mkdir -p "${LOG_DIR}"

    # Parse arguments
    parse_args "$@"

    # Run deployment steps
    check_prerequisites

    # Step 1: Initialize database (optional)
    init_database

    # Step 2: Generate Prisma client
    run_prisma_generate

    # Step 3: Push Prisma schema (includes traceability tables)
    run_prisma_push

    # Step 4: Setup partitions
    setup_partitions

    # Step 5: Create functions
    create_functions

    # Step 6: Create views
    create_views

    # Step 7: Seed database (optional)
    seed_database

    # Step 8: Verify deployment
    verify_deployment

    info "============================================================================"
    success "Deployment completed successfully!"
    info "============================================================================"
    info "Next steps:"
    info "  1. Verify the application can connect to the database"
    info "  2. Run the application: npm run dev"
    info "  3. Check the logs: tail -f ${LOG_FILE}"
    info "============================================================================"
}

# ============================================================================
# RUN SCRIPT
# ============================================================================

main "$@"
