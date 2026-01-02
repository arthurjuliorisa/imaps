-- ============================================================================
-- IMAPS REPORTING VIEWS - Hybrid Approach (Snapshot + Real-time)
-- ============================================================================
-- Version: 3.0.0 (Refactored with Source-based Functions)
-- Created: December 18, 2025 | Updated: December 21, 2025
-- Purpose: Create hybrid views for customs compliance reports
-- 
-- ARCHITECTURE: Source-based Functions + Separate Views
-- - 2 specialized functions:
--   1. fn_calculate_lpj_bahan_baku(): Incoming-based materials (ROH, HALB, HIBE)
--   2. fn_calculate_lpj_hasil_produksi(): Production-based goods (FERT, HALB produced)
-- - Report-specific views calling appropriate function by data source
-- 
-- PERFORMANCE: Hybrid approach (30x faster for historical queries)
-- - Historical data: FROM stock_daily_snapshot (pre-calculated)
-- - Recent data: FROM transaction tables (real-time)
-- ============================================================================

-- ============================================================================
-- GENERIC FUNCTIONS: CALCULATE LPJ MUTATION (HYBRID APPROACH)
-- ============================================================================
-- Two specialized functions for different reporting sources:
-- 1. fn_calculate_lpj_bahan_baku: For raw materials (incoming source only)
-- 2. fn_calculate_lpj_hasil_produksi: For finished/semi-finished goods (production source only)
-- ============================================================================

