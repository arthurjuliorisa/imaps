-- =============================================================================
-- iMAPS Database Schema - Core Functions (Fixed)
-- File: 08_functions.sql
-- Purpose: Stock calculation and traceability population functions
-- Compatible with: schema.prisma v2.4 + setup_partitions.sql + 05_traceability_tables.sql
-- Version: Fixed - Dollar-quoting corrected
-- =============================================================================

-- =============================================================================
-- 1. CALCULATE STOCK SNAPSHOT (Main Function)
-- =============================================================================

-- Ensure yearly partition for stock_daily_snapshot exists
CREATE OR REPLACE FUNCTION ensure_stock_daily_snapshot_partition(
    p_snapshot_date DATE
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
    v_year TEXT := to_char(p_snapshot_date, 'YYYY');
    v_start DATE := date_trunc('year', p_snapshot_date)::date;
    v_end   DATE := (date_trunc('year', p_snapshot_date) + INTERVAL '1 year')::date;
    v_partition REGCLASS := to_regclass(format('stock_daily_snapshot_%s', v_year));
    v_partition_name TEXT := format('stock_daily_snapshot_%s', v_year);
BEGIN
    IF v_partition IS NULL THEN
        EXECUTE format(
            'CREATE TABLE %I PARTITION OF stock_daily_snapshot FOR VALUES FROM (%L) TO (%L)',
            v_partition_name,
            v_start,
            v_end
        );
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION calculate_stock_snapshot(
    p_company_code INTEGER,
    p_snapshot_date DATE
)
RETURNS void 
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'calculate_stock_snapshot(integer,date) is disabled because the legacy implementation was UOM-blind and can corrupt mixed-UOM stock. Use upsert_item_stock_snapshot(...) or recalculate_item_snapshots_from_date(...) instead. company_code=%, snapshot_date=%',
        p_company_code,
        p_snapshot_date;
END;
$$;

COMMENT ON FUNCTION calculate_stock_snapshot IS 'Disabled legacy UOM-blind daily stock snapshot function. Use item-level snapshot recalculation functions instead.';

-- =============================================================================
-- 2. CALCULATE STOCK SNAPSHOT RANGE
-- =============================================================================

CREATE OR REPLACE FUNCTION calculate_stock_snapshot_range(
    p_company_code INTEGER,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS void 
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'calculate_stock_snapshot_range(integer,date,date) is disabled because it delegates to legacy UOM-blind calculate_stock_snapshot(...). Use item-level recalculation instead. company_code=%, start_date=%, end_date=%',
        p_company_code,
        p_start_date,
        p_end_date;
END;
$$;

COMMENT ON FUNCTION calculate_stock_snapshot_range IS 'Disabled legacy UOM-blind stock snapshot range function. Use item-level snapshot recalculation functions instead.';

-- =============================================================================
-- 3. POPULATE WORK ORDER MATERIAL CONSUMPTION
-- =============================================================================

CREATE OR REPLACE FUNCTION populate_work_order_material_consumption(
    p_material_usage_wms_id VARCHAR(100)
)
RETURNS void 
LANGUAGE plpgsql
AS $$
DECLARE
    v_rows_inserted INTEGER := 0;
BEGIN
    -- Delete existing traceability for this material usage
    DELETE FROM work_order_material_consumption 
    WHERE material_usage_wms_id = p_material_usage_wms_id;
    
    -- Insert traceability records
    INSERT INTO work_order_material_consumption (
        material_usage_id,
        material_usage_item_id,
        material_usage_wms_id,
        work_order_number,
        company_code,
        item_code,
        ppkek_number,
        qty_consumed,
        trx_date
    )
    SELECT 
        mu.id AS material_usage_id,
        mui.id AS material_usage_item_id,
        mu.wms_id AS material_usage_wms_id,
        mu.work_order_number,
        mu.company_code,
        mui.item_code,
        mui.ppkek_number,
        mui.qty AS qty_consumed,
        mu.transaction_date AS trx_date
    FROM material_usages mu
    JOIN material_usage_items mui ON mu.id = mui.material_usage_id
    WHERE mu.wms_id = p_material_usage_wms_id
      AND mu.work_order_number IS NOT NULL  -- Only for production (not cost center)
      AND mu.deleted_at IS NULL
      AND mui.deleted_at IS NULL;
    
    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    
    RAISE NOTICE 'Populated work order material consumption for %: % rows', 
        p_material_usage_wms_id, v_rows_inserted;
END;
$$;

COMMENT ON FUNCTION populate_work_order_material_consumption IS 'Populate traceability linking materials to work orders';

-- =============================================================================
-- 4. POPULATE WORK ORDER FG PRODUCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION populate_work_order_fg_production(
    p_production_wms_id VARCHAR(100)
)
RETURNS void 
LANGUAGE plpgsql
AS $func$
DECLARE
    v_rows_inserted INTEGER := 0;
BEGIN
    -- Delete existing traceability for this production output
    DELETE FROM work_order_fg_production 
    WHERE production_wms_id = p_production_wms_id;
    
    -- Insert traceability records (explode work_order_numbers array)
    INSERT INTO work_order_fg_production (
        production_output_id,
        production_output_item_id,
        production_wms_id,
        work_order_number,
        company_code,
        item_type,
        item_code,
        qty_produced,
        trx_date
    )
    SELECT 
        po.id AS production_output_id,
        poi.id AS production_output_item_id,
        po.wms_id AS production_wms_id,
        UNNEST(poi.work_order_numbers) AS work_order_number,  -- Explode array
        po.company_code,
        poi.item_type,
        poi.item_code,
        poi.qty AS qty_produced,
        po.transaction_date AS trx_date
    FROM production_outputs po
    JOIN production_output_items poi ON po.id = poi.production_output_id
    WHERE po.wms_id = p_production_wms_id
      AND poi.item_type IN ('FERT', 'HALB')  -- Only finished/semifinished goods
      AND po.deleted_at IS NULL
      AND poi.deleted_at IS NULL;
    
    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    
    RAISE NOTICE 'Populated work order FG production for %: % rows', 
        p_production_wms_id, v_rows_inserted;
END;
$func$;

COMMENT ON FUNCTION populate_work_order_fg_production IS 'Populate traceability linking work orders to finished/semifinished goods';

-- =============================================================================
-- 5. QUEUE SNAPSHOT RECALCULATION
-- =============================================================================

CREATE OR REPLACE FUNCTION queue_snapshot_recalculation(
    p_company_code INTEGER,
    p_recalc_date DATE,
    p_item_type VARCHAR(10) DEFAULT NULL,
    p_item_code VARCHAR(50) DEFAULT NULL,
    p_reason VARCHAR(500) DEFAULT NULL,
    p_priority INTEGER DEFAULT 0
)
RETURNS BIGINT 
LANGUAGE plpgsql
AS $$
DECLARE
    v_queue_id BIGINT;
BEGIN
    INSERT INTO snapshot_recalc_queue (
        company_code,
        item_type,
        item_code,
        recalc_date,
        status,
        priority,
        reason
    ) VALUES (
        p_company_code,
        p_item_type,
        p_item_code,
        p_recalc_date,
        'PENDING'::recalc_status,
        p_priority,
        p_reason
    ) RETURNING id INTO v_queue_id;
    
    RAISE NOTICE 'Queued snapshot recalculation: ID=%, Company=%, Date=%, Priority=%', 
        v_queue_id, p_company_code, p_recalc_date, p_priority;
    
    RETURN v_queue_id;
END;
$$;

COMMENT ON FUNCTION queue_snapshot_recalculation IS 'Queue snapshot recalculation for backdated transactions';

-- =============================================================================
-- 6. PROCESS RECALC QUEUE (Worker Function)
-- =============================================================================

CREATE OR REPLACE FUNCTION process_recalc_queue(
    p_batch_size INTEGER DEFAULT 10
)
RETURNS INTEGER 
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'process_recalc_queue(integer) is disabled because it delegates to legacy UOM-blind calculate_stock_snapshot(...). Use direct item-level snapshot recalculation instead.';
END;
$$;

COMMENT ON FUNCTION process_recalc_queue IS 'Disabled legacy queue worker because it delegates to UOM-blind calculate_stock_snapshot(...). Use direct item-level snapshot recalculation instead.';

-- =============================================================================
-- USAGE EXAMPLES
-- =============================================================================

-- Legacy snapshot functions are disabled and should fail explicitly:
-- SELECT calculate_stock_snapshot(1310, '2026-12-14');

-- Legacy snapshot range is disabled and should fail explicitly:
-- SELECT calculate_stock_snapshot_range(1310, '2026-12-01', '2026-12-31');

-- Populate traceability after material usage insert
-- SELECT populate_work_order_material_consumption('MAT-1310-20261214-001');

-- Populate traceability after production output insert
-- SELECT populate_work_order_fg_production('PROD-1310-20261214-001');

-- Queue recalculation for backdated transaction
-- SELECT queue_snapshot_recalculation(1310, '2026-12-14', NULL, NULL, 'Backdated incoming goods', 5);

-- Legacy queue worker is disabled and should fail explicitly:
-- SELECT process_recalc_queue(10);

-- =============================================================================
-- PARTITION MAINTENANCE FUNCTIONS (for backdated transactions)
-- =============================================================================
-- These functions ensure partitions exist for backdated transactions
-- Called when a transaction date is before today (from BaseTransactionRepository)

-- Function to ensure incoming_goods partition exists for backdated transaction
CREATE OR REPLACE FUNCTION ensure_incoming_goods_partition(
    p_company_code INTEGER,
    p_transaction_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_quarter_start DATE;
    v_quarter_end DATE;
    v_year INTEGER;
    v_quarter INTEGER;
    v_partition_name TEXT;
    v_company_partition_name TEXT;
BEGIN
    -- Extract year and quarter from transaction date
    v_year := EXTRACT(YEAR FROM p_transaction_date)::INTEGER;
    v_quarter := CEIL(EXTRACT(MONTH FROM p_transaction_date) / 3.0)::INTEGER;
    
    -- Calculate quarter boundaries
    v_quarter_start := DATE_TRUNC('quarter', p_transaction_date)::DATE;
    v_quarter_end := (DATE_TRUNC('quarter', p_transaction_date) + INTERVAL '3 months')::DATE;
    
    -- Generate partition names
    v_company_partition_name := 'incoming_goods_' || p_company_code;
    v_partition_name := v_company_partition_name || '_' || v_year || '_q' || v_quarter;
    
    -- Check if company partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_company_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_company_partition_name || ' PARTITION OF incoming_goods FOR VALUES IN (' || p_company_code || ') PARTITION BY RANGE (incoming_date)';
        -- EXECUTE 'ALTER TABLE ' || v_company_partition_name || ' OWNER TO imapsuser';
    END IF;
    
    -- Check if quarterly partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_partition_name || ' PARTITION OF ' || v_company_partition_name || ' FOR VALUES FROM (''' || v_quarter_start || ''') TO (''' || v_quarter_end || ''')';
        -- EXECUTE 'ALTER TABLE ' || v_partition_name || ' OWNER TO imapsuser';
        RAISE NOTICE 'Created partition: %', v_partition_name;
    END IF;
END;
$$;

-- Function to ensure outgoing_goods partition exists for backdated transaction
CREATE OR REPLACE FUNCTION ensure_outgoing_goods_partition(
    p_company_code INTEGER,
    p_transaction_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_quarter_start DATE;
    v_quarter_end DATE;
    v_year INTEGER;
    v_quarter INTEGER;
    v_partition_name TEXT;
    v_company_partition_name TEXT;
BEGIN
    -- Extract year and quarter from transaction date
    v_year := EXTRACT(YEAR FROM p_transaction_date)::INTEGER;
    v_quarter := CEIL(EXTRACT(MONTH FROM p_transaction_date) / 3.0)::INTEGER;
    
    -- Calculate quarter boundaries
    v_quarter_start := DATE_TRUNC('quarter', p_transaction_date)::DATE;
    v_quarter_end := (DATE_TRUNC('quarter', p_transaction_date) + INTERVAL '3 months')::DATE;
    
    -- Generate partition names
    v_company_partition_name := 'outgoing_goods_' || p_company_code;
    v_partition_name := v_company_partition_name || '_' || v_year || '_q' || v_quarter;
    
    -- Check if company partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_company_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_company_partition_name || ' PARTITION OF outgoing_goods FOR VALUES IN (' || p_company_code || ') PARTITION BY RANGE (outgoing_date)';
        -- EXECUTE 'ALTER TABLE ' || v_company_partition_name || ' OWNER TO imapsuser';
    END IF;
    
    -- Check if quarterly partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_partition_name || ' PARTITION OF ' || v_company_partition_name || ' FOR VALUES FROM (''' || v_quarter_start || ''') TO (''' || v_quarter_end || ''')';
        -- EXECUTE 'ALTER TABLE ' || v_partition_name || ' OWNER TO imapsuser';
        RAISE NOTICE 'Created partition: %', v_partition_name;
    END IF;
END;
$$;

-- Function to ensure material_usages partition exists for backdated transaction
CREATE OR REPLACE FUNCTION ensure_material_usages_partition(
    p_company_code INTEGER,
    p_transaction_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_quarter_start DATE;
    v_quarter_end DATE;
    v_year INTEGER;
    v_quarter INTEGER;
    v_partition_name TEXT;
    v_company_partition_name TEXT;
BEGIN
    -- Extract year and quarter from transaction date
    v_year := EXTRACT(YEAR FROM p_transaction_date)::INTEGER;
    v_quarter := CEIL(EXTRACT(MONTH FROM p_transaction_date) / 3.0)::INTEGER;
    
    -- Calculate quarter boundaries
    v_quarter_start := DATE_TRUNC('quarter', p_transaction_date)::DATE;
    v_quarter_end := (DATE_TRUNC('quarter', p_transaction_date) + INTERVAL '3 months')::DATE;
    
    -- Generate partition names
    v_company_partition_name := 'material_usages_' || p_company_code;
    v_partition_name := v_company_partition_name || '_' || v_year || '_q' || v_quarter;
    
    -- Check if company partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_company_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_company_partition_name || ' PARTITION OF material_usages FOR VALUES IN (' || p_company_code || ') PARTITION BY RANGE (transaction_date)';
        -- EXECUTE 'ALTER TABLE ' || v_company_partition_name || ' OWNER TO imapsuser';
    END IF;
    
    -- Check if quarterly partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_partition_name || ' PARTITION OF ' || v_company_partition_name || ' FOR VALUES FROM (''' || v_quarter_start || ''') TO (''' || v_quarter_end || ''')';
        -- EXECUTE 'ALTER TABLE ' || v_partition_name || ' OWNER TO imapsuser';
        RAISE NOTICE 'Created partition: %', v_partition_name;
    END IF;
END;
$$;

-- Function to ensure production_outputs partition exists for backdated transaction
CREATE OR REPLACE FUNCTION ensure_production_output_partition(
    p_company_code INTEGER,
    p_transaction_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_quarter_start DATE;
    v_quarter_end DATE;
    v_year INTEGER;
    v_quarter INTEGER;
    v_partition_name TEXT;
    v_company_partition_name TEXT;
BEGIN
    -- Extract year and quarter from transaction date
    v_year := EXTRACT(YEAR FROM p_transaction_date)::INTEGER;
    v_quarter := CEIL(EXTRACT(MONTH FROM p_transaction_date) / 3.0)::INTEGER;
    
    -- Calculate quarter boundaries
    v_quarter_start := DATE_TRUNC('quarter', p_transaction_date)::DATE;
    v_quarter_end := (DATE_TRUNC('quarter', p_transaction_date) + INTERVAL '3 months')::DATE;
    
    -- Generate partition names
    v_company_partition_name := 'production_outputs_' || p_company_code;
    v_partition_name := v_company_partition_name || '_' || v_year || '_q' || v_quarter;
    
    -- Check if company partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_company_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_company_partition_name || ' PARTITION OF production_outputs FOR VALUES IN (' || p_company_code || ') PARTITION BY RANGE (transaction_date)';
        -- EXECUTE 'ALTER TABLE ' || v_company_partition_name || ' OWNER TO imapsuser';
    END IF;
    
    -- Check if quarterly partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_partition_name || ' PARTITION OF ' || v_company_partition_name || ' FOR VALUES FROM (''' || v_quarter_start || ''') TO (''' || v_quarter_end || ''')';
        -- EXECUTE 'ALTER TABLE ' || v_partition_name || ' OWNER TO imapsuser';
        RAISE NOTICE 'Created partition: %', v_partition_name;
    END IF;
END;
$$;

-- Function to ensure adjustments partition exists for backdated transaction
CREATE OR REPLACE FUNCTION ensure_adjustments_partition(
    p_company_code INTEGER,
    p_transaction_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    v_quarter_start DATE;
    v_quarter_end DATE;
    v_year INTEGER;
    v_quarter INTEGER;
    v_partition_name TEXT;
    v_company_partition_name TEXT;
BEGIN
    -- Extract year and quarter from transaction date
    v_year := EXTRACT(YEAR FROM p_transaction_date)::INTEGER;
    v_quarter := CEIL(EXTRACT(MONTH FROM p_transaction_date) / 3.0)::INTEGER;
    
    -- Calculate quarter boundaries
    v_quarter_start := DATE_TRUNC('quarter', p_transaction_date)::DATE;
    v_quarter_end := (DATE_TRUNC('quarter', p_transaction_date) + INTERVAL '3 months')::DATE;
    
    -- Generate partition names
    v_company_partition_name := 'adjustments_' || p_company_code;
    v_partition_name := v_company_partition_name || '_' || v_year || '_q' || v_quarter;
    
    -- Check if company partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_company_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_company_partition_name || ' PARTITION OF adjustments FOR VALUES IN (' || p_company_code || ') PARTITION BY RANGE (transaction_date)';
        -- EXECUTE 'ALTER TABLE ' || v_company_partition_name || ' OWNER TO imapsuser';
    END IF;
    
    -- Check if quarterly partition exists, if not create it
    IF NOT EXISTS (
        SELECT 1 FROM pg_tables 
        WHERE tablename = v_partition_name AND schemaname = 'public'
    ) THEN
        EXECUTE 'CREATE TABLE ' || v_partition_name || ' PARTITION OF ' || v_company_partition_name || ' FOR VALUES FROM (''' || v_quarter_start || ''') TO (''' || v_quarter_end || ''')';
        -- EXECUTE 'ALTER TABLE ' || v_partition_name || ' OWNER TO imapsuser';
        RAISE NOTICE 'Created partition: %', v_partition_name;
    END IF;
END;
$$;

-- =============================================================================
-- END OF FILE
-- =============================================================================
