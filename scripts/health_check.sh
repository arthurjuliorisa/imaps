#!/bin/bash

# ============================================================================
# iMAPS Database Health Check Script
# ============================================================================
# Version: 1.0
# Description: Verifies database deployment and health status
# Usage: ./scripts/health_check.sh
# ============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
DB_NAME="${DB_NAME:-imaps_db}"
DB_USER="${DB_USER:-appuser}"

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

info() {
    echo -e "${BLUE}[INFO]${NC} $@"
}

success() {
    echo -e "${GREEN}[OK]${NC} $@"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $@"
}

error() {
    echo -e "${RED}[ERROR]${NC} $@"
}

# ============================================================================
# HEALTH CHECK FUNCTIONS
# ============================================================================

check_database_connection() {
    info "Checking database connection..."
    if psql -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1;" &> /dev/null; then
        success "Database connection OK"
        return 0
    else
        error "Cannot connect to database"
        return 1
    fi
}

check_tables() {
    info "Checking essential tables..."
    local tables=("companies" "items" "users" "incoming_goods" "outgoing_goods" "material_usages" "production_outputs" "stock_daily_snapshot")
    local failed=0

    for table in "${tables[@]}"; do
        if psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT 1 FROM $table LIMIT 1;" &> /dev/null; then
            success "Table '$table' exists"
        else
            error "Table '$table' missing or empty"
            failed=1
        fi
    done

    return $failed
}

check_partitions() {
    info "Checking partitions..."
    local count=$(psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT COUNT(*) FROM pg_tables WHERE tablename LIKE '%_q%';" 2>/dev/null | tr -d ' ')

    if [[ "$count" -gt 0 ]]; then
        success "Found $count partitions"
        return 0
    else
        warning "No partitions found"
        return 1
    fi
}

check_functions() {
    info "Checking database functions..."
    local functions=("calculate_stock_snapshot" "populate_work_order_material_consumption" "populate_work_order_fg_production" "queue_snapshot_recalculation" "process_recalc_queue")
    local failed=0

    for func in "${functions[@]}"; do
        if psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT 1 FROM pg_proc WHERE proname = '$func';" &> /dev/null; then
            success "Function '$func' exists"
        else
            error "Function '$func' missing"
            failed=1
        fi
    done

    return $failed
}

check_views() {
    info "Checking database views..."
    local views=("vw_laporan_pemasukan" "vw_laporan_pengeluaran" "vw_lpj_bahan_baku" "vw_lpj_wip" "vw_lpj_hasil_produksi" "vw_lpj_barang_modal" "vw_lpj_barang_sisa")
    local failed=0

    for view in "${views[@]}"; do
        if psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT 1 FROM pg_views WHERE viewname = '$view';" &> /dev/null; then
            success "View '$view' exists"
        else
            error "View '$view' missing"
            failed=1
        fi
    done

    return $failed
}

check_master_data() {
    info "Checking master data..."

    local company_count=$(psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT COUNT(*) FROM companies;" 2>/dev/null | tr -d ' ')
    local item_type_count=$(psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT COUNT(*) FROM item_types;" 2>/dev/null | tr -d ' ')
    local user_count=$(psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT COUNT(*) FROM users;" 2>/dev/null | tr -d ' ')

    if [[ "$company_count" -gt 0 ]]; then
        success "Companies: $company_count"
    else
        warning "No companies found"
    fi

    if [[ "$item_type_count" -gt 0 ]]; then
        success "Item types: $item_type_count"
    else
        warning "No item types found"
    fi

    if [[ "$user_count" -gt 0 ]]; then
        success "Users: $user_count"
    else
        warning "No users found"
    fi
}

check_indexes() {
    info "Checking database indexes..."
    local count=$(psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT COUNT(*) FROM pg_indexes WHERE schemaname = 'public';" 2>/dev/null | tr -d ' ')

    if [[ "$count" -gt 0 ]]; then
        success "Found $count indexes"
        return 0
    else
        warning "No indexes found"
        return 1
    fi
}

get_database_size() {
    info "Checking database size..."
    local size=$(psql -U "$DB_USER" -d "$DB_NAME" -tc "SELECT pg_size_pretty(pg_database_size('$DB_NAME'));" 2>/dev/null | tr -d ' ')

    if [[ -n "$size" ]]; then
        success "Database size: $size"
    else
        warning "Could not determine database size"
    fi
}

# ============================================================================
# MAIN
# ============================================================================

main() {
    echo ""
    echo "============================================================================"
    echo "iMAPS Database Health Check"
    echo "============================================================================"
    echo ""

    local total_checks=0
    local passed_checks=0

    # Run checks
    checks=(
        "check_database_connection"
        "check_tables"
        "check_partitions"
        "check_functions"
        "check_views"
        "check_master_data"
        "check_indexes"
        "get_database_size"
    )

    for check in "${checks[@]}"; do
        total_checks=$((total_checks + 1))
        if $check; then
            passed_checks=$((passed_checks + 1))
        fi
        echo ""
    done

    # Summary
    echo "============================================================================"
    if [[ $passed_checks -eq $total_checks ]]; then
        success "Health check passed: $passed_checks/$total_checks checks OK"
        echo "============================================================================"
        exit 0
    else
        warning "Health check completed with warnings: $passed_checks/$total_checks checks OK"
        echo "============================================================================"
        exit 1
    fi
}

main "$@"
