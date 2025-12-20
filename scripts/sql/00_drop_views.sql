-- ============================================================================
-- DROP ALL VIEWS
-- ============================================================================
-- Description: Drops all iMAPS views before recreation
-- ============================================================================

-- Drop views in reverse order of dependencies
DROP VIEW IF EXISTS vw_lpj_barang_sisa CASCADE;
DROP VIEW IF EXISTS vw_lpj_barang_modal CASCADE;
DROP VIEW IF EXISTS vw_lpj_wip CASCADE;
DROP VIEW IF EXISTS vw_lpj_hasil_produksi CASCADE;
DROP VIEW IF EXISTS vw_lpj_bahan_baku CASCADE;
DROP VIEW IF EXISTS vw_laporan_pengeluaran CASCADE;
DROP VIEW IF EXISTS vw_laporan_pemasukan CASCADE;

-- Drop functions if they exist
DROP FUNCTION IF EXISTS fn_calculate_lpj_mutation(TEXT[]) CASCADE;

-- Success message
SELECT 'All views and functions dropped successfully' AS status;
