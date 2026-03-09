-- ============================================================================
-- IMAPS REPORTING VIEWS - Snapshot-Based Approach
-- ============================================================================
-- Version: 4.0.0 (Snapshot-only, all calculations direct)
-- Created: December 18, 2025 | Updated: January 9, 2026
-- Purpose: Create reporting views for customs compliance reports
-- 
-- ARCHITECTURE: Source-based Functions querying stock_daily_snapshot
-- - All calculations performed directly on pre-calculated snapshot data
-- - 3 specialized functions for different reporting sources:
--   1. fn_calculate_lpj_bahan_baku(): Incoming-based materials (ROH, HALB, HIBE)
--   2. fn_calculate_lpj_hasil_produksi(): Production-based goods (FERT, HALB produced)
--   3. fn_calculate_lpj_barang_sisa(): Scrap/Waste items (SCRAP)
-- 
-- PERFORMANCE: Direct snapshot queries
-- - All data from stock_daily_snapshot (pre-calculated daily mutations)
-- - No real-time transaction processing needed
-- - SUM mutations within date range
-- - Opening balance from closest snapshot before start_date
-- - Closing balance from snapshot on end_date
-- ============================================================================

-- ============================================================================
-- GENERIC FUNCTIONS: CALCULATE LPJ MUTATION (SNAPSHOT-BASED APPROACH)
-- ============================================================================
-- Two specialized functions for different reporting sources:
-- 1. fn_calculate_lpj_bahan_baku: For raw materials (incoming source only)
-- 2. fn_calculate_lpj_hasil_produksi: For finished/semi-finished goods (production source only)
-- 
-- All calculations are now performed directly on stock_daily_snapshot table
-- No real-time transaction processing - all data is pre-calculated and stored
-- ============================================================================

