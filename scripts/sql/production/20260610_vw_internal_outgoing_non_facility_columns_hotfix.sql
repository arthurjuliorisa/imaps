-- =============================================================================
-- iMAPS Production Hotfix
-- vw_internal_outgoing non-facility Material Usage support columns
--
-- Safe production hotfix command:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/sql/production/20260610_vw_internal_outgoing_non_facility_columns_hotfix.sql
--
-- This patch is non-destructive:
--   - replaces only public.vw_internal_outgoing;
--   - preserves existing columns and appends/maintains source metadata columns;
--   - does not drop the view with CASCADE;
--   - does not change tables, Prisma migrations, application code, or other views.
-- =============================================================================

CREATE OR REPLACE VIEW vw_internal_outgoing AS

-- Part 1: Material Usage (Normal)
SELECT
    mu.id,
    mu.wms_id,
    mu.company_code,
    c.name as company_name,
    c.company_type,
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
    mui.amount as value_amount,
    'MATERIAL_USAGE'::VARCHAR(50) as source_type,
    'material_usage_items'::VARCHAR(100) as source_table,
    mui.id as source_item_id,
    mui.ppkek_number,
    (mui.ppkek_number = 'N') as is_non_facility
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
    po.wms_id,
    po.company_code,
    c.name as company_name,
    c.company_type,
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
    poi.amount as value_amount,
    'PRODUCTION_OUTPUT_REVERSAL'::VARCHAR(50) as source_type,
    'production_output_items'::VARCHAR(100) as source_table,
    poi.id as source_item_id,
    NULL::VARCHAR(50) as ppkek_number,
    false as is_non_facility
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
    st.document_number as wms_id,
    st.company_code,
    c.name as company_name,
    c.company_type,
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
    sti.amount::NUMERIC(19,4) as value_amount,
    'SCRAP_TRANSACTION'::VARCHAR(50) as source_type,
    'scrap_transaction_items'::VARCHAR(100) as source_table,
    sti.id as source_item_id,
    NULL::VARCHAR(50) as ppkek_number,
    false as is_non_facility
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

-- =============================================================================
-- Manual verification SQL
-- =============================================================================

-- Verify columns exist
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'vw_internal_outgoing'
--   AND column_name IN (
--     'source_type',
--     'source_table',
--     'source_item_id',
--     'ppkek_number',
--     'is_non_facility'
--   )
-- ORDER BY ordinal_position;

-- Verify Material Usage non-facility rows are exposed
-- SELECT source_type, source_table, ppkek_number, is_non_facility, COUNT(*)
-- FROM vw_internal_outgoing
-- GROUP BY source_type, source_table, ppkek_number, is_non_facility
-- ORDER BY source_type, ppkek_number NULLS LAST;