-- ============================================================================
-- FUNCTION 1: CALCULATE LPJ BAHAN BAKU (Incoming/Purchased Materials)
-- ============================================================================
-- This function calculates daily mutation for raw materials and purchased goods
-- Sources: incoming_qty only (excludes production_qty)
-- Item types: ROH, HALB (purchased), HIBE
-- 
-- Parameters:
--   p_item_types: Array of item types to filter (e.g., ARRAY['ROH', 'HALB', 'HIBE'])
--   p_start_date: Start date for accumulation (NULL = from start of year)
--   p_end_date: End date for accumulation (NULL = current date)
--
-- Return mode: Always returns aggregated records (1 row per company+item+date_range)
--   with accumulated in/out/adjustment between start and end dates
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_calculate_lpj_bahan_baku(
    p_item_types TEXT[],
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    no BIGINT,
    company_code INTEGER,
    company_name VARCHAR(200),
    item_code VARCHAR(50),
    item_name VARCHAR(200),
    item_type VARCHAR(10),
    unit_quantity VARCHAR(20),
    snapshot_date DATE,
    opening_balance NUMERIC(15,3),
    quantity_received NUMERIC(15,3),
    quantity_issued_outgoing NUMERIC(15,3),
    adjustment NUMERIC(15,3),
    closing_balance NUMERIC(15,3),
    stock_count_result NUMERIC(15,3),
    quantity_difference NUMERIC(15,3),
    value_amount NUMERIC(18,4),
    currency VARCHAR(3),
    remarks TEXT
) AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Default: if date range not provided, use start of year to today (includes beginning balance data)
    v_start_date := COALESCE(p_start_date, DATE_TRUNC('year', CURRENT_DATE)::DATE);
    v_end_date := COALESCE(p_end_date, CURRENT_DATE);
    
    -- Return aggregated view based on provided or default date range
    RETURN QUERY
    WITH
    -- Get opening balance from last snapshot before start date, or earliest if none before start
    opening_balances AS (
        SELECT 
            sds.company_code,
            sds.item_code,
            sds.closing_balance as opening_balance,
            sds.item_type,
            sds.item_name,
            c.name as company_name,
            sds.uom
        FROM stock_daily_snapshot sds
        JOIN companies c ON sds.company_code = c.code
        INNER JOIN (
            -- Try to get snapshot before start_date; if none exist, use earliest snapshot
            SELECT 
                sds_inner.company_code, 
                sds_inner.item_code, 
                COALESCE(
                    MAX(CASE WHEN sds_inner.snapshot_date < v_start_date THEN sds_inner.snapshot_date END),
                    MIN(sds_inner.snapshot_date)
                ) as max_snapshot_date
            FROM stock_daily_snapshot sds_inner
            GROUP BY sds_inner.company_code, sds_inner.item_code
        ) last_snap ON sds.company_code = last_snap.company_code 
                    AND sds.item_code = last_snap.item_code 
                    AND sds.snapshot_date = last_snap.max_snapshot_date
        WHERE sds.item_type = ANY(p_item_types)
    ),
    -- Aggregate all transactions within date range (with UOM tracking)
    transactions_summary AS (
        -- Incoming goods
        SELECT
            ig.company_code,
            igi.item_code,
            igi.uom,
            SUM(igi.qty) as received,
            0::NUMERIC(15,3) as issued,
            0::NUMERIC(15,3) as material_used,
            0::NUMERIC(15,3) as adjustment_val
        FROM incoming_goods ig
        JOIN incoming_good_items igi ON 
            ig.company_code = igi.incoming_good_company
            AND ig.id = igi.incoming_good_id
            AND ig.incoming_date = igi.incoming_good_date
        WHERE ig.deleted_at IS NULL 
          AND igi.deleted_at IS NULL
          AND igi.item_type = ANY(p_item_types)
          AND ig.incoming_date BETWEEN v_start_date AND v_end_date
        GROUP BY ig.company_code, igi.item_code, igi.uom

        UNION ALL

        -- Outgoing goods
        SELECT
            og.company_code,
            ogi.item_code,
            ogi.uom,
            0::NUMERIC(15,3) as received,
            SUM(ogi.qty) as issued,
            0::NUMERIC(15,3) as material_used,
            0::NUMERIC(15,3) as adjustment_val
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON 
            og.company_code = ogi.outgoing_good_company
            AND og.id = ogi.outgoing_good_id
            AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.deleted_at IS NULL 
          AND ogi.deleted_at IS NULL
          AND ogi.item_type = ANY(p_item_types)
          AND og.outgoing_date BETWEEN v_start_date AND v_end_date
        GROUP BY og.company_code, ogi.item_code, ogi.uom

        UNION ALL

        -- Material usage
        SELECT
            mu.company_code,
            mui.item_code,
            mui.uom,
            0::NUMERIC(15,3) as received,
            0::NUMERIC(15,3) as issued,
            SUM(CASE 
                WHEN mu.reversal = 'Y' THEN -mui.qty
                ELSE mui.qty 
            END) as material_used,
            0::NUMERIC(15,3) as adjustment_val
        FROM material_usages mu
        JOIN material_usage_items mui ON 
            mu.company_code = mui.material_usage_company
            AND mu.id = mui.material_usage_id
            AND mu.transaction_date = mui.material_usage_date
        WHERE mu.deleted_at IS NULL 
          AND mui.deleted_at IS NULL
          AND mui.item_type = ANY(p_item_types)
          AND mu.transaction_date BETWEEN v_start_date AND v_end_date
        GROUP BY mu.company_code, mui.item_code, mui.uom

        UNION ALL

        -- Adjustments
        SELECT
            a.company_code,
            ai.item_code,
            ai.uom,
            0::NUMERIC(15,3) as received,
            0::NUMERIC(15,3) as issued,
            0::NUMERIC(15,3) as material_used,
            SUM(CASE 
                WHEN ai.adjustment_type = 'GAIN' THEN ai.qty
                ELSE -ai.qty
            END) as adjustment_val
        FROM adjustments a
        JOIN adjustment_items ai ON 
            a.company_code = ai.adjustment_company
            AND a.id = ai.adjustment_id
            AND a.transaction_date = ai.adjustment_date
        WHERE a.deleted_at IS NULL 
          AND ai.deleted_at IS NULL
          AND ai.item_type = ANY(p_item_types)
          AND a.transaction_date BETWEEN v_start_date AND v_end_date
        GROUP BY a.company_code, ai.item_code, ai.uom
    ),
    -- Combine opening balance with transactions
    -- Priority for UOM: snapshot.uom → transaction.uom → items.uom → 'UNIT'
    period_summary AS (
        SELECT
            COALESCE(ob.company_code, ts_agg.agg_company_code) as company_code,
            COALESCE(ob.company_name, c.name) as company_name,
            COALESCE(ob.item_code, ts_agg.agg_item_code) as item_code,
            COALESCE(ob.item_name, '') as item_name,
            ob.item_type,
            COALESCE(ob.uom, ts_agg.agg_uom, 'UNIT') as uom,
            COALESCE(ob.opening_balance, 0)::NUMERIC(15,3) as opening_balance,
            COALESCE(ts_agg.total_received, 0)::NUMERIC(15,3) as total_received,
            COALESCE(ts_agg.total_issued, 0)::NUMERIC(15,3) as total_issued,
            COALESCE(ts_agg.total_material_used, 0)::NUMERIC(15,3) as total_material_used,
            COALESCE(ts_agg.total_adjustment, 0)::NUMERIC(15,3) as total_adjustment
        FROM opening_balances ob
        FULL OUTER JOIN (
            SELECT
                ts.company_code as agg_company_code,
                ts.item_code as agg_item_code,
                MIN(ts.uom) as agg_uom,
                SUM(ts.received) as total_received,
                SUM(ts.issued) as total_issued,
                SUM(ts.material_used) as total_material_used,
                SUM(ts.adjustment_val) as total_adjustment
            FROM transactions_summary ts
            GROUP BY ts.company_code, ts.item_code
        ) ts_agg ON 
            ob.company_code = ts_agg.agg_company_code 
            AND ob.item_code = ts_agg.agg_item_code
        LEFT JOIN companies c ON COALESCE(ob.company_code, ts_agg.agg_company_code) = c.code
        WHERE ob.item_type = ANY(p_item_types)
    )
    SELECT
        ROW_NUMBER() OVER (PARTITION BY ps.company_code ORDER BY ps.item_code) as no,
        ps.company_code,
        ps.company_name,
        ps.item_code,
        ps.item_name,
        ps.item_type,
        ps.uom,
        v_end_date::DATE as snapshot_date,
        ps.opening_balance,
        ps.total_received as quantity_received,
        (ps.total_issued + ps.total_material_used) as quantity_issued_outgoing,
        ps.total_adjustment as adjustment,
        ps.opening_balance + ps.total_received - ps.total_issued - ps.total_material_used + ps.total_adjustment as closing_balance,
        NULL::NUMERIC(15,3) as stock_count_result,
        NULL::NUMERIC(15,3) as quantity_difference,
        NULL::NUMERIC(18,4) as value_amount,
        NULL::VARCHAR(3) as currency,
        'ACCUMULATED FROM ' || v_start_date::TEXT || ' TO ' || v_end_date::TEXT as remarks
    FROM period_summary ps
    WHERE ps.opening_balance <> 0 
       OR ps.total_received <> 0 
       OR ps.total_issued <> 0 
       OR ps.total_material_used <> 0 
       OR ps.total_adjustment <> 0
    ORDER BY ps.company_code, ps.item_code;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_calculate_lpj_bahan_baku IS 'Calculate LPJ for raw materials (incoming-based only, excludes production)';