-- ============================================================================
-- FUNCTION 1: CALCULATE LPJ BAHAN BAKU (Incoming/Purchased Materials)
-- ============================================================================
-- This function calculates mutation for raw materials and purchased goods
-- Sources: For HALB - aggregates BOTH incoming_qty (purchased) AND production_qty (produced)
--          For other items (ROH, HIBE) - incoming_qty only from stock_daily_snapshot
-- Item types: ROH, HALB (from both sources), HIBE
-- 
-- Parameters:
--   p_item_types: Array of item types to filter (e.g., ARRAY['ROH', 'HALB', 'HIBE'])
--   p_start_date: Start date for accumulation (NULL = from start of year)
--   p_end_date: End date for accumulation (NULL = current date)
--
-- Return mode: Always returns aggregated records (1 row per company+item+date_range)
--   with accumulated in/out/adjustment between start and end dates
-- Data source: stock_daily_snapshot (pre-calculated daily mutations)
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
    item_code_bahasa VARCHAR(100),
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
    
    -- Return aggregated view based on provided or default date range
    RETURN QUERY
        WITH
        all_items AS (
            -- Get all distinct items that have snapshots on or before end_date
            SELECT DISTINCT
                sds.company_code,
                sds.item_code,
                sds.item_name,
                sds.item_type,
                sds.uom
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_end_date
        ),
        range_mutations AS (
            -- Aggregate mutations for items within the specified date range
            -- For HALB: include BOTH incoming_qty (purchased) + production_qty (from production output)
            -- For other items (ROH, HIBE): only incoming_qty
            -- CRITICAL: Include UOM in grouping to separate mutations by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.item_type,
                sds.uom,
                SUM(CASE 
                    WHEN sds.item_type = 'HALB' THEN sds.incoming_qty + sds.production_qty
                    ELSE sds.incoming_qty
                END) as total_incoming_qty,
                SUM(sds.outgoing_qty + sds.material_usage_qty) as total_quantity_issued_outgoing,
                SUM(sds.adjustment_qty) as total_adjustment_qty
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date BETWEEN v_start_date AND v_end_date
            GROUP BY sds.company_code, sds.item_code, sds.item_type, sds.uom
        ),
        opening_balance_data AS (
            -- Priority 1: If snapshot exists ON start_date, use its opening_balance
            -- Priority 2: Otherwise, use closing_balance from latest snapshot ON or BEFORE start_date
            -- CRITICAL: Include UOM in PARTITION BY to separate by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.uom,
                CASE 
                    WHEN sds.snapshot_date = v_start_date THEN sds.opening_balance
                    ELSE sds.closing_balance
                END as balance_value,
                ROW_NUMBER() OVER (PARTITION BY sds.company_code, sds.item_code, sds.uom ORDER BY sds.snapshot_date DESC) as rn
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_start_date
        ),
        closing_balance_data AS (
            -- Get closing_balance FIELD from snapshot ON or BEFORE end_date (most recent snapshot up to period end)
            -- CRITICAL: Include UOM in PARTITION BY to separate by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.uom,
                sds.closing_balance,
                ROW_NUMBER() OVER (PARTITION BY sds.company_code, sds.item_code, sds.uom ORDER BY sds.snapshot_date DESC) as rn
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_end_date
        )
        SELECT
            ROW_NUMBER() OVER (PARTITION BY ai.company_code ORDER BY ai.item_code, ai.uom) as no,
            ai.company_code,
            c.name as company_name,
            ai.item_code,
            COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
            ai.item_name,
            ai.item_type,
            COALESCE(ai.uom, 'UNIT')::VARCHAR(20) as unit_quantity,
            v_end_date::DATE as snapshot_date,
            COALESCE(
                (SELECT obd.balance_value FROM opening_balance_data obd 
                 WHERE obd.company_code = ai.company_code 
                   AND obd.item_code = ai.item_code 
                   AND obd.uom = ai.uom 
                   AND obd.rn = 1),
                0::NUMERIC(15,3)
            ) as opening_balance,
            COALESCE(rm.total_incoming_qty, 0)::NUMERIC(15,3) as quantity_received,
            COALESCE(rm.total_quantity_issued_outgoing, 0)::NUMERIC(15,3) as quantity_issued_outgoing,
            COALESCE(rm.total_adjustment_qty, 0)::NUMERIC(15,3) as adjustment,
            COALESCE(
                (SELECT cbd.closing_balance FROM closing_balance_data cbd 
                 WHERE cbd.company_code = ai.company_code 
                   AND cbd.item_code = ai.item_code 
                   AND cbd.uom = ai.uom 
                   AND cbd.rn = 1),
                0::NUMERIC(15,3)
            ) as closing_balance,
            NULL::NUMERIC(15,3) as stock_count_result,
            NULL::NUMERIC(15,3) as quantity_difference,
            NULL::NUMERIC(18,4) as value_amount,
            NULL::VARCHAR(3) as currency,
            'ACCUMULATED FROM ' || v_start_date::TEXT || ' TO ' || v_end_date::TEXT as remarks
        FROM all_items ai
        JOIN companies c ON ai.company_code = c.code
        LEFT JOIN item_types it ON ai.item_type = it.item_type_code
        LEFT JOIN range_mutations rm ON ai.company_code = rm.company_code AND ai.item_code = rm.item_code AND ai.uom = rm.uom
        ORDER BY ai.company_code, ai.item_code, ai.uom;
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
    item_code_bahasa VARCHAR(100),
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
    
    -- Return aggregated view based on provided or default date range
    RETURN QUERY
        WITH
        all_items AS (
            -- Get all distinct items that have snapshots on or before end_date
            SELECT DISTINCT
                sds.company_code,
                sds.item_code,
                sds.item_name,
                sds.item_type,
                sds.uom
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_end_date
        ),
        range_mutations AS (
            -- Aggregate mutations for items within the specified date range
            -- CRITICAL: Include UOM in grouping to separate mutations by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.uom,
                SUM(sds.production_qty) as total_production_qty,
                SUM(sds.outgoing_qty) as total_outgoing_qty,
                SUM(sds.adjustment_qty) as total_adjustment_qty
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date BETWEEN v_start_date AND v_end_date
            GROUP BY sds.company_code, sds.item_code, sds.uom
        ),
        opening_balance_data AS (
            -- Priority 1: If snapshot exists ON start_date, use its opening_balance
            -- Priority 2: Otherwise, use closing_balance from latest snapshot ON or BEFORE start_date
            -- CRITICAL: Include UOM in PARTITION BY to separate by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.uom,
                CASE 
                    WHEN sds.snapshot_date = v_start_date THEN sds.opening_balance
                    ELSE sds.closing_balance
                END as balance_value,
                ROW_NUMBER() OVER (PARTITION BY sds.company_code, sds.item_code, sds.uom ORDER BY sds.snapshot_date DESC) as rn
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_start_date
        ),
        closing_balance_data AS (
            -- Get closing_balance FIELD from snapshot ON or BEFORE end_date (most recent snapshot up to period end)
            -- CRITICAL: Include UOM in PARTITION BY to separate by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.uom,
                sds.closing_balance,
                ROW_NUMBER() OVER (PARTITION BY sds.company_code, sds.item_code, sds.uom ORDER BY sds.snapshot_date DESC) as rn
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_end_date
        )
        SELECT
            ROW_NUMBER() OVER (PARTITION BY ai.company_code ORDER BY ai.item_code, ai.uom) as no,
            ai.company_code,
            c.name as company_name,
            ai.item_code,
            COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
            ai.item_name,
            ai.item_type,
            COALESCE(ai.uom, 'UNIT')::VARCHAR(20) as unit_quantity,
            v_end_date::DATE as snapshot_date,
            COALESCE(
                (SELECT obd.balance_value FROM opening_balance_data obd 
                 WHERE obd.company_code = ai.company_code 
                   AND obd.item_code = ai.item_code 
                   AND obd.uom = ai.uom 
                   AND obd.rn = 1),
                0::NUMERIC(15,3)
            ) as opening_balance,
            COALESCE(rm.total_production_qty, 0)::NUMERIC(15,3) as quantity_received,
            COALESCE(rm.total_outgoing_qty, 0)::NUMERIC(15,3) as quantity_issued_outgoing,
            COALESCE(rm.total_adjustment_qty, 0)::NUMERIC(15,3) as adjustment,
            COALESCE(
                (SELECT cbd.closing_balance FROM closing_balance_data cbd 
                 WHERE cbd.company_code = ai.company_code 
                   AND cbd.item_code = ai.item_code 
                   AND cbd.uom = ai.uom 
                   AND cbd.rn = 1),
                0::NUMERIC(15,3)
            ) as closing_balance,
            NULL::NUMERIC(15,3) as stock_count_result,
            NULL::NUMERIC(15,3) as quantity_difference,
            NULL::NUMERIC(18,4) as value_amount,
            NULL::VARCHAR(3) as currency,
            'ACCUMULATED FROM ' || v_start_date::TEXT || ' TO ' || v_end_date::TEXT as remarks
        FROM all_items ai
        JOIN companies c ON ai.company_code = c.code
        LEFT JOIN item_types it ON ai.item_type = it.item_type_code
        LEFT JOIN range_mutations rm ON ai.company_code = rm.company_code AND ai.item_code = rm.item_code AND ai.uom = rm.uom
        ORDER BY ai.company_code, ai.item_code, ai.uom;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_calculate_lpj_hasil_produksi IS 
