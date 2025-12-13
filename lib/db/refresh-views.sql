-- ============================================================================
-- REFRESH ALL MATERIALIZED VIEWS
-- ============================================================================
-- This script refreshes all 7 materialized views used for Indonesian customs
-- compliance reporting. It can be run manually or scheduled via cron/pg_cron.
--
-- Usage:
-- 1. Manual refresh: psql -d your_db -f refresh-views.sql
-- 2. Via API: POST /api/admin/refresh-views
-- 3. Scheduled: Add to pg_cron or external scheduler
--
-- Options:
-- - CONCURRENTLY: Allows reads during refresh (requires unique index)
-- - Without CONCURRENTLY: Faster but locks the view during refresh
--
-- Note: CONCURRENTLY refresh requires a unique index on each view
-- ============================================================================

-- Start timing
\timing on

-- ============================================================================
-- 1. REFRESH LAPORAN PEMASUKAN (INCOMING REPORT)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Refreshing mv_laporan_pemasukan (Incoming Report)...';
    RAISE NOTICE '============================================================================';
END $$;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_laporan_pemasukan;

DO $$
DECLARE
    row_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO row_count FROM mv_laporan_pemasukan;
    RAISE NOTICE 'Successfully refreshed mv_laporan_pemasukan. Total rows: %', row_count;
END $$;

-- ============================================================================
-- 2. REFRESH LAPORAN PENGELUARAN (OUTGOING REPORT)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Refreshing mv_laporan_pengeluaran (Outgoing Report)...';
    RAISE NOTICE '============================================================================';
END $$;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_laporan_pengeluaran;

DO $$
DECLARE
    row_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO row_count FROM mv_laporan_pengeluaran;
    RAISE NOTICE 'Successfully refreshed mv_laporan_pengeluaran. Total rows: %', row_count;
END $$;

-- ============================================================================
-- 3. REFRESH MUTASI BAHAN BAKU (RAW MATERIAL MUTATION)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Refreshing mv_mutasi_bahan_baku (Raw Material Mutation)...';
    RAISE NOTICE '============================================================================';
END $$;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mutasi_bahan_baku;

DO $$
DECLARE
    row_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO row_count FROM mv_mutasi_bahan_baku;
    RAISE NOTICE 'Successfully refreshed mv_mutasi_bahan_baku. Total rows: %', row_count;
END $$;

-- ============================================================================
-- 4. REFRESH POSISI WIP (WIP POSITION)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Refreshing mv_posisi_wip (WIP Position)...';
    RAISE NOTICE '============================================================================';
END $$;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_posisi_wip;

DO $$
DECLARE
    row_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO row_count FROM mv_posisi_wip;
    RAISE NOTICE 'Successfully refreshed mv_posisi_wip. Total rows: %', row_count;
END $$;

-- ============================================================================
-- 5. REFRESH MUTASI FINISHED GOODS (FINISHED GOODS MUTATION)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Refreshing mv_mutasi_finished_goods (Finished Goods Mutation)...';
    RAISE NOTICE '============================================================================';
END $$;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mutasi_finished_goods;

DO $$
DECLARE
    row_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO row_count FROM mv_mutasi_finished_goods;
    RAISE NOTICE 'Successfully refreshed mv_mutasi_finished_goods. Total rows: %', row_count;
END $$;

-- ============================================================================
-- 6. REFRESH MUTASI CAPITAL GOODS (CAPITAL GOODS MUTATION)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Refreshing mv_mutasi_capital_goods (Capital Goods Mutation)...';
    RAISE NOTICE '============================================================================';
END $$;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mutasi_capital_goods;

DO $$
DECLARE
    row_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO row_count FROM mv_mutasi_capital_goods;
    RAISE NOTICE 'Successfully refreshed mv_mutasi_capital_goods. Total rows: %', row_count;
END $$;

-- ============================================================================
-- 7. REFRESH MUTASI SCRAP (SCRAP MUTATION)
-- ============================================================================

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Refreshing mv_mutasi_scrap (Scrap Mutation)...';
    RAISE NOTICE '============================================================================';
END $$;

REFRESH MATERIALIZED VIEW CONCURRENTLY mv_mutasi_scrap;

DO $$
DECLARE
    row_count BIGINT;
BEGIN
    SELECT COUNT(*) INTO row_count FROM mv_mutasi_scrap;
    RAISE NOTICE 'Successfully refreshed mv_mutasi_scrap. Total rows: %', row_count;
END $$;

-- ============================================================================
-- ANALYZE UPDATED VIEWS
-- ============================================================================
-- Update statistics for query optimizer after refresh

DO $$
BEGIN
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Analyzing materialized views for query optimization...';
    RAISE NOTICE '============================================================================';
END $$;

ANALYZE mv_laporan_pemasukan;
ANALYZE mv_laporan_pengeluaran;
ANALYZE mv_mutasi_bahan_baku;
ANALYZE mv_posisi_wip;
ANALYZE mv_mutasi_finished_goods;
ANALYZE mv_mutasi_capital_goods;
ANALYZE mv_mutasi_scrap;

-- ============================================================================
-- COMPLETION SUMMARY
-- ============================================================================

DO $$
DECLARE
    v_pemasukan BIGINT;
    v_pengeluaran BIGINT;
    v_bahan_baku BIGINT;
    v_wip BIGINT;
    v_finished_goods BIGINT;
    v_capital_goods BIGINT;
    v_scrap BIGINT;
BEGIN
    SELECT COUNT(*) INTO v_pemasukan FROM mv_laporan_pemasukan;
    SELECT COUNT(*) INTO v_pengeluaran FROM mv_laporan_pengeluaran;
    SELECT COUNT(*) INTO v_bahan_baku FROM mv_mutasi_bahan_baku;
    SELECT COUNT(*) INTO v_wip FROM mv_posisi_wip;
    SELECT COUNT(*) INTO v_finished_goods FROM mv_mutasi_finished_goods;
    SELECT COUNT(*) INTO v_capital_goods FROM mv_mutasi_capital_goods;
    SELECT COUNT(*) INTO v_scrap FROM mv_mutasi_scrap;

    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'ALL MATERIALIZED VIEWS REFRESHED SUCCESSFULLY!';
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'View                            | Row Count';
    RAISE NOTICE '--------------------------------|----------';
    RAISE NOTICE 'mv_laporan_pemasukan            | %', v_pemasukan;
    RAISE NOTICE 'mv_laporan_pengeluaran          | %', v_pengeluaran;
    RAISE NOTICE 'mv_mutasi_bahan_baku            | %', v_bahan_baku;
    RAISE NOTICE 'mv_posisi_wip                   | %', v_wip;
    RAISE NOTICE 'mv_mutasi_finished_goods        | %', v_finished_goods;
    RAISE NOTICE 'mv_mutasi_capital_goods         | %', v_capital_goods;
    RAISE NOTICE 'mv_mutasi_scrap                 | %', v_scrap;
    RAISE NOTICE '============================================================================';
    RAISE NOTICE 'Refresh completed at: %', NOW();
    RAISE NOTICE '============================================================================';
END $$;

\timing off