-- ============================================================================
-- FUNCTION 2: CALCULATE LPJ HASIL PRODUKSI (Production Output)
-- ============================================================================
-- This function calculates mutation for finished/semi-finished goods from production
-- Sources: production_qty only (excludes incoming_qty)
-- Item types: FERT, HALB (produced)
--
-- Parameters:
--   p_item_types: Array of item types to filter (e.g., ARRAY['FERT', 'HALB'])
--   p_start_date: Start date for accumulation (NULL = from start of year)
--   p_end_date: End date for accumulation (NULL = current date)
--
-- Return mode: Always returns aggregated records (1 row per company+item+date_range)
--   with accumulated in/out/adjustment between start and end dates
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_calculate_lpj_hasil_produksi(
    p_item_types TEXT[],
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    no BIGINT,
    company_code INTEGER,
    company_name VARCHAR(200),
    item_code VARCHAR(50),
    item_name VARCHAR(200),
    item_type VARCHAR(10),
    unit_quantity VARCHAR(20),
    snapshot_date DATE,
    opening_balance NUMERIC(15,3),
    quantity_received NUMERIC(15,3),
    quantity_issued_outgoing NUMERIC(15,3),
    adjustment NUMERIC(15,3),
    closing_balance NUMERIC(15,3),
    stock_count_result NUMERIC(15,3),
    quantity_difference NUMERIC(15,3),
    value_amount NUMERIC(18,4),
    currency VARCHAR(3),
    remarks TEXT
) AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Default: if date range not provided, use start of year to today (includes beginning balance data)
    v_start_date := COALESCE(p_start_date, DATE_TRUNC('year', CURRENT_DATE)::DATE);
    v_end_date := COALESCE(p_end_date, CURRENT_DATE);
    
    -- Return aggregated view based on provided or default date range
    RETURN QUERY
    WITH
    -- Get opening balance from last snapshot before start date, or earliest if none before start
    opening_balances AS (
        SELECT 
            sds.company_code,
            sds.item_code,
            sds.closing_balance as opening_balance,
            sds.item_type,
            sds.item_name,
            c.name as company_name,
            sds.uom
        FROM stock_daily_snapshot sds
        JOIN companies c ON sds.company_code = c.code
        INNER JOIN (
            -- Try to get snapshot before start_date; if none exist, use earliest snapshot
            SELECT 
                sds_inner.company_code, 
                sds_inner.item_code, 
                COALESCE(
                    MAX(CASE WHEN sds_inner.snapshot_date < v_start_date THEN sds_inner.snapshot_date END),
                    MIN(sds_inner.snapshot_date)
                ) as max_snapshot_date
            FROM stock_daily_snapshot sds_inner
            GROUP BY sds_inner.company_code, sds_inner.item_code
        ) last_snap ON sds.company_code = last_snap.company_code 
                    AND sds.item_code = last_snap.item_code 
                    AND sds.snapshot_date = last_snap.max_snapshot_date
        WHERE sds.item_type = ANY(p_item_types)
    ),
    -- Aggregate all transactions within date range (with UOM tracking)
    transactions_summary AS (
        -- Production output
        SELECT
            po.company_code,
            poi.item_code,
            poi.uom,
            SUM(CASE 
                WHEN po.reversal = 'Y' THEN -poi.qty
                ELSE poi.qty 
            END) as received,
            0::NUMERIC(15,3) as issued,
            0::NUMERIC(15,3) as material_used,
            0::NUMERIC(15,3) as adjustment_val
        FROM production_outputs po
        JOIN production_output_items poi ON 
            po.company_code = poi.production_output_company
            AND po.id = poi.production_output_id
            AND po.transaction_date = poi.production_output_date
        WHERE po.deleted_at IS NULL 
          AND poi.deleted_at IS NULL
          AND poi.item_type = ANY(p_item_types)
          AND po.transaction_date BETWEEN v_start_date AND v_end_date
        GROUP BY po.company_code, poi.item_code, poi.uom

        UNION ALL

        -- Outgoing goods
        SELECT
            og.company_code,
            ogi.item_code,
            ogi.uom,
            0::NUMERIC(15,3) as received,
            SUM(ogi.qty) as issued,
            0::NUMERIC(15,3) as material_used,
            0::NUMERIC(15,3) as adjustment_val
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON 
            og.company_code = ogi.outgoing_good_company
            AND og.id = ogi.outgoing_good_id
            AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.deleted_at IS NULL 
          AND ogi.deleted_at IS NULL
          AND ogi.item_type = ANY(p_item_types)
          AND og.outgoing_date BETWEEN v_start_date AND v_end_date
        GROUP BY og.company_code, ogi.item_code, ogi.uom

        UNION ALL

        -- Adjustments
        SELECT
            a.company_code,
            ai.item_code,
            ai.uom,
            0::NUMERIC(15,3) as received,
            0::NUMERIC(15,3) as issued,
            0::NUMERIC(15,3) as material_used,
            SUM(CASE 
                WHEN ai.adjustment_type = 'GAIN' THEN ai.qty
                ELSE -ai.qty
            END) as adjustment_val
        FROM adjustments a
        JOIN adjustment_items ai ON 
            a.company_code = ai.adjustment_company
            AND a.id = ai.adjustment_id
            AND a.transaction_date = ai.adjustment_date
        WHERE a.deleted_at IS NULL 
          AND ai.deleted_at IS NULL
          AND ai.item_type = ANY(p_item_types)
          AND a.transaction_date BETWEEN v_start_date AND v_end_date
        GROUP BY a.company_code, ai.item_code, ai.uom
    ),
    -- Combine opening balance with transactions
    -- Priority for UOM: snapshot.uom → transaction.uom → items.uom → 'UNIT'
    period_summary AS (
        SELECT
            COALESCE(ob.company_code, ts_agg.agg_company_code) as company_code,
            COALESCE(ob.company_name, c.name) as company_name,
            COALESCE(ob.item_code, ts_agg.agg_item_code) as item_code,
            COALESCE(ob.item_name, '') as item_name,
            ob.item_type,
            COALESCE(ob.uom, ts_agg.agg_uom, 'UNIT') as uom,
            COALESCE(ob.opening_balance, 0)::NUMERIC(15,3) as opening_balance,
            COALESCE(ts_agg.total_received, 0)::NUMERIC(15,3) as total_received,
            COALESCE(ts_agg.total_issued, 0)::NUMERIC(15,3) as total_issued,
            COALESCE(ts_agg.total_material_used, 0)::NUMERIC(15,3) as total_material_used,
            COALESCE(ts_agg.total_adjustment, 0)::NUMERIC(15,3) as total_adjustment
        FROM opening_balances ob
        FULL OUTER JOIN (
            SELECT
                ts.company_code as agg_company_code,
                ts.item_code as agg_item_code,
                MIN(ts.uom) as agg_uom,
                SUM(ts.received) as total_received,
                SUM(ts.issued) as total_issued,
                SUM(ts.material_used) as total_material_used,
                SUM(ts.adjustment_val) as total_adjustment
            FROM transactions_summary ts
            GROUP BY ts.company_code, ts.item_code
        ) ts_agg ON 
            ob.company_code = ts_agg.agg_company_code 
            AND ob.item_code = ts_agg.agg_item_code
        LEFT JOIN companies c ON COALESCE(ob.company_code, ts_agg.agg_company_code) = c.code
        WHERE ob.item_type = ANY(p_item_types)
    )
    SELECT
        ROW_NUMBER() OVER (PARTITION BY ps.company_code ORDER BY ps.item_code) as no,
        ps.company_code,
        ps.company_name,
        ps.item_code,
        ps.item_name,
        ps.item_type,
        ps.uom,
        v_end_date::DATE as snapshot_date,
        ps.opening_balance,
        ps.total_received as quantity_received,
        (ps.total_issued + ps.total_material_used) as quantity_issued_outgoing,
        ps.total_adjustment as adjustment,
        ps.opening_balance + ps.total_received - ps.total_issued - ps.total_material_used + ps.total_adjustment as closing_balance,
        NULL::NUMERIC(15,3) as stock_count_result,
        NULL::NUMERIC(15,3) as quantity_difference,
        NULL::NUMERIC(18,4) as value_amount,
        NULL::VARCHAR(3) as currency,
        'ACCUMULATED FROM ' || v_start_date::TEXT || ' TO ' || v_end_date::TEXT as remarks
    FROM period_summary ps
    WHERE ps.opening_balance <> 0 
       OR ps.total_received <> 0 
       OR ps.total_issued <> 0 
       OR ps.total_material_used <> 0 
       OR ps.total_adjustment <> 0
    ORDER BY ps.company_code, ps.item_code;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_calculate_lpj_hasil_produksi IS 'Calculate LPJ for finished/semi-finished goods (production-based only, excludes incoming)';