'Calculate LPJ (Laporan Pemasukan Jurnal) for finished and produced goods (FERT, HALB)
Using snapshot-only approach: sum production_qty and outgoing_qty within date range
Opening balance from closest snapshot BEFORE start_date (or 0), closing balance from end_date snapshot';

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
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
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
LEFT JOIN item_types it ON igi.item_type = it.item_type_code
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
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    ogi.item_name,
    ogi.uom as unit,
    ogi.qty as quantity,
    ogi.currency,
    ogi.amount as value_amount,
    ogi.incoming_ppkek_numbers,
    
    -- Audit fields
    og.created_at,
    og.updated_at,
    og.deleted_at
FROM outgoing_goods og
JOIN outgoing_good_items ogi ON og.company_code = ogi.outgoing_good_company
    AND og.id = ogi.outgoing_good_id
    AND og.outgoing_date = ogi.outgoing_good_date
JOIN companies c ON og.company_code = c.code
LEFT JOIN item_types it ON ogi.item_type = it.item_type_code
WHERE og.deleted_at IS NULL
  AND ogi.deleted_at IS NULL
ORDER BY og.outgoing_date DESC, og.id, ogi.id;

COMMENT ON VIEW vw_laporan_pengeluaran IS 'Report #2: Goods Issuance Report - Real-time view of outgoing goods transactions';

