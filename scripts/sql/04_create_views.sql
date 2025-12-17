-- ============================================================================
-- IMAPS REPORTING VIEWS - Regular Views for Real-Time Data Access
-- ============================================================================
-- Version: 2.4.0
-- Created: December 13, 2025
-- Purpose: Create regular views (NOT materialized) for customs compliance reports
-- 
-- IMPORTANT: These are REGULAR VIEWS for guaranteed real-time data access
-- Critical for customs inspector access to current data
-- ============================================================================

-- ============================================================================
-- REPORT #1: LAPORAN PEMASUKAN (Goods Receiving Report / Incoming Goods)
-- ============================================================================

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
JOIN incoming_good_items igi ON ig.id = igi.incoming_good_id
JOIN companies c ON ig.company_code = c.code
WHERE ig.deleted_at IS NULL
  AND igi.deleted_at IS NULL
ORDER BY ig.incoming_date DESC, ig.id, igi.id;

COMMENT ON VIEW vw_laporan_pemasukan IS 'Report #1: Goods Receiving Report - Real-time view of incoming goods transactions';

-- ============================================================================
-- REPORT #2: LAPORAN PENGELUARAN (Goods Issuance Report / Outgoing Goods)
-- ============================================================================

CREATE OR REPLACE VIEW vw_laporan_pengeluaran AS
SELECT 
    og.id,
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
JOIN outgoing_good_items ogi ON og.id = ogi.outgoing_good_id
JOIN companies c ON og.company_code = c.code
WHERE og.deleted_at IS NULL
  AND ogi.deleted_at IS NULL
ORDER BY og.outgoing_date DESC, og.id, ogi.id;

COMMENT ON VIEW vw_laporan_pengeluaran IS 'Report #2: Goods Issuance Report - Real-time view of outgoing goods transactions';

-- ============================================================================
-- REPORT #3: LPJ BAHAN BAKU DAN BAHAN PENOLONG 
-- (Raw Material and Auxiliary Material Mutation Report)
-- ============================================================================