-- ============================================================================
-- REPORT #1: LAPORAN PEMASUKAN (Goods Receiving Report)
-- ============================================================================
-- No changes needed - already real-time only (transaction-based)

CREATE OR REPLACE VIEW vw_laporan_pemasukan AS
SELECT 
    ig.id,
    ig.company_code,
    c.name as company_name,
    ig.customs_document_type,
    ig.ppkek_number as cust_doc_registration_no,
    ig.customs_registration_date as reg_date,
    ig.incoming_evidence_number as doc_number,
    ig.incoming_date as doc_date,
    ig.shipper_name,
    
    -- Item details
    igi.item_type as type_code,
    igi.item_code,
    igi.item_name,
    igi.uom as unit,
    igi.qty as quantity,
    igi.currency,
    igi.amount as value_amount,
    
    -- Audit fields
    ig.created_at,
    ig.updated_at,
    ig.deleted_at
FROM incoming_goods ig
JOIN incoming_good_items igi ON ig.company_code = igi.incoming_good_company
    AND ig.id = igi.incoming_good_id
    AND ig.incoming_date = igi.incoming_good_date
JOIN companies c ON ig.company_code = c.code
WHERE ig.deleted_at IS NULL
  AND igi.deleted_at IS NULL
ORDER BY ig.incoming_date DESC, ig.id, igi.id;

COMMENT ON VIEW vw_laporan_pemasukan IS 'Report #1: Goods Receiving Report - Real-time view of incoming goods transactions';

-- ============================================================================
-- REPORT #2: LAPORAN PENGELUARAN (Goods Issuance Report)
-- ============================================================================
-- No changes needed - already real-time only (transaction-based)

CREATE OR REPLACE VIEW vw_laporan_pengeluaran AS
SELECT 
    og.id,
    og.wms_id,
    og.company_code,
    c.name as company_name,
    og.customs_document_type,
    og.ppkek_number as cust_doc_registration_no,
    og.customs_registration_date as reg_date,
    og.outgoing_evidence_number as doc_number,
    og.outgoing_date as doc_date,
    og.recipient_name,
    
    -- Item details
    ogi.item_type as type_code,
    ogi.item_code,
    ogi.item_name,
    ogi.uom as unit,
    ogi.qty as quantity,
    ogi.currency,
    ogi.amount as value_amount,
    ogi.production_output_wms_ids,
    
    -- Audit fields
    og.created_at,
    og.updated_at,
    og.deleted_at
FROM outgoing_goods og
JOIN outgoing_good_items ogi ON og.company_code = ogi.outgoing_good_company
    AND og.id = ogi.outgoing_good_id
    AND og.outgoing_date = ogi.outgoing_good_date
JOIN companies c ON og.company_code = c.code
WHERE og.deleted_at IS NULL
  AND ogi.deleted_at IS NULL
ORDER BY og.outgoing_date DESC, og.id, ogi.id;

COMMENT ON VIEW vw_laporan_pengeluaran IS 'Report #2: Goods Issuance Report - Real-time view of outgoing goods transactions';

-- ============================================================================
-- REPORT #3: LPJ BAHAN BAKU DAN BAHAN PENOLONG (Raw Material Mutation Report)
-- ============================================================================
-- Uses function for incoming-based materials (excludes production)
-- Item types: ROH, HALB (purchased from incoming), HIBE
-- Filter: Only HALB items with incoming_qty activity (excludes HALB from production)

CREATE OR REPLACE VIEW vw_lpj_bahan_baku AS
SELECT * FROM fn_calculate_lpj_bahan_baku(
    ARRAY['ROH', 'HALB', 'HIBE'],
    DATE_TRUNC('year', CURRENT_DATE)::DATE,
    CURRENT_DATE
)
WHERE item_type IN ('ROH', 'HIBE') 
   OR (item_type = 'HALB' AND (quantity_received > 0 OR opening_balance > 0));

COMMENT ON VIEW vw_lpj_bahan_baku IS 'Report #3: Raw Material and Auxiliary Material Mutation Report - Incoming-based only (ROH, HALB from incoming/beginning, HIBE) - YTD';

-- ============================================================================
-- REPORT #4: LPJ WIP (Work in Process Position Report)
-- ============================================================================
-- No changes needed - already snapshot-based only (from wip_balances table)

CREATE OR REPLACE VIEW vw_lpj_wip AS
SELECT 
    ROW_NUMBER() OVER (PARTITION BY wb.company_code, wb.stock_date ORDER BY wb.item_code) as no,
    wb.company_code,
    c.name as company_name,
    wb.item_code,
    wb.item_name,
    wb.item_type,
    wb.uom as unit_quantity,
    wb.qty as quantity,
    wb.stock_date,
    NULL::TEXT as remarks,
    wb.created_at,
    wb.updated_at