-- ============================================================================
-- REPORT #2.5: LAPORAN STOCK OPNAME (Stock Opname Report)
-- ============================================================================


CREATE OR REPLACE VIEW vw_laporan_stock_opname AS
SELECT 
    so.id,
    so.wms_id as sto_wms_id,
    so.company_code,
    c.name as company_name,
    so.document_date as doc_date,
    so.status,
    
    -- Item details
    soi.item_type as type_code,
    soi.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    soi.item_name,
    soi.uom as unit,
    soi.actual_qty_count as qty,
    soi.system_qty,
    soi.amount as value_amount,
    
    -- Audit fields
    so.created_at,
    so.updated_at,
    so.confirmed_at
FROM wms_stock_opnames so
JOIN wms_stock_opname_items soi ON so.id = soi.wms_stock_opname_id
    AND so.company_code = soi.company_code
JOIN companies c ON so.company_code = c.code
LEFT JOIN item_types it ON soi.item_type = it.item_type_code
ORDER BY so.document_date DESC, so.id, soi.id;

COMMENT ON VIEW vw_laporan_stock_opname IS 'Report #2.5: Stock Opname Report - Real-time view of stock opname transactions with physical count details';

-- ============================================================================
-- REPORT #2.7: LAPORAN ADJUSTMENT (Adjustment Report - Unified for Type 1 & 2)
-- ============================================================================
-- Unified report combining both adjustment types in single view
-- 
-- Type 1 (STO-Related):
--   Source: wms_stock_opnames + wms_stock_opname_items
--   Relationship: stockcount_order_number in adjustment_items references STO wms_id
--   Tracking: adjustment_id FK links STO items to adjustment
--   
-- Type 2 (Standalone):
--   Source: adjustments + adjustment_items
--   Relationship: None (stockcount_order_number = NULL)
--   Reconciliation: Calculated and stored in adjustment_items at creation time
--   
-- Display:
--   - adjustment_flow field distinguishes type ('STO_RELATED' | 'STANDALONE')
--   - internal_evidence_number available for both types
--   - Separate rows for same date if both types exist (as per requirement)

CREATE OR REPLACE VIEW vw_laporan_adjustment AS

-- ============================================================================
-- Part 1: STO-Related Adjustments (Type 1)
-- ============================================================================
-- Source: wms_stock_opnames + wms_stock_opname_items
-- Items linked via adjustment_id FK (populated when adjustment transmitted)
SELECT 
    CONCAT('STO_', waso.id) as id,
    waso.wms_id as sto_wms_id,
    adj.wms_id as adjustment_wms_id,
    adj.internal_evidence_number,
    waso.company_code,
    c.name as company_name,
    waso.document_date as doc_date,
    waso.status,
    
    -- Item details (stored directly in wms_stock_opname_items)
    wasoi.item_type as type_code,
    wasoi.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    wasoi.item_name,
    wasoi.uom as unit,
    
    -- Reconciliation (from wms_stock_opname_items - locked at POST)
    wasoi.beginning_qty,
    wasoi.incoming_qty_on_date,
    wasoi.outgoing_qty_on_date,
    wasoi.system_qty,
    
    -- Physical count & variance
    wasoi.actual_qty_count,
    wasoi.variance_qty,
    
    -- Adjustment & final state
    wasoi.adjustment_qty_signed,
    wasoi.final_adjusted_qty,
    
    -- Amount & reason
    wasoi.amount as value_amount,
    wasoi.reason,
    
    -- Flow indicator
    'STO_RELATED' as adjustment_flow,
    
    -- Audit fields
    waso.created_at,
    waso.updated_at,
    waso.confirmed_at
    
FROM wms_stock_opnames waso
JOIN wms_stock_opname_items wasoi ON wasoi.wms_stock_opname_id = waso.id
    AND wasoi.company_code = waso.company_code
LEFT JOIN adjustments adj ON adj.id = wasoi.adjustment_id
JOIN companies c ON waso.company_code = c.code
LEFT JOIN item_types it ON wasoi.item_type = it.item_type_code
WHERE wasoi.adjustment_qty_signed IS NOT NULL
  AND wasoi.adjustment_id IS NOT NULL

UNION ALL

