-- Production hotfix: expose adjustments.wms_doc_type in vw_laporan_adjustment.
--
-- Pre-deployment verification:
-- SELECT
--     column_name,
--     ordinal_position,
--     data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'vw_laporan_adjustment'
-- ORDER BY ordinal_position;
--
-- SELECT pg_get_viewdef(
--     'public.vw_laporan_adjustment'::regclass,
--     true
-- );
--
-- If the target view already exposes the correct wms_doc_type column and
-- definition, this hotfix may be skipped. Do not rerun the full
-- scripts/sql/04_create_views.sql as a production incremental deployment.
--
-- PostgreSQL CREATE OR REPLACE VIEW compatibility:
-- wms_doc_type is appended as the final output column so existing column names,
-- order, and types remain compatible when upgrading a view that previously did
-- not expose wms_doc_type.

BEGIN;

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
    wasoi.beginning_qty::NUMERIC(15,3) as beginning_qty,
    wasoi.incoming_qty_on_date::NUMERIC(15,3) as incoming_qty_on_date,
    wasoi.outgoing_qty_on_date::NUMERIC(15,3) as outgoing_qty_on_date,
    wasoi.system_qty::NUMERIC(15,3) as system_qty,

    -- Physical count & variance
    wasoi.wms_ending::NUMERIC as wms_ending,
    wasoi.actual_qty_count::NUMERIC(15,3) as actual_qty_count,
    wasoi.variance_qty::NUMERIC(15,3) as variance_qty,
    wasoi.variance_vs_original::NUMERIC(15,3) as variance_vs_original,

    -- Adjustment & final state
    wasoi.adjustment_qty_signed::NUMERIC(15,3) as adjustment_qty_signed,
    wasoi.final_adjusted_qty::NUMERIC(15,3) as final_adjusted_qty,

    -- Amount & reason
    wasoi.amount::NUMERIC(15,4) as value_amount,
    wasoi.reason,

    -- Flow indicator
    'STO_RELATED' as adjustment_flow,

    -- Audit fields
    waso.created_at,
    waso.updated_at,
    waso.confirmed_at,

    -- Appended for safe CREATE OR REPLACE VIEW upgrade compatibility
    adj.wms_doc_type

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
    ajust_items.beginning_qty::NUMERIC(15,3) as beginning_qty,
    ajust_items.incoming_qty_on_date::NUMERIC(15,3) as incoming_qty_on_date,
    ajust_items.outgoing_qty_on_date::NUMERIC(15,3) as outgoing_qty_on_date,
    ajust_items.system_qty::NUMERIC(15,3) as system_qty,

    -- Physical count & variance
    NULL::NUMERIC as wms_ending,
    ajust_items.actual_qty_count::NUMERIC(15,3) as actual_qty_count,
    ajust_items.qty::NUMERIC(15,3) as variance_qty,
    ajust_items.variance_vs_original::NUMERIC(15,3) as variance_vs_original,

    -- Adjustment & final state
    CAST(
      CASE
        WHEN ajust_items.adjustment_type = 'LOSS' THEN -ajust_items.qty
        ELSE ajust_items.qty
      END
      AS NUMERIC(15,3)
    ) as adjustment_qty_signed,
    ajust_items.adjusted_qty::NUMERIC(15,3) as final_adjusted_qty,

    -- Amount & reason
    ajust_items.amount::NUMERIC(15,4) as value_amount,
    ajust_items.reason,

    -- Flow indicator
    'STANDALONE' as adjustment_flow,

    -- Audit fields
    ajust.created_at,
    ajust.updated_at,
    NULL::TIMESTAMP as confirmed_at,

    -- Appended for safe CREATE OR REPLACE VIEW upgrade compatibility
    ajust.wms_doc_type

FROM adjustments ajust
JOIN adjustment_items ajust_items ON ajust_items.adjustment_id = ajust.id
    AND ajust_items.adjustment_company = ajust.company_code
    AND ajust_items.adjustment_date = ajust.transaction_date
JOIN companies c ON ajust.company_code = c.code
LEFT JOIN item_types it ON ajust_items.item_type = it.item_type_code
WHERE ajust_items.stockcount_order_number IS NULL

ORDER BY company_code, doc_date DESC, id;

COMMENT ON VIEW vw_laporan_adjustment IS 'Report #2.7: Adjustment Report - Unified view combining STO-related and standalone adjustment rows. Includes appended wms_doc_type for routing revise_adjustment to Reversal Record while preserving legacy/null rows.';

COMMIT;