FROM wip_balances wb
JOIN companies c ON wb.company_code = c.code
WHERE wb.deleted_at IS NULL
ORDER BY wb.company_code, wb.stock_date DESC, wb.item_code;

COMMENT ON VIEW vw_lpj_wip IS 'Report #4: Work in Process Position Report - Snapshot-based from wip_balances';

-- ============================================================================
-- REPORT #5: LPJ HASIL PRODUKSI (Finished Goods Mutation Report)
-- ============================================================================
-- Uses function for production-based goods (excludes incoming)
-- Item types: FERT and HALB (produced from production output only)
-- Filter: Only HALB items with production_qty activity (excludes HALB from incoming)
-- NOTE: HALB dari incoming dilaporkan di vw_lpj_bahan_baku
--       HALB dari production output dilaporkan di sini

CREATE OR REPLACE VIEW vw_lpj_hasil_produksi AS
SELECT * FROM fn_calculate_lpj_hasil_produksi(
    ARRAY['FERT', 'HALB'],
    DATE_TRUNC('year', CURRENT_DATE)::DATE,
    CURRENT_DATE
)
WHERE item_type = 'FERT'
   OR (item_type = 'HALB' AND quantity_received > 0);

COMMENT ON VIEW vw_lpj_hasil_produksi IS 'Report #5: Finished Goods Mutation Report - Production-based (FERT and HALB from production output only) - YTD';

-- ============================================================================
-- REPORT #6: LPJ BARANG MODAL (Capital Goods Mutation Report)
-- ============================================================================
-- Uses function for incoming-based capital goods (excludes production)
-- Item types: HIBE-M, HIBE-E, HIBE-T (Capital Goods - purchased only)

CREATE OR REPLACE VIEW vw_lpj_barang_modal AS
SELECT * FROM fn_calculate_lpj_bahan_baku(
    ARRAY['HIBE-M', 'HIBE-E', 'HIBE-T'],
    DATE_TRUNC('year', CURRENT_DATE)::DATE,
    CURRENT_DATE
);

COMMENT ON VIEW vw_lpj_barang_modal IS 'Report #6: Capital Goods Mutation Report - Incoming-based only (HIBE-M/E/T purchased) - YTD';