-- ============================================================================
-- Part 2: Standalone Adjustments (Type 2)
-- ============================================================================
-- Source: adjustments + adjustment_items
-- Items with NO stock opname relationship (stockcount_order_number = NULL)
SELECT 
    CONCAT('ADJ_', ajust.id) as id,
    NULL::VARCHAR(100) as sto_wms_id,
    ajust.wms_id as adjustment_wms_id,
    ajust.internal_evidence_number,
    ajust.company_code,
    c.name as company_name,
    ajust.transaction_date as doc_date,
    NULL as status,
    
    -- Item details (stored directly in adjustment_items)
    ajust_items.item_type as type_code,
    ajust_items.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    ajust_items.item_name,
    ajust_items.uom as unit,
    
    -- Reconciliation (from adjustment_items - calculated at creation time)
    ajust_items.beginning_qty,
    ajust_items.incoming_qty_on_date,
    ajust_items.outgoing_qty_on_date,
    ajust_items.system_qty,
    
    -- Physical count & variance
    (ajust_items.system_qty + ajust_items.qty) as actual_qty_count,
    ajust_items.qty as variance_qty,
    
    -- Adjustment & final state
    ajust_items.qty as adjustment_qty_signed,
    ajust_items.adjusted_qty,
    
    -- Amount & reason
    ajust_items.amount as value_amount,
    ajust_items.reason,
    
    -- Flow indicator
    'STANDALONE' as adjustment_flow,
    
    -- Audit fields
    ajust.created_at,
    ajust.updated_at,
    NULL::TIMESTAMP as confirmed_at
    
FROM adjustments ajust
JOIN adjustment_items ajust_items ON ajust_items.adjustment_id = ajust.id
    AND ajust_items.adjustment_company = ajust.company_code
    AND ajust_items.adjustment_date = ajust.transaction_date
JOIN companies c ON ajust.company_code = c.code
LEFT JOIN item_types it ON ajust_items.item_type = it.item_type_code
WHERE ajust_items.stockcount_order_number IS NULL

ORDER BY company_code, doc_date DESC, id;

COMMENT ON VIEW vw_laporan_adjustment IS 'Report #2.7: Adjustment Report - Unified view combining both adjustment types (Type 1: STO-related via adjustment_id FK, Type 2: Standalone with calculated reconciliation). Separate rows for same date if both types exist. Columns: sto_wms_id (Type 1 only), adjustment_wms_id, internal_evidence_number, adjustment_flow (STO_RELATED|STANDALONE), all reconciliation data';

-- ============================================================================
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
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
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
LEFT JOIN item_types it ON wb.item_type = it.item_type_code
WHERE wb.deleted_at IS NULL
ORDER BY wb.company_code, wb.stock_date DESC, wb.item_code;

COMMENT ON VIEW vw_lpj_wip IS 'Report #4: Work in Process Position Report - Snapshot-based from wip_balances';

-- ============================================================================
-- REPORT #5: LPJ HASIL PRODUKSI (Finished Goods Mutation Report)
-- ============================================================================
-- Uses function for production-based goods (FERT only)
-- Item types: FERT (produced from production output only)
-- NOTE: HALB adalah BAHAN BAKU - dilaporkan di vw_lpj_bahan_baku saja
--       (Baik dari incoming maupun dari production output)
--       HALB dari production output tetap di-record di production_outputs table untuk audit trail

CREATE OR REPLACE VIEW vw_lpj_hasil_produksi AS
SELECT * FROM fn_calculate_lpj_hasil_produksi(
    ARRAY['FERT', 'HALB'],
    DATE_TRUNC('year', CURRENT_DATE)::DATE,
    CURRENT_DATE
)
WHERE item_type = 'FERT';