CREATE OR REPLACE VIEW vw_lpj_bahan_baku AS
WITH 
-- Opening balance (from beginning_balances or calculated)
opening_balance AS (
    SELECT 
        company_code,
        item_code,
        item_name,
        item_type,
        uom,
        qty as opening_qty
    FROM beginning_balances
    WHERE item_type IN ('ROH', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T')
      AND deleted_at IS NULL
),
-- Incoming quantities (receipts)
incoming_qty AS (
    SELECT 
        ig.company_code,
        igi.item_code,
        igi.item_name,
        igi.item_type,
        igi.uom,
        SUM(igi.qty) as received_qty
    FROM incoming_goods ig
    JOIN incoming_good_items igi ON ig.id = igi.incoming_good_id
    WHERE igi.item_type IN ('ROH', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T')
      AND ig.deleted_at IS NULL
      AND igi.deleted_at IS NULL
    GROUP BY ig.company_code, igi.item_code, igi.item_name, igi.item_type, igi.uom
),
-- Outgoing quantities (issuance) - including material usage and outgoing goods
material_issued AS (
    SELECT 
        mu.company_code,
        mui.item_code,
        mui.item_name,
        mui.item_type,
        mui.uom,
        SUM(CASE 
            WHEN mu.reversal = 'Y' THEN -mui.qty  -- Return to warehouse (negative issuance)
            ELSE mui.qty 
        END) as issued_qty
    FROM material_usages mu
    JOIN material_usage_items mui ON mu.id = mui.material_usage_id
    WHERE mui.item_type IN ('ROH', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T')
      AND mu.deleted_at IS NULL
      AND mui.deleted_at IS NULL
    GROUP BY mu.company_code, mui.item_code, mui.item_name, mui.item_type, mui.uom
),
outgoing_issued AS (
    SELECT 
        og.company_code,
        ogi.item_code,
        ogi.item_name,
        ogi.item_type,
        ogi.uom,
        SUM(ogi.qty) as issued_qty
    FROM outgoing_goods og
    JOIN outgoing_good_items ogi ON og.id = ogi.outgoing_good_id
    WHERE ogi.item_type IN ('ROH', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T')
      AND og.deleted_at IS NULL
      AND ogi.deleted_at IS NULL
    GROUP BY og.company_code, ogi.item_code, ogi.item_name, ogi.item_type, ogi.uom
),
total_issued AS (
    SELECT 
        company_code,
        item_code,
        item_name,
        item_type,
        uom,
        SUM(issued_qty) as total_issued_qty
    FROM (
        SELECT * FROM material_issued
        UNION ALL
        SELECT * FROM outgoing_issued
    ) combined
    GROUP BY company_code, item_code, item_name, item_type, uom
),
-- Adjustments (gains and losses)
adjustments_summary AS (
    SELECT 
        a.company_code,
        ai.item_code,
        ai.item_name,
        ai.item_type,
        ai.uom,
        SUM(CASE WHEN ai.adjustment_type = 'GAIN' THEN ai.qty ELSE 0 END) as gain_qty,
        SUM(CASE WHEN ai.adjustment_type = 'LOSS' THEN ai.qty ELSE 0 END) as loss_qty,
        SUM(CASE WHEN ai.adjustment_type = 'GAIN' THEN ai.qty ELSE -ai.qty END) as net_adjustment
    FROM adjustments a
    JOIN adjustment_items ai ON a.id = ai.adjustment_id
    WHERE ai.item_type IN ('ROH', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T')
      AND a.deleted_at IS NULL
      AND ai.deleted_at IS NULL
    GROUP BY a.company_code, ai.item_code, ai.item_name, ai.item_type, ai.uom
)
-- Final mutation report
SELECT 
    ROW_NUMBER() OVER (PARTITION BY i.company_code ORDER BY i.item_code) as no,
    i.company_code,
    c.name as company_name,
    i.item_code,
    i.item_name,
    i.item_type,
    i.uom as unit_quantity,
    COALESCE(ob.opening_qty, 0) as opening_balance,
    COALESCE(inc.received_qty, 0) as quantity_received,
    COALESCE(ti.total_issued_qty, 0) as quantity_issued_outgoing,
    COALESCE(adj.net_adjustment, 0) as adjustment,
    -- Closing balance calculation
    COALESCE(ob.opening_qty, 0) + 
    COALESCE(inc.received_qty, 0) - 
    COALESCE(ti.total_issued_qty, 0) + 
    COALESCE(adj.net_adjustment, 0) as closing_balance,
    NULL::NUMERIC(15,3) as stock_count_result,  -- Placeholder for physical count
    NULL::NUMERIC(15,3) as quantity_difference, -- Placeholder for variance
    NULL::TEXT as remarks
FROM items i
JOIN companies c ON i.company_code = c.code
LEFT JOIN opening_balance ob ON i.company_code = ob.company_code AND i.item_code = ob.item_code
LEFT JOIN incoming_qty inc ON i.company_code = inc.company_code AND i.item_code = inc.item_code
LEFT JOIN total_issued ti ON i.company_code = ti.company_code AND i.item_code = ti.item_code
LEFT JOIN adjustments_summary adj ON i.company_code = adj.company_code AND i.item_code = adj.item_code
WHERE i.item_type IN ('ROH', 'HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T')
  AND i.deleted_at IS NULL
ORDER BY i.company_code, i.item_code;

COMMENT ON VIEW vw_lpj_bahan_baku IS 'Report #3: Raw Material and Auxiliary Material Mutation Report - Includes ROH and HIBE types';

-- ============================================================================
-- REPORT #4: LPJ WIP (Work in Process Position Report)
-- ============================================================================

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

COMMENT ON VIEW vw_lpj_wip IS 'Report #4: Work in Process Position Report - Daily WIP snapshots';

-- ============================================================================
-- REPORT #5: LPJ HASIL PRODUKSI (Finished Goods Mutation Report / Production Output)
-- ============================================================================

CREATE OR REPLACE VIEW vw_lpj_hasil_produksi AS
WITH 
-- Opening balance for finished goods
opening_balance AS (
    SELECT 
        company_code,
        item_code,
        item_name,
        item_type,
        uom,
        qty as opening_qty
    FROM beginning_balances
    WHERE item_type IN ('FERT', 'HALB')
      AND deleted_at IS NULL
),
-- Received quantities (production output + incoming FERT)
production_received AS (
    SELECT 
        po.company_code,
        poi.item_code,
        poi.item_name,
        poi.item_type,
        poi.uom,
        SUM(CASE 
            WHEN po.reversal = 'Y' THEN -poi.qty  -- Return from warehouse (negative production)
            ELSE poi.qty 
        END) as received_qty
    FROM production_outputs po
    JOIN production_output_items poi ON po.id = poi.production_output_id
    WHERE poi.item_type IN ('FERT', 'HALB')
      AND po.deleted_at IS NULL
      AND poi.deleted_at IS NULL
    GROUP BY po.company_code, poi.item_code, poi.item_name, poi.item_type, poi.uom
),
incoming_fert AS (
    SELECT 
        ig.company_code,
        igi.item_code,
        igi.item_name,
        igi.item_type,
        igi.uom,
        SUM(igi.qty) as received_qty
    FROM incoming_goods ig
    JOIN incoming_good_items igi ON ig.id = igi.incoming_good_id
    WHERE igi.item_type IN ('FERT', 'HALB')
      AND ig.deleted_at IS NULL
      AND igi.deleted_at IS NULL
    GROUP BY ig.company_code, igi.item_code, igi.item_name, igi.item_type, igi.uom
),
total_received AS (
    SELECT 
        company_code,
        item_code,
        item_name,
        item_type,
        uom,
        SUM(received_qty) as total_received_qty
    FROM (
        SELECT * FROM production_received
        UNION ALL
        SELECT * FROM incoming_fert
    ) combined
    GROUP BY company_code, item_code, item_name, item_type, uom
),
-- Outgoing finished goods
outgoing_fert AS (
    SELECT 
        og.company_code,
        ogi.item_code,
        ogi.item_name,
        ogi.item_type,
        ogi.uom,
        SUM(ogi.qty) as issued_qty
    FROM outgoing_goods og
    JOIN outgoing_good_items ogi ON og.id = ogi.outgoing_good_id
    WHERE ogi.item_type IN ('FERT', 'HALB')
      AND og.deleted_at IS NULL
      AND ogi.deleted_at IS NULL
    GROUP BY og.company_code, ogi.item_code, ogi.item_name, ogi.item_type, ogi.uom
),
-- Adjustments for finished goods
adjustments_fert AS (
    SELECT 
        a.company_code,
        ai.item_code,
        ai.item_name,
        ai.item_type,
        ai.uom,
        SUM(CASE WHEN ai.adjustment_type = 'GAIN' THEN ai.qty ELSE -ai.qty END) as net_adjustment
    FROM adjustments a
    JOIN adjustment_items ai ON a.id = ai.adjustment_id
    WHERE ai.item_type IN ('FERT', 'HALB')
      AND a.deleted_at IS NULL
      AND ai.deleted_at IS NULL
    GROUP BY a.company_code, ai.item_code, ai.item_name, ai.item_type, ai.uom
)
-- Final mutation report
SELECT 
    ROW_NUMBER() OVER (PARTITION BY i.company_code ORDER BY i.item_code) as no,
    i.company_code,
    c.name as company_name,
    i.item_code,
    i.item_name,
    i.item_type,
    i.uom as unit_quantity,
    COALESCE(ob.opening_qty, 0) as opening_balance,
    COALESCE(tr.total_received_qty, 0) as quantity_received,
    COALESCE(og.issued_qty, 0) as quantity_issued_outgoing,
    COALESCE(adj.net_adjustment, 0) as adjustment,
    -- Closing balance calculation
    COALESCE(ob.opening_qty, 0) + 
    COALESCE(tr.total_received_qty, 0) - 
    COALESCE(og.issued_qty, 0) + 
    COALESCE(adj.net_adjustment, 0) as closing_balance,
    NULL::NUMERIC(15,3) as stock_count_result,
    NULL::NUMERIC(15,3) as quantity_difference,
    NULL::TEXT as remarks
FROM items i
JOIN companies c ON i.company_code = c.code
LEFT JOIN opening_balance ob ON i.company_code = ob.company_code AND i.item_code = ob.item_code
LEFT JOIN total_received tr ON i.company_code = tr.company_code AND i.item_code = tr.item_code
LEFT JOIN outgoing_fert og ON i.company_code = og.company_code AND i.item_code = og.item_code
LEFT JOIN adjustments_fert adj ON i.company_code = adj.company_code AND i.item_code = adj.item_code
WHERE i.item_type IN ('FERT', 'HALB')
  AND i.deleted_at IS NULL
ORDER BY i.company_code, i.item_code;

COMMENT ON VIEW vw_lpj_hasil_produksi IS 'Report #5: Finished Goods Mutation Report - Production output and finished goods inventory';

-- ============================================================================
-- REPORT #6: LPJ BARANG MODAL (Capital Goods and Other Items Mutation Report)
-- ============================================================================
-- NOTE: Capital goods are HIBE_M, HIBE_E, HIBE_T (machines, engineering, tools)
-- This is separate from Report #3 which includes HIBE (operating supplies)

CREATE OR REPLACE VIEW vw_lpj_barang_modal AS
WITH 
-- Opening balance for capital goods
opening_balance AS (
    SELECT 
        company_code,
        item_code,
        item_name,
        item_type,
        uom,
        qty as opening_qty
    FROM beginning_balances
    WHERE item_type IN ('HIBE_M', 'HIBE_E', 'HIBE_T')
      AND deleted_at IS NULL
),
-- Incoming capital goods
incoming_qty AS (
    SELECT 
        ig.company_code,
        igi.item_code,
        igi.item_name,
        igi.item_type,
        igi.uom,
        SUM(igi.qty) as received_qty,
        SUM(igi.amount) as total_value,
        MAX(igi.currency) as currency
    FROM incoming_goods ig
    JOIN incoming_good_items igi ON ig.id = igi.incoming_good_id
    WHERE igi.item_type IN ('HIBE_M', 'HIBE_E', 'HIBE_T')
      AND ig.deleted_at IS NULL
      AND igi.deleted_at IS NULL
    GROUP BY ig.company_code, igi.item_code, igi.item_name, igi.item_type, igi.uom
),
-- Outgoing capital goods (disposal or transfer)
outgoing_qty AS (
    SELECT 
        og.company_code,
        ogi.item_code,
        ogi.item_name,
        ogi.item_type,
        ogi.uom,
        SUM(ogi.qty) as issued_qty
    FROM outgoing_goods og
    JOIN outgoing_good_items ogi ON og.id = ogi.outgoing_good_id
    WHERE ogi.item_type IN ('HIBE_M', 'HIBE_E', 'HIBE_T')
      AND og.deleted_at IS NULL
      AND ogi.deleted_at IS NULL
    GROUP BY og.company_code, ogi.item_code, ogi.item_name, ogi.item_type, ogi.uom
),
-- Adjustments for capital goods
adjustments_cg AS (
    SELECT 
        a.company_code,
        ai.item_code,
        ai.item_name,
        ai.item_type,
        ai.uom,
        SUM(CASE WHEN ai.adjustment_type = 'GAIN' THEN ai.qty ELSE -ai.qty END) as net_adjustment
    FROM adjustments a
    JOIN adjustment_items ai ON a.id = ai.adjustment_id
    WHERE ai.item_type IN ('HIBE_M', 'HIBE_E', 'HIBE_T')
      AND a.deleted_at IS NULL
      AND ai.deleted_at IS NULL
    GROUP BY a.company_code, ai.item_code, ai.item_name, ai.item_type, ai.uom
)
-- Final mutation report
SELECT 
    ROW_NUMBER() OVER (PARTITION BY i.company_code ORDER BY i.item_code) as no,
    i.company_code,
    c.name as company_name,
    i.item_code,
    i.item_name,
    i.item_type,
    i.uom as unit_quantity,
    COALESCE(ob.opening_qty, 0) as opening_balance,
    COALESCE(inc.received_qty, 0) as quantity_received,
    COALESCE(og.issued_qty, 0) as quantity_issued_outgoing,
    COALESCE(adj.net_adjustment, 0) as adjustment,
    -- Closing balance calculation
    COALESCE(ob.opening_qty, 0) + 
    COALESCE(inc.received_qty, 0) - 
    COALESCE(og.issued_qty, 0) + 
    COALESCE(adj.net_adjustment, 0) as closing_balance,
    NULL::NUMERIC(15,3) as stock_count_result,
    NULL::NUMERIC(15,3) as quantity_difference,
    inc.total_value as value_amount,
    inc.currency,
    NULL::TEXT as remarks
FROM items i
JOIN companies c ON i.company_code = c.code
LEFT JOIN opening_balance ob ON i.company_code = ob.company_code AND i.item_code = ob.item_code
LEFT JOIN incoming_qty inc ON i.company_code = inc.company_code AND i.item_code = inc.item_code
LEFT JOIN outgoing_qty og ON i.company_code = og.company_code AND i.item_code = og.item_code
LEFT JOIN adjustments_cg adj ON i.company_code = adj.company_code AND i.item_code = adj.item_code
WHERE i.item_type IN ('HIBE_M', 'HIBE_E', 'HIBE_T')
  AND i.deleted_at IS NULL
ORDER BY i.company_code, i.item_code;

COMMENT ON VIEW vw_lpj_barang_modal IS 'Report #6: Capital Goods Mutation Report - HIBE_M/E/T (machines, engineering, tools)';

-- ============================================================================
-- REPORT #7: LPJ BARANG SISA / SCRAP 
-- (Rejected Goods and Production Scrap/Waste Mutation Report)
-- ============================================================================
-- NOTE: SCRAP is handled via manual upload (not API)
-- This view shows SCRAP transactions from adjustments and manual entries

CREATE OR REPLACE VIEW vw_lpj_barang_sisa AS
WITH 
-- Opening balance for scrap
opening_balance AS (
    SELECT 
        company_code,
        item_code,
        item_name,
        item_type,
        uom,
        qty as opening_qty
    FROM beginning_balances
    WHERE item_type = 'SCRAP'
      AND deleted_at IS NULL
),
-- Incoming scrap (manual upload or from adjustments)
incoming_scrap AS (
    SELECT 
        ig.company_code,
        igi.item_code,
        igi.item_name,
        igi.item_type,
        igi.uom,
        SUM(igi.qty) as received_qty,
        SUM(igi.amount) as total_value,
        MAX(igi.currency) as currency
    FROM incoming_goods ig
    JOIN incoming_good_items igi ON ig.id = igi.incoming_good_id
    WHERE igi.item_type = 'SCRAP'
      AND ig.deleted_at IS NULL
      AND igi.deleted_at IS NULL
    GROUP BY ig.company_code, igi.item_code, igi.item_name, igi.item_type, igi.uom
),
-- Outgoing scrap (disposal - from manual CEISA download)
outgoing_scrap AS (
    SELECT 
        og.company_code,
        ogi.item_code,
        ogi.item_name,
        ogi.item_type,
        ogi.uom,
        SUM(ogi.qty) as issued_qty
    FROM outgoing_goods og
    JOIN outgoing_good_items ogi ON og.id = ogi.outgoing_good_id
    WHERE ogi.item_type = 'SCRAP'
      AND og.deleted_at IS NULL
      AND ogi.deleted_at IS NULL
    GROUP BY og.company_code, ogi.item_code, ogi.item_name, ogi.item_type, ogi.uom
),
-- Adjustments for scrap (gains from production waste)
adjustments_scrap AS (
    SELECT 
        a.company_code,
        ai.item_code,
        ai.item_name,
        ai.item_type,
        ai.uom,
        SUM(CASE WHEN ai.adjustment_type = 'GAIN' THEN ai.qty ELSE -ai.qty END) as net_adjustment
    FROM adjustments a
    JOIN adjustment_items ai ON a.id = ai.adjustment_id
    WHERE ai.item_type = 'SCRAP'
      AND a.deleted_at IS NULL
      AND ai.deleted_at IS NULL
    GROUP BY a.company_code, ai.item_code, ai.item_name, ai.item_type, ai.uom
)
-- Final mutation report
SELECT 
    ROW_NUMBER() OVER (PARTITION BY i.company_code ORDER BY i.item_code) as no,
    i.company_code,
    c.name as company_name,
    i.item_code,
    i.item_name,
    i.item_type,
    i.uom as unit_quantity,
    COALESCE(ob.opening_qty, 0) as opening_balance,
    COALESCE(inc.received_qty, 0) as quantity_received,
    COALESCE(og.issued_qty, 0) as quantity_issued_outgoing,
    COALESCE(adj.net_adjustment, 0) as adjustment,
    -- Closing balance calculation
    COALESCE(ob.opening_qty, 0) + 
    COALESCE(inc.received_qty, 0) - 
    COALESCE(og.issued_qty, 0) + 
    COALESCE(adj.net_adjustment, 0) as closing_balance,
    NULL::NUMERIC(15,3) as stock_count_result,
    NULL::NUMERIC(15,3) as quantity_difference,
    inc.total_value as value_amount,
    inc.currency,
    NULL::TEXT as remarks
FROM items i
JOIN companies c ON i.company_code = c.code
LEFT JOIN opening_balance ob ON i.company_code = ob.company_code AND i.item_code = ob.item_code
LEFT JOIN incoming_scrap inc ON i.company_code = inc.company_code AND i.item_code = inc.item_code
LEFT JOIN outgoing_scrap og ON i.company_code = og.company_code AND i.item_code = og.item_code
LEFT JOIN adjustments_scrap adj ON i.company_code = adj.company_code AND i.item_code = adj.item_code
WHERE i.item_type = 'SCRAP'
  AND i.deleted_at IS NULL
ORDER BY i.company_code, i.item_code;

COMMENT ON VIEW vw_lpj_barang_sisa IS 'Report #7: Scrap/Waste Mutation Report - SCRAP items (manual upload + adjustments)';

-- ============================================================================
-- ADDITIONAL HELPER VIEWS
-- ============================================================================

-- Current stock summary (all item types)
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
    UNION ALL
    SELECT company_code, item_code, item_type, closing_balance FROM vw_lpj_barang_sisa
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

-- ============================================================================
-- GRANT PERMISSIONS (adjust as needed for your environment)
-- ============================================================================
-- Example: Grant SELECT on views to reporting role
-- GRANT SELECT ON ALL TABLES IN SCHEMA public TO reporting_role;

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
-- Run these to verify views are working correctly:

-- Test Report #1: Incoming Goods
-- SELECT * FROM vw_laporan_pemasukan WHERE company_code = 1370 LIMIT 10;

-- Test Report #2: Outgoing Goods
-- SELECT * FROM vw_laporan_pengeluaran WHERE company_code = 1370 LIMIT 10;

-- Test Report #3: Raw Material Mutation
-- SELECT * FROM vw_lpj_bahan_baku WHERE company_code = 1370 LIMIT 10;

-- Test Report #4: WIP Position
-- SELECT * FROM vw_lpj_wip WHERE company_code = 1370 LIMIT 10;

-- Test Report #5: Finished Goods Mutation
-- SELECT * FROM vw_lpj_hasil_produksi WHERE company_code = 1370 LIMIT 10;

-- Test Report #6: Capital Goods Mutation
-- SELECT * FROM vw_lpj_barang_modal WHERE company_code = 1370 LIMIT 10;

-- Test Report #7: Scrap Mutation
-- SELECT * FROM vw_lpj_barang_sisa WHERE company_code = 1370 LIMIT 10;

-- Test Summary Views
-- SELECT * FROM vw_current_stock_summary;
-- SELECT * FROM vw_transaction_volume_summary WHERE month >= DATE_TRUNC('month', CURRENT_DATE - INTERVAL '3 months');

-- ============================================================================
-- MAINTENANCE NOTES
-- ============================================================================
-- 1. These are REGULAR VIEWS (not materialized) for guaranteed real-time data
-- 2. Views automatically reflect latest data from base tables
-- 3. No REFRESH needed (unlike materialized views)
-- 4. Performance depends on base table indexes and partitioning
-- 5. Monitor view query performance and add indexes as needed
-- 6. Consider query result caching at application layer if needed

-- ============================================================================
-- END OF VIEWS CREATION
-- ============================================================================