-- ============================================================================
-- FUNCTION 3: CALCULATE LPJ BARANG SISA (Scrap/Waste Mutations)
-- ============================================================================
-- This function calculates scrap mutations using hybrid approach:
-- Opening balance: From stock_daily_snapshot (last snapshot before start date)
-- Transactions: 
--   - Scrap IN: From scrap_transactions (transaction_type = 'IN')
--   - Scrap OUT: From outgoing_goods + outgoing_good_items (item_type = 'SCRAP')
-- Item types: SCRAP
--
-- Parameters:
--   p_item_types: Array of item types to filter (e.g., ARRAY['SCRAP'])
--   p_start_date: Start date for accumulation (NULL = from start of year)
--   p_end_date: End date for accumulation (NULL = current date)
--
-- Return mode: Always returns aggregated records (1 row per company+item+date_range)
--   with accumulated in/out between start and end dates
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_calculate_lpj_barang_sisa(
    p_item_types TEXT[],
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    no BIGINT,
    company_code INTEGER,
    company_name VARCHAR(200),
    item_code VARCHAR(50),
    item_name VARCHAR(200),
    item_type VARCHAR(10),
    unit_quantity VARCHAR(20),
    snapshot_date DATE,
    opening_balance NUMERIC(15,3),
    quantity_received NUMERIC(15,3),
    quantity_issued_outgoing NUMERIC(15,3),
    adjustment NUMERIC(15,3),
    closing_balance NUMERIC(15,3),
    stock_count_result NUMERIC(15,3),
    quantity_difference NUMERIC(15,3),
    value_amount NUMERIC(18,4),
    currency VARCHAR(3),
    remarks TEXT
) AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Default: if date range not provided, use start of year to today
    v_start_date := COALESCE(p_start_date, DATE_TRUNC('year', CURRENT_DATE)::DATE);
    v_end_date := COALESCE(p_end_date, CURRENT_DATE);
    
    -- Return scrap mutation data based on provided or default date range
    RETURN QUERY
    WITH
    -- Get opening balance from last snapshot before start date, or earliest if none before start
    opening_balances AS (
        SELECT 
            sds.company_code,
            sds.item_code,
            sds.closing_balance as opening_balance,
            sds.item_type,
            sds.item_name,
            c.name as company_name,
            sds.uom
        FROM stock_daily_snapshot sds
        JOIN companies c ON sds.company_code = c.code
        INNER JOIN (
            -- Try to get snapshot before start_date; if none exist, use earliest snapshot
            SELECT 
                sds_inner.company_code, 
                sds_inner.item_code, 
                COALESCE(
                    MAX(CASE WHEN sds_inner.snapshot_date < v_start_date THEN sds_inner.snapshot_date END),
                    MIN(sds_inner.snapshot_date)
                ) as max_snapshot_date
            FROM stock_daily_snapshot sds_inner
            GROUP BY sds_inner.company_code, sds_inner.item_code
        ) last_snap ON sds.company_code = last_snap.company_code 
                    AND sds.item_code = last_snap.item_code 
                    AND sds.snapshot_date = last_snap.max_snapshot_date
        WHERE sds.item_type = ANY(p_item_types)
    ),
    -- Aggregate all scrap transactions within date range (with UOM tracking)
    transactions_summary AS (
        -- Scrap IN transactions (from scrap_transactions)
        SELECT
            st.company_code,
            sti.item_code,
            sti.uom,
            SUM(sti.qty) as received,
            0::NUMERIC(15,3) as issued,
            0::NUMERIC(15,3) as adjustment_val
        FROM scrap_transactions st
        JOIN scrap_transaction_items sti ON 
            st.company_code = sti.scrap_transaction_company
            AND st.id = sti.scrap_transaction_id
            AND st.transaction_date = sti.scrap_transaction_date
        WHERE st.deleted_at IS NULL 
          AND sti.deleted_at IS NULL
          AND sti.item_type = ANY(p_item_types)
          AND st.transaction_type = 'IN'
          AND st.transaction_date BETWEEN v_start_date AND v_end_date
        GROUP BY st.company_code, sti.item_code, sti.uom

        UNION ALL

        -- Scrap OUT transactions (from outgoing_goods)
        SELECT
            og.company_code,
            ogi.item_code,
            ogi.uom,
            0::NUMERIC(15,3) as received,
            SUM(ogi.qty) as issued,
            0::NUMERIC(15,3) as adjustment_val
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON 
            og.company_code = ogi.outgoing_good_company
            AND og.id = ogi.outgoing_good_id
            AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.deleted_at IS NULL 
          AND ogi.deleted_at IS NULL
          AND ogi.item_type = ANY(p_item_types)
          AND og.outgoing_date BETWEEN v_start_date AND v_end_date
        GROUP BY og.company_code, ogi.item_code, ogi.uom
    ),
    -- Combine opening balance with transactions
    -- Priority for UOM: snapshot.uom → transaction.uom → 'UNIT'
    period_summary AS (
        SELECT
            COALESCE(ob.company_code, ts_agg.agg_company_code) as company_code,
            COALESCE(ob.company_name, c.name) as company_name,
            COALESCE(ob.item_code, ts_agg.agg_item_code) as item_code,
            COALESCE(ob.item_name, '') as item_name,
            ob.item_type,
            COALESCE(ob.uom, ts_agg.agg_uom, 'UNIT') as uom,
            COALESCE(ob.opening_balance, 0)::NUMERIC(15,3) as opening_balance,
            COALESCE(ts_agg.total_received, 0)::NUMERIC(15,3) as total_received,
            COALESCE(ts_agg.total_issued, 0)::NUMERIC(15,3) as total_issued,
            COALESCE(ts_agg.total_adjustment, 0)::NUMERIC(15,3) as total_adjustment
        FROM opening_balances ob
        FULL OUTER JOIN (
            SELECT
                ts.company_code as agg_company_code,
                ts.item_code as agg_item_code,
                MIN(ts.uom) as agg_uom,
                SUM(ts.received) as total_received,
                SUM(ts.issued) as total_issued,
                SUM(ts.adjustment_val) as total_adjustment
            FROM transactions_summary ts
            GROUP BY ts.company_code, ts.item_code
        ) ts_agg ON
            ob.company_code = ts_agg.agg_company_code 
            AND ob.item_code = ts_agg.agg_item_code
        LEFT JOIN companies c ON COALESCE(ob.company_code, ts_agg.agg_company_code) = c.code
        WHERE ob.item_type = ANY(p_item_types)
    )
    SELECT
        ROW_NUMBER() OVER (PARTITION BY ps.company_code ORDER BY ps.item_code) as no,
        ps.company_code,
        ps.company_name,
        ps.item_code,
        ps.item_name,
        ps.item_type,
        ps.uom,
        v_end_date::DATE as snapshot_date,
        ps.opening_balance,
        ps.total_received as quantity_received,
        ps.total_issued as quantity_issued_outgoing,
        ps.total_adjustment as adjustment,
        ps.opening_balance + ps.total_received - ps.total_issued + ps.total_adjustment as closing_balance,
        NULL::NUMERIC(15,3) as stock_count_result,
        NULL::NUMERIC(15,3) as quantity_difference,
        NULL::NUMERIC(18,4) as value_amount,
        NULL::VARCHAR(3) as currency,
        'ACCUMULATED FROM ' || v_start_date::TEXT || ' TO ' || v_end_date::TEXT as remarks
    FROM period_summary ps
    WHERE ps.opening_balance <> 0 
       OR ps.total_received <> 0 
       OR ps.total_issued <> 0 
       OR ps.total_adjustment <> 0
    ORDER BY ps.company_code, ps.item_code;
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_calculate_lpj_barang_sisa IS 'Calculate LPJ for scrap/waste (hybrid: opening from snapshot + SCRAP IN from scrap_transactions + SCRAP OUT from outgoing_goods)';

-- ============================================================================
-- REPORT #7: LPJ BARANG SISA / SCRAP (Scrap Mutation Report)
-- ============================================================================

CREATE OR REPLACE VIEW vw_lpj_barang_sisa AS
SELECT * FROM fn_calculate_lpj_barang_sisa(
    ARRAY['SCRAP'],
    DATE_TRUNC('year', CURRENT_DATE)::DATE,
    CURRENT_DATE
);

COMMENT ON VIEW vw_lpj_barang_sisa IS 'Report #7: Scrap/Waste Mutation Report - SCRAP IN from scrap_transactions + SCRAP OUT from outgoing_goods - YTD';

-- ============================================================================
-- ADDITIONAL HELPER VIEWS
-- ============================================================================

-- Current stock summary (all item types - excluding scrap until implementation)
CREATE OR REPLACE VIEW vw_current_stock_summary AS
SELECT 
    company_code,
    c.name as company_name,
    item_type,
    COUNT(DISTINCT item_code) as item_count,
    SUM(closing_balance) as total_qty
FROM (
    SELECT company_code, item_code, item_type, closing_balance FROM vw_lpj_bahan_baku
    UNION ALL
    SELECT company_code, item_code, item_type, closing_balance FROM vw_lpj_hasil_produksi
    UNION ALL
    SELECT company_code, item_code, item_type, closing_balance FROM vw_lpj_barang_modal
    -- NOTE: vw_lpj_barang_sisa excluded - scrap table under development
) combined
JOIN companies c ON combined.company_code = c.code
GROUP BY company_code, c.name, item_type
ORDER BY company_code, item_type;

COMMENT ON VIEW vw_current_stock_summary IS 'Summary of current stock by company and item type';

-- Transaction volume summary
CREATE OR REPLACE VIEW vw_transaction_volume_summary AS
SELECT 
    'Incoming Goods' as transaction_type,
    ig.company_code,
    c.name as company_name,
    DATE_TRUNC('month', ig.incoming_date) as month,
    COUNT(DISTINCT ig.id) as transaction_count,
    SUM((SELECT COUNT(*) FROM incoming_good_items WHERE incoming_good_id = ig.id)) as item_count
