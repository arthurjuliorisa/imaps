#!/bin/bash
set -e

echo "Deploying Materialized Views v2.0..."

# Check DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "ERROR: DATABASE_URL environment variable is not set"
    exit 1
fi

# Deploy views
echo "Executing materialized-views-v2.sql..."
psql $DATABASE_URL -f lib/db/materialized-views-v2.sql

echo "Creating unique indexes for CONCURRENT refresh..."

# Add unique indexes for each view
psql $DATABASE_URL <<EOF
-- mv_laporan_pemasukan
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_laporan_pemasukan_unique
ON mv_laporan_pemasukan (company_code, ppkek_number, item_code, incoming_date);

-- mv_laporan_pengeluaran
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_laporan_pengeluaran_unique
ON mv_laporan_pengeluaran (company_code, ppkek_number, item_code, outgoing_date);

-- mv_mutasi_bahan_baku
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mutasi_bahan_baku_unique
ON mv_mutasi_bahan_baku (company_code, item_code, snapshot_date);

-- mv_posisi_wip
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_posisi_wip_unique
ON mv_posisi_wip (company_code, item_code, snapshot_date);

-- mv_mutasi_finished_goods
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mutasi_finished_goods_unique
ON mv_mutasi_finished_goods (company_code, item_code, snapshot_date);

-- mv_mutasi_capital_goods
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mutasi_capital_goods_unique
ON mv_mutasi_capital_goods (company_code, item_type_code, item_code, snapshot_date);

-- mv_mutasi_scrap
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_mutasi_scrap_unique
ON mv_mutasi_scrap (company_code, item_code, snapshot_date);
EOF

echo "Refreshing all views..."
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_laporan_pemasukan;"
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_laporan_pengeluaran;"
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mutasi_bahan_baku;"
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_posisi_wip;"
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mutasi_finished_goods;"
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mutasi_capital_goods;"
psql $DATABASE_URL -c "REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mutasi_scrap;"

echo "Materialized Views deployment completed successfully!"