COMMENT ON VIEW vw_lpj_hasil_produksi IS 'Report #5: Finished Goods Mutation Report - Production-based (FERT only) - YTD. NOTE: HALB is now treated as raw material and reported in vw_lpj_bahan_baku';

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
-- This function calculates scrap mutations using hybrid approach (Snapshot + Real-time)
-- Sources: scrap_transactions (independent scrap tracking)
-- Item types: SCRAP
--
-- Parameters:
--   p_item_types: Array of item types to filter (e.g., ARRAY['SCRAP'])
--   p_start_date: Start date for accumulation (NULL = from start of year)
--   p_end_date: End date for accumulation (NULL = current date)
--
-- Return mode: Always returns aggregated records (1 row per company+item+date_range)
--   with accumulated in/out between start and end dates
-- Note: Uses hybrid approach - combines snapshot data (if available) + real-time transactions
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
    item_code_bahasa VARCHAR(100),
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
    
    -- Return aggregated view based on provided or default date range
    RETURN QUERY
        WITH
        all_items AS (
            -- Get all distinct items that have snapshots on or before end_date
            SELECT DISTINCT
                sds.company_code,
                sds.item_code,
                sds.item_name,
                sds.item_type,
                sds.uom
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_end_date
        ),
        range_mutations AS (
            -- Aggregate mutations for items within the specified date range
            -- CRITICAL: Include UOM in grouping to separate mutations by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.uom,
                SUM(sds.incoming_qty) as total_incoming_qty,
                SUM(sds.outgoing_qty) as total_outgoing_qty
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date BETWEEN v_start_date AND v_end_date
            GROUP BY sds.company_code, sds.item_code, sds.uom
        ),
        opening_balance_data AS (
            -- Priority 1: If snapshot exists ON start_date, use its opening_balance
            -- Priority 2: Otherwise, use closing_balance from latest snapshot ON or BEFORE start_date
            -- CRITICAL: Include UOM in PARTITION BY to separate by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.uom,
                CASE 
                    WHEN sds.snapshot_date = v_start_date THEN sds.opening_balance
                    ELSE sds.closing_balance
                END as balance_value,
                ROW_NUMBER() OVER (PARTITION BY sds.company_code, sds.item_code, sds.uom ORDER BY sds.snapshot_date DESC) as rn
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_start_date
        ),
        closing_balance_data AS (
            -- Get closing_balance FIELD from snapshot ON or BEFORE end_date (most recent snapshot up to period end)
            -- CRITICAL: Include UOM in PARTITION BY to separate by UOM
            SELECT
                sds.company_code,
                sds.item_code,
                sds.uom,
                sds.closing_balance,
                ROW_NUMBER() OVER (PARTITION BY sds.company_code, sds.item_code, sds.uom ORDER BY sds.snapshot_date DESC) as rn
            FROM stock_daily_snapshot sds
            WHERE sds.item_type = ANY(p_item_types)
              AND sds.snapshot_date <= v_end_date
        )
        SELECT
            ROW_NUMBER() OVER (PARTITION BY ai.company_code ORDER BY ai.item_code, ai.uom) as no,
            ai.company_code,
            c.name as company_name,
            ai.item_code,
            COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
            ai.item_name,
            ai.item_type,
            COALESCE(ai.uom, 'UNIT')::VARCHAR(20) as unit_quantity,
            v_end_date::DATE as snapshot_date,
            COALESCE(
                (SELECT obd.balance_value FROM opening_balance_data obd 
                 WHERE obd.company_code = ai.company_code 
                   AND obd.item_code = ai.item_code 
                   AND obd.uom = ai.uom 
                   AND obd.rn = 1),
                0::NUMERIC(15,3)
            ) as opening_balance,
            COALESCE(rm.total_incoming_qty, 0)::NUMERIC(15,3) as quantity_received,
            COALESCE(rm.total_outgoing_qty, 0)::NUMERIC(15,3) as quantity_issued_outgoing,
            0::NUMERIC(15,3) as adjustment,
            COALESCE(
                (SELECT cbd.closing_balance FROM closing_balance_data cbd 
                 WHERE cbd.company_code = ai.company_code 
                   AND cbd.item_code = ai.item_code 
                   AND cbd.uom = ai.uom 
                   AND cbd.rn = 1),
                0::NUMERIC(15,3)
            ) as closing_balance,
            NULL::NUMERIC(15,3) as stock_count_result,
            NULL::NUMERIC(15,3) as quantity_difference,
            NULL::NUMERIC(18,4) as value_amount,
            NULL::VARCHAR(3) as currency,
            'ACCUMULATED FROM ' || v_start_date::TEXT || ' TO ' || v_end_date::TEXT as remarks
        FROM all_items ai
        JOIN companies c ON ai.company_code = c.code
        LEFT JOIN item_types it ON ai.item_type = it.item_type_code
        LEFT JOIN range_mutations rm ON ai.company_code = rm.company_code AND ai.item_code = rm.item_code AND ai.uom = rm.uom
        ORDER BY ai.company_code, ai.item_code, ai.uom;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION fn_calculate_lpj_barang_sisa IS 