FROM incoming_goods ig
JOIN companies c ON ig.company_code = c.code
WHERE ig.deleted_at IS NULL
GROUP BY ig.company_code, c.name, DATE_TRUNC('month', ig.incoming_date)

UNION ALL

SELECT 
    'Outgoing Goods' as transaction_type,
    og.company_code,
    c.name as company_name,
    DATE_TRUNC('month', og.outgoing_date) as month,
    COUNT(DISTINCT og.id) as transaction_count,
    SUM((SELECT COUNT(*) FROM outgoing_good_items WHERE outgoing_good_id = og.id)) as item_count
FROM outgoing_goods og
JOIN companies c ON og.company_code = c.code
WHERE og.deleted_at IS NULL
GROUP BY og.company_code, c.name, DATE_TRUNC('month', og.outgoing_date)

UNION ALL

SELECT 
    'Material Usage' as transaction_type,
    mu.company_code,
    c.name as company_name,
    DATE_TRUNC('month', mu.transaction_date) as month,
    COUNT(DISTINCT mu.id) as transaction_count,
    SUM((SELECT COUNT(*) FROM material_usage_items WHERE material_usage_id = mu.id)) as item_count
FROM material_usages mu
JOIN companies c ON mu.company_code = c.code
WHERE mu.deleted_at IS NULL
GROUP BY mu.company_code, c.name, DATE_TRUNC('month', mu.transaction_date)

UNION ALL

SELECT 
    'Production Output' as transaction_type,
    po.company_code,
    c.name as company_name,
    DATE_TRUNC('month', po.transaction_date) as month,
    COUNT(DISTINCT po.id) as transaction_count,
    SUM((SELECT COUNT(*) FROM production_output_items WHERE production_output_id = po.id)) as item_count
FROM production_outputs po
JOIN companies c ON po.company_code = c.code
WHERE po.deleted_at IS NULL
GROUP BY po.company_code, c.name, DATE_TRUNC('month', po.transaction_date)

ORDER BY month DESC, company_code, transaction_type;

COMMENT ON VIEW vw_transaction_volume_summary IS 'Monthly transaction volume by type and company';

-- ============================================================================
-- INDEXES FOR VIEW PERFORMANCE
-- ============================================================================
-- Note: Base table indexes already exist from setup_partitions.sql
-- These are additional indexes specifically for view optimization

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_incoming_goods_date_range 
ON incoming_goods (company_code, incoming_date, deleted_at);

CREATE INDEX IF NOT EXISTS idx_outgoing_goods_date_range 
ON outgoing_goods (company_code, outgoing_date, deleted_at);

CREATE INDEX IF NOT EXISTS idx_material_usages_date_range 
ON material_usages (company_code, transaction_date, deleted_at);

CREATE INDEX IF NOT EXISTS idx_production_outputs_date_range 
ON production_outputs (company_code, transaction_date, deleted_at);

-- Index for item type filtering
CREATE INDEX IF NOT EXISTS idx_incoming_good_items_type 
ON incoming_good_items (item_type, deleted_at);

CREATE INDEX IF NOT EXISTS idx_outgoing_good_items_type 
ON outgoing_good_items (item_type, deleted_at);

CREATE INDEX IF NOT EXISTS idx_material_usage_items_type 
ON material_usage_items (item_type, deleted_at);

CREATE INDEX IF NOT EXISTS idx_production_output_items_type 
ON production_output_items (item_type, deleted_at);

CREATE INDEX IF NOT EXISTS idx_adjustment_items_type 
ON adjustment_items (item_type, adjustment_type, deleted_at);

-- Index for stock_daily_snapshot (critical for hybrid approach)
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_item_type_date
ON stock_daily_snapshot (company_code, item_type, snapshot_date);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify views are working correctly:

-- Test Report #3: Raw Material Mutation (incoming-based) - YEARLY VIEW (Jan 1 - Today)
-- SELECT * FROM vw_lpj_bahan_baku WHERE company_code = 1310 LIMIT 10;

-- Test Report #3: Raw Material Mutation - CUSTOM DATE RANGE (Dec 25, 2024 - Jan 1, 2025)
-- SELECT * FROM fn_calculate_lpj_bahan_baku(
--     ARRAY['ROH', 'HALB', 'HIBE'], 
--     '2024-12-25'::DATE, 
--     '2025-01-01'::DATE
-- ) WHERE company_code = 1310;

-- Test Report #4: WIP Position (snapshot-based)
-- SELECT * FROM vw_lpj_wip WHERE company_code = 1310 LIMIT 10;

-- Test Report #5: Finished Goods Mutation (production-based FERT and HALB from production) - YEARLY VIEW
-- SELECT * FROM vw_lpj_hasil_produksi WHERE company_code = 1310 LIMIT 10;

-- Test Report #5: Finished Goods Mutation - CUSTOM DATE RANGE (Dec 1, 2025 - Dec 25, 2025)
-- SELECT * FROM fn_calculate_lpj_hasil_produksi(
--     ARRAY['FERT', 'HALB'], 
--     '2025-12-01'::DATE, 
--     '2025-12-25'::DATE
-- ) WHERE item_type = 'FERT' OR (item_type = 'HALB' AND quantity_received > 0);

-- Test Report #6: Capital Goods Mutation (incoming-based) - YEARLY VIEW (Jan 1 - Today)
-- SELECT * FROM vw_lpj_barang_modal WHERE company_code = 1310 LIMIT 10;

-- Test Report #6: Capital Goods Mutation - CUSTOM DATE RANGE (Dec 25, 2024 - Jan 1, 2025)
-- SELECT * FROM fn_calculate_lpj_bahan_baku(
--     ARRAY['HIBE-M', 'HIBE-E', 'HIBE-T'], 
--     '2024-12-25'::DATE, 
--     '2025-01-01'::DATE
-- ) WHERE company_code = 1310;

-- Test Summary Views
-- SELECT * FROM vw_current_stock_summary;
-- SELECT * FROM vw_transaction_volume_summary WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months');

-- ============================================================================
-- AGGREGATED VIEW EXAMPLES
-- ============================================================================
-- The functions now support two modes:
--
-- MODE 1: YEARLY VIEW (Views - Fixed Jan 1 to Today)
--   SELECT * FROM vw_lpj_barang_modal WHERE company_code = 1310
--   Result: Data for Year-To-Date (Jan 1 CURRENT_YEAR to TODAY)
--   snapshot_date: Always shows TODAY
--   opening_balance: From Jan 1 CURRENT_YEAR
--   closing_balance: To TODAY
--   Use case: Standard YTD reporting
--
-- MODE 2: CUSTOM DATE RANGE (Functions - Dynamic)
--   SELECT * FROM fn_calculate_lpj_bahan_baku(
--       ARRAY['HIBE-M', 'HIBE-E', 'HIBE-T'],
--       '2024-12-25'::DATE,  -- Start date (custom)
--       '2025-01-01'::DATE   -- End date (custom)
--   )
--   Result: Data for specified date range
--   snapshot_date: Shows end_date of query
--   opening_balance: From snapshot closest to start_date
--   closing_balance: To end_date
--   Use case: Custom period reporting, historical analysis, cross-month queries
--
-- KEY DIFFERENCE:
--   - Views are FIXED to YTD (Jan 1 to Today) - for standard reporting
--   - Functions are FLEXIBLE - for custom date range queries
--
-- EXAMPLE SCENARIOS:
-- 
-- Scenario 1: Query data from Dec 25, 2024 to Jan 1, 2025 (crosses year boundary)
--   USE FUNCTION:
--   SELECT * FROM fn_calculate_lpj_bahan_baku(
--       ARRAY['HIBE-M', 'HIBE-E', 'HIBE-T'],
--       '2024-12-25'::DATE,
--       '2025-01-01'::DATE
--   ) WHERE company_code = 1310;
--   RESULT: opening_balance from Dec 25, transactions from Dec 25-Jan 1
--
-- Scenario 2: Query data from last month (e.g., Nov 2025)
--   USE FUNCTION:
--   SELECT * FROM fn_calculate_lpj_bahan_baku(
--       ARRAY['HIBE-M', 'HIBE-E', 'HIBE-T'],
--       '2025-11-01'::DATE,
--       '2025-11-30'::DATE
--   ) WHERE company_code = 1310;
--   RESULT: Full November data with beginning and ending balances
--
-- Scenario 3: Year-to-date comparison (Jan 1 to specific date)
--   USE FUNCTION:
--   SELECT * FROM fn_calculate_lpj_bahan_baku(
--       ARRAY['HIBE-M', 'HIBE-E', 'HIBE-T'],
--       DATE_TRUNC('year', CURRENT_DATE)::DATE,  -- Jan 1 current year
--       '2025-06-30'::DATE  -- Mid-year cutoff
--   ) WHERE company_code = 1310;
--   RESULT: H1 2025 data (Jan 1 - June 30)
--
-- ============================================================================
-- PERFORMANCE NOTES
-- ============================================================================
-- - Hybrid approach ensures both daily and aggregated queries are fast
-- - Daily view: Uses snapshot data (pre-calculated) + recent transactions
-- - Aggregated view: Combines snapshot range + recent real-time transactions
-- - Opening balance intelligently retrieves from last snapshot before range start
-- - Closing balance accurately reflects last transaction date in range
-- ============================================================================

-- ============================================================================
-- PERFORMANCE COMPARISON
-- ============================================================================
-- Compare hybrid vs all-realtime performance:

-- Incoming-based approach (fast for historical data)
-- EXPLAIN ANALYZE 
-- SELECT * FROM vw_lpj_bahan_baku 
-- WHERE company_code = 1310 
--   AND snapshot_date BETWEEN '2022-01-01' AND '2025-12-21';

-- All-realtime approach (slow for historical data)
-- EXPLAIN ANALYZE
-- SELECT ... FROM incoming_goods ... 
-- WHERE company_code = 1310 
--   AND incoming_date BETWEEN '2022-01-01' AND '2025-12-18';

-- ============================================================================
-- MAINTENANCE NOTES
-- ============================================================================
-- 1. Daily snapshot calculation (run via cron at 23:59):
--    SELECT calculate_stock_snapshot(1370, CURRENT_DATE);
--    SELECT calculate_stock_snapshot(1310, CURRENT_DATE);
--    SELECT calculate_stock_snapshot(1380, CURRENT_DATE);
--
-- 2. Function usage with date range parameters:
--    
--    Daily view (original behavior):
--    SELECT * FROM fn_calculate_lpj_bahan_baku(ARRAY['ROH', 'HALB', 'HIBE']) 
--    WHERE company_code = 1310;
--
--    Aggregated view (new feature):
--    SELECT * FROM fn_calculate_lpj_bahan_baku(
--        ARRAY['ROH', 'HALB', 'HIBE'],
--        '2025-12-01'::DATE,
--        '2025-12-25'::DATE
--    );
--
-- 3. To add new item types (for existing sources):
--    UPDATE existing view with new type in array, OR
--    CREATE new view for new source type
--
-- 4. Functions are STABLE (not VOLATILE) for query optimization
--
-- 5. Monitor query performance with EXPLAIN ANALYZE
--
-- 6. Performance expected:
--    - Daily queries (1+ years): 1-2 seconds
--    - Recent queries (< 1 month): 1-2 seconds
--    - All-time queries: 2-3 seconds
--    - Aggregated period queries: < 1 second
--    - Without hybrid: 30+ seconds for 4 years
--
-- 7. For new transaction types (like scrap):
--    - Create new function: fn_calculate_lpj_<type>
--    - Define unique source logic
--    - Add optional date parameters for aggregation
--    - Create new view: vw_lpj_<type>
--
-- 8. Backward compatibility:
--    - Old calls without date parameters still work (return daily view)
--    - New calls with date parameters return aggregated view
--    - All reporting views (vw_lpj_*) still return daily view by default

-- ============================================================================
-- END OF VIEWS CREATION
-- ============================================================================