'Calculate LPJ (Laporan Pemasukan Jurnal) for scrap/waste items (SCRAP)
Using snapshot-only approach: sum incoming_qty and outgoing_qty within date range, no adjustments
Opening balance from closest snapshot BEFORE start_date (or 0), closing balance from end_date snapshot';

-- ============================================================================
-- REPORT #7: LPJ BARANG SISA / SCRAP (Scrap Mutation Report)
-- ============================================================================

CREATE OR REPLACE VIEW vw_lpj_barang_sisa AS
SELECT * FROM fn_calculate_lpj_barang_sisa(
    ARRAY['SCRAP'],
    DATE_TRUNC('year', CURRENT_DATE)::DATE,
    CURRENT_DATE
);

COMMENT ON VIEW vw_lpj_barang_sisa IS 'Report #7: Scrap/Waste Mutation Report - Independent scrap transactions (SCRAP) - YTD';

-- ============================================================================
-- REPORT #8: INTERNAL INCOMING (Production Output + Scrap Incoming + Material Usage Reversals)
-- ============================================================================
-- Real-time view combining:
-- 1. Production Output activities (goods produced internally)
-- 2. Scrap Incoming transactions (IN type)
-- 3. Material Usage Reversals (reversal='Y' - returns material to inventory)
-- Data source: production_outputs + scrap_transactions + material_usages (transaction-based)
-- Strategy: UNION ALL for optimal performance with early filtering

CREATE OR REPLACE VIEW vw_internal_incoming AS

-- Part 1: Production Output (Normal)
SELECT 
    po.id,
    po.company_code,
    c.name as company_name,
    po.internal_evidence_number,
    po.transaction_date,
    po.section,
    
    -- Item details
    poi.item_type as type_code,
    poi.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    poi.item_name,
    poi.uom as unit,
    poi.qty as quantity,
    poi.amount as value_amount
FROM production_outputs po
JOIN production_output_items poi ON po.company_code = poi.production_output_company
    AND po.id = poi.production_output_id
    AND po.transaction_date = poi.production_output_date
JOIN companies c ON po.company_code = c.code
LEFT JOIN item_types it ON poi.item_type = it.item_type_code
WHERE po.deleted_at IS NULL
  AND poi.deleted_at IS NULL
  AND po.reversal IS NULL

UNION ALL

-- Part 2: Scrap Incoming (type='IN')
SELECT 
    st.id,
    st.company_code,
    c.name as company_name,
    st.document_number::VARCHAR(50) as internal_evidence_number,
    st.transaction_date,
    'General Section'::VARCHAR(100) as section,
    
    -- Item details
    sti.item_type as type_code,
    sti.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    sti.item_name,
    sti.uom as unit,
    sti.qty as quantity,
    sti.amount::NUMERIC(19,4) as value_amount
FROM scrap_transactions st
JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
    AND st.id = sti.scrap_transaction_id
    AND st.transaction_date = sti.scrap_transaction_date
JOIN companies c ON st.company_code = c.code
LEFT JOIN item_types it ON sti.item_type = it.item_type_code
WHERE st.transaction_type = 'IN'
  AND st.deleted_at IS NULL
  AND sti.deleted_at IS NULL

UNION ALL

-- Part 3: Material Usage Reversals (reversal='Y' - acts as incoming/return)
SELECT 
    mu.id,
    mu.company_code,
    c.name as company_name,
    mu.internal_evidence_number,
    mu.transaction_date,
    mu.section,
    
    -- Item details
    mui.item_type as type_code,
    mui.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    mui.item_name,
    mui.uom as unit,
    mui.qty as quantity,
    mui.amount as value_amount
FROM material_usages mu
JOIN material_usage_items mui ON mu.company_code = mui.material_usage_company
    AND mu.id = mui.material_usage_id
    AND mu.transaction_date = mui.material_usage_date
JOIN companies c ON mu.company_code = c.code
LEFT JOIN item_types it ON mui.item_type = it.item_type_code
WHERE mu.deleted_at IS NULL
  AND mui.deleted_at IS NULL
  AND mu.reversal = 'Y'

ORDER BY transaction_date DESC, company_code, id;

COMMENT ON VIEW vw_internal_incoming IS 'Report #8: Internal Incoming - Real-time view combining production output activities, scrap incoming transactions, and material usage reversals (returns to inventory)';

-- ============================================================================
-- REPORT #9: INTERNAL OUTGOING (Material Usage + Production Output Reversals + Scrap Outgoing)
-- ============================================================================
-- Real-time view combining:
-- 1. Material Usage activities (materials consumed in production)
-- 2. Production Output Reversals (reversal='Y' - cancels production)
-- 3. Scrap Outgoing transactions (OUT type - scrap disposal)
-- Data source: material_usages + production_outputs + scrap_transactions (transaction-based)
-- Strategy: UNION ALL for optimal performance with early filtering

CREATE OR REPLACE VIEW vw_internal_outgoing AS

-- Part 1: Material Usage (Normal)
SELECT 
    mu.id,
    mu.company_code,
    c.name as company_name,
    mu.internal_evidence_number,
    mu.transaction_date,
    mu.section,
    
    -- Item details
    mui.item_type as type_code,
    mui.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    mui.item_name,
    mui.uom as unit,
    mui.qty as quantity,
    mui.amount as value_amount
FROM material_usages mu
JOIN material_usage_items mui ON mu.company_code = mui.material_usage_company
    AND mu.id = mui.material_usage_id
    AND mu.transaction_date = mui.material_usage_date
JOIN companies c ON mu.company_code = c.code
LEFT JOIN item_types it ON mui.item_type = it.item_type_code
WHERE mu.deleted_at IS NULL
  AND mui.deleted_at IS NULL
  AND mu.reversal IS NULL

UNION ALL

-- Part 2: Production Output Reversals (reversal='Y' - acts as outgoing/cancellation)
SELECT 
    po.id,
    po.company_code,
    c.name as company_name,
    po.internal_evidence_number,
    po.transaction_date,
    po.section,
    
    -- Item details
    poi.item_type as type_code,
    poi.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    poi.item_name,
    poi.uom as unit,
    poi.qty as quantity,
    poi.amount as value_amount
FROM production_outputs po
JOIN production_output_items poi ON po.company_code = poi.production_output_company
    AND po.id = poi.production_output_id
    AND po.transaction_date = poi.production_output_date
JOIN companies c ON po.company_code = c.code
LEFT JOIN item_types it ON poi.item_type = it.item_type_code
WHERE po.deleted_at IS NULL
  AND poi.deleted_at IS NULL
  AND po.reversal = 'Y'

UNION ALL

-- Part 3: Scrap Outgoing (type='OUT' - scrap disposal)
SELECT 
    st.id,
    st.company_code,
    c.name as company_name,
    st.document_number::VARCHAR(50) as internal_evidence_number,
    st.transaction_date,
    'General Section'::VARCHAR(100) as section,
    
    -- Item details
    sti.item_type as type_code,
    sti.item_code,
    COALESCE(it.name_id, '')::VARCHAR(100) as item_code_bahasa,
    sti.item_name,
    sti.uom as unit,
    sti.qty as quantity,
    sti.amount::NUMERIC(19,4) as value_amount
FROM scrap_transactions st
JOIN scrap_transaction_items sti ON st.company_code = sti.scrap_transaction_company
    AND st.id = sti.scrap_transaction_id
    AND st.transaction_date = sti.scrap_transaction_date
JOIN companies c ON st.company_code = c.code
LEFT JOIN item_types it ON sti.item_type = it.item_type_code
WHERE st.transaction_type = 'OUT'
  AND st.deleted_at IS NULL
  AND sti.deleted_at IS NULL

ORDER BY transaction_date DESC, company_code, id;

COMMENT ON VIEW vw_internal_outgoing IS 'Report #9: Internal Outgoing - Real-time view combining material usage activities, production output reversals (cancellations), and scrap outgoing transactions (disposal)';

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