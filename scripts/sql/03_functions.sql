-- =============================================================================
-- iMAPS Database Schema - Core Functions (Simplified)
-- File: 08_functions.sql
-- Purpose: Stock calculation and traceability population functions
-- Compatible with: schema.prisma v2.4 + setup_partitions.sql + 05_traceability_tables.sql
-- Version: Simplified - Core functions only
-- =============================================================================

-- =============================================================================
-- 1. CALCULATE STOCK SNAPSHOT (Main Function)
-- =============================================================================
-- Calculates daily stock balance for a company on a specific date
-- Handles all item types: ROH, HALB, FERT, HIBE*, SCRAP

CREATE OR REPLACE FUNCTION calculate_stock_snapshot(
    p_company_code INTEGER,
    p_snapshot_date DATE
)
RETURNS void AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_rows_inserted INTEGER := 0;
BEGIN
    v_start_time := clock_timestamp();
    
    RAISE NOTICE 'Starting stock snapshot calculation for company % on %', p_company_code, p_snapshot_date;
    
    -- Delete existing snapshot for this company and date
    DELETE FROM stock_daily_snapshot 
    WHERE company_code = p_company_code 
      AND snapshot_date = p_snapshot_date;
    
    -- Calculate and insert new snapshot
    INSERT INTO stock_daily_snapshot (
        company_code,
        item_type,
        item_code,
        item_name,
        opening_balance,
        closing_balance,
        incoming_qty,
        outgoing_qty,
        production_qty,
        material_usage_qty,
        adjustment_qty,
        wip_balance_qty,
        snapshot_date,
        calculated_at,
        calculation_method
    )
    -- Get all items that had any transaction on this date or have opening balance
    WITH all_items AS (
        SELECT DISTINCT 
            p_company_code AS company_code,
            item_type,
            item_code,
            item_name
        FROM (
            -- Items from incoming
            SELECT item_type, item_code, item_name 
            FROM incoming_good_items igi
            JOIN incoming_goods ig ON igi.incoming_good_id = ig.id
            WHERE ig.company_code = p_company_code 
              AND ig.incoming_date = p_snapshot_date
            
            UNION
            
            -- Items from outgoing
            SELECT item_type, item_code, item_name 
            FROM outgoing_good_items ogi
            JOIN outgoing_goods og ON ogi.outgoing_good_id = og.id
            WHERE og.company_code = p_company_code 
              AND og.outgoing_date = p_snapshot_date
            
            UNION
            
            -- Items from material usage
            SELECT item_type, item_code, item_name 
            FROM material_usage_items mui
            JOIN material_usages mu ON mui.material_usage_id = mu.id
            WHERE mu.company_code = p_company_code 
              AND mu.transaction_date = p_snapshot_date
            
            UNION
            
            -- Items from production
            SELECT item_type, item_code, item_name 
            FROM production_output_items poi
            JOIN production_outputs po ON poi.production_output_id = po.id
            WHERE po.company_code = p_company_code 
              AND po.transaction_date = p_snapshot_date
            
            UNION
            
            -- Items from adjustments
            SELECT item_type, item_code, item_name 
            FROM adjustment_items ai
            JOIN adjustments a ON ai.adjustment_id = a.id
            WHERE a.company_code = p_company_code 
              AND a.transaction_date = p_snapshot_date
            
            UNION
            
            -- Items from WIP balance
            SELECT item_type, item_code, item_name 
            FROM wip_balances 
            WHERE company_code = p_company_code 
              AND stock_date = p_snapshot_date
            
            UNION
            
            -- Items with opening balance (from previous day)
            SELECT item_type, item_code, item_name 
            FROM stock_daily_snapshot 
            WHERE company_code = p_company_code 
              AND snapshot_date = p_snapshot_date - INTERVAL '1 day'
        ) items
    ),
    -- Calculate opening balance (closing from previous day)
    opening_balances AS (
        SELECT 
            company_code,
            item_type,
            item_code,
            closing_balance AS opening_balance
        FROM stock_daily_snapshot
        WHERE company_code = p_company_code
          AND snapshot_date = p_snapshot_date - INTERVAL '1 day'
    ),
    -- Incoming quantities (from incoming_goods)
    incoming_quantities AS (
        SELECT 
            ig.company_code,
            igi.item_type,
            igi.item_code,
            SUM(igi.qty) AS incoming_qty
        FROM incoming_goods ig
        JOIN incoming_good_items igi ON ig.id = igi.incoming_good_id
        WHERE ig.company_code = p_company_code
          AND ig.incoming_date = p_snapshot_date
          AND ig.deleted_at IS NULL
          AND igi.deleted_at IS NULL
        GROUP BY ig.company_code, igi.item_type, igi.item_code
    ),
    -- Outgoing quantities (from outgoing_goods)
    outgoing_quantities AS (
        SELECT 
            og.company_code,
            ogi.item_type,
            ogi.item_code,
            SUM(ogi.qty) AS outgoing_qty
        FROM outgoing_goods og
        JOIN outgoing_good_items ogi ON og.id = ogi.outgoing_good_id
        WHERE og.company_code = p_company_code
          AND og.outgoing_date = p_snapshot_date
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL
        GROUP BY og.company_code, ogi.item_type, ogi.item_code
    ),
    -- Material usage quantities (from material_usages)
    material_usage_quantities AS (
        SELECT 
            mu.company_code,
            mui.item_type,
            mui.item_code,
            SUM(CASE 
                WHEN mu.reversal = 'Y' THEN -mui.qty  -- Return increases stock
                ELSE mui.qty 
            END) AS material_usage_qty
        FROM material_usages mu
        JOIN material_usage_items mui ON mu.id = mui.material_usage_id
        WHERE mu.company_code = p_company_code
          AND mu.transaction_date = p_snapshot_date
          AND mu.deleted_at IS NULL
          AND mui.deleted_at IS NULL
        GROUP BY mu.company_code, mui.item_type, mui.item_code
    ),
    -- Production quantities (from production_outputs)
    production_quantities AS (
        SELECT 
            po.company_code,
            poi.item_type,
            poi.item_code,
            SUM(CASE 
                WHEN po.reversal = 'Y' THEN -poi.qty  -- Reversal decreases stock
                ELSE poi.qty 
            END) AS production_qty
        FROM production_outputs po
        JOIN production_output_items poi ON po.id = poi.production_output_id
        WHERE po.company_code = p_company_code
          AND po.transaction_date = p_snapshot_date
          AND po.deleted_at IS NULL
          AND poi.deleted_at IS NULL
        GROUP BY po.company_code, poi.item_type, poi.item_code
    ),
    -- Adjustment quantities (from adjustments)
    adjustment_quantities AS (
        SELECT 
            a.company_code,
            ai.item_type,
            ai.item_code,
            SUM(CASE 
                WHEN ai.adjustment_type = 'GAIN' THEN ai.qty
                ELSE -ai.qty  -- LOSS
            END) AS adjustment_qty
        FROM adjustments a
        JOIN adjustment_items ai ON a.id = ai.adjustment_id
        WHERE a.company_code = p_company_code
          AND a.transaction_date = p_snapshot_date
          AND a.deleted_at IS NULL
          AND ai.deleted_at IS NULL
        GROUP BY a.company_code, ai.item_type, ai.item_code
    ),
    -- WIP balance quantities (snapshot-based for HALB)
    wip_quantities AS (
        SELECT 
            company_code,
            item_type,
            item_code,
            qty AS wip_balance_qty
        FROM wip_balances
        WHERE company_code = p_company_code
          AND stock_date = p_snapshot_date
          AND deleted_at IS NULL
    )
    -- Final calculation
    SELECT 
        ai.company_code,
        ai.item_type,
        ai.item_code,
        ai.item_name,
        -- Opening balance
        COALESCE(ob.opening_balance, 0) AS opening_balance,
        -- Closing balance calculation by item type
        CASE 
            -- ROH: opening + incoming - material_usage +/- adjustment
            WHEN ai.item_type = 'ROH' THEN
                COALESCE(ob.opening_balance, 0) +
                COALESCE(inc.incoming_qty, 0) -
                COALESCE(mat.material_usage_qty, 0) +
                COALESCE(adj.adjustment_qty, 0)
            
            -- HALB: Use WIP snapshot (overrides calculation)
            WHEN ai.item_type = 'HALB' THEN
                COALESCE(wip.wip_balance_qty, 0)
            
            -- FERT: opening + production - outgoing +/- adjustment
            WHEN ai.item_type = 'FERT' THEN
                COALESCE(ob.opening_balance, 0) +
                COALESCE(prod.production_qty, 0) -
                COALESCE(out.outgoing_qty, 0) +
                COALESCE(adj.adjustment_qty, 0)
            
            -- HIBE/HIBE_M/HIBE_E/HIBE_T: opening + incoming - material_usage - outgoing +/- adjustment
            WHEN ai.item_type IN ('HIBE', 'HIBE_M', 'HIBE_E', 'HIBE_T') THEN
                COALESCE(ob.opening_balance, 0) +
                COALESCE(inc.incoming_qty, 0) -
                COALESCE(mat.material_usage_qty, 0) -
                COALESCE(out.outgoing_qty, 0) +
                COALESCE(adj.adjustment_qty, 0)
            
            -- SCRAP: opening + incoming - outgoing +/- adjustment
            WHEN ai.item_type = 'SCRAP' THEN
                COALESCE(ob.opening_balance, 0) +
                COALESCE(inc.incoming_qty, 0) -
                COALESCE(out.outgoing_qty, 0) +
                COALESCE(adj.adjustment_qty, 0)
            
            ELSE 0
        END AS closing_balance,
        -- Transaction quantities
        COALESCE(inc.incoming_qty, 0) AS incoming_qty,
        COALESCE(out.outgoing_qty, 0) AS outgoing_qty,
        COALESCE(prod.production_qty, 0) AS production_qty,
        COALESCE(mat.material_usage_qty, 0) AS material_usage_qty,
        COALESCE(adj.adjustment_qty, 0) AS adjustment_qty,
        wip.wip_balance_qty,
        p_snapshot_date AS snapshot_date,
        CURRENT_TIMESTAMP AS calculated_at,
        CASE 
            WHEN ai.item_type = 'HALB' THEN 'WIP_SNAPSHOT'::calculation_method
            ELSE 'TRANSACTION'::calculation_method
        END AS calculation_method
    FROM all_items ai
    LEFT JOIN opening_balances ob ON ai.company_code = ob.company_code 
        AND ai.item_type = ob.item_type 
        AND ai.item_code = ob.item_code
    LEFT JOIN incoming_quantities inc ON ai.company_code = inc.company_code 
        AND ai.item_type = inc.item_type 
        AND ai.item_code = inc.item_code
    LEFT JOIN outgoing_quantities out ON ai.company_code = out.company_code 
        AND ai.item_type = out.item_type 
        AND ai.item_code = out.item_code
    LEFT JOIN material_usage_quantities mat ON ai.company_code = mat.company_code 
        AND ai.item_type = mat.item_type 
        AND ai.item_code = mat.item_code
    LEFT JOIN production_quantities prod ON ai.company_code = prod.company_code 
        AND ai.item_type = prod.item_type 
        AND ai.item_code = prod.item_code
    LEFT JOIN adjustment_quantities adj ON ai.company_code = adj.company_code 
        AND ai.item_type = adj.item_type 
        AND ai.item_code = adj.item_code
    LEFT JOIN wip_quantities wip ON ai.company_code = wip.company_code 
        AND ai.item_type = wip.item_type 
        AND ai.item_code = wip.item_code;
    
    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;
    
    RAISE NOTICE 'Stock snapshot calculation completed in % seconds. Rows inserted: %', 
        EXTRACT(EPOCH FROM (clock_timestamp() - v_start_time)), v_rows_inserted;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_stock_snapshot IS 'Calculate daily stock snapshot for a company on a specific date';

-- =============================================================================
-- 2. CALCULATE STOCK SNAPSHOT RANGE
-- =============================================================================
-- Calculates stock snapshots for a date range

CREATE OR REPLACE FUNCTION calculate_stock_snapshot_range(
    p_company_code INTEGER,
    p_start_date DATE,
    p_end_date DATE
)
RETURNS void AS $$
DECLARE
    v_current_date DATE;
    v_total_days INTEGER;
    v_days_processed INTEGER := 0;
BEGIN
    v_current_date := p_start_date;
    v_total_days := p_end_date - p_start_date + 1;
    
    RAISE NOTICE 'Starting stock snapshot calculation for company % from % to % (% days)', 
        p_company_code, p_start_date, p_end_date, v_total_days;
    
    WHILE v_current_date <= p_end_date LOOP
        PERFORM calculate_stock_snapshot(p_company_code, v_current_date);
        v_days_processed := v_days_processed + 1;
        v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
    
    RAISE NOTICE 'Stock snapshot range calculation completed. Days processed: %', v_days_processed;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION calculate_stock_snapshot_range IS 'Calculate stock snapshots for a date range';

-- =============================================================================
-- 3. POPULATE WORK ORDER MATERIAL CONSUMPTION
-- =============================================================================
-- Populates traceability table linking materials to work orders

CREATE OR REPLACE FUNCTION populate_work_order_material_consumption(
    p_material_usage_wms_id VARCHAR(100)
)
RETURNS void AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION populate_work_order_material_consumption IS 'Populate traceability linking materials to work orders';

-- =============================================================================
-- 4. POPULATE WORK ORDER FG PRODUCTION
-- =============================================================================
-- Populates traceability table linking work orders to finished/semifinished goods

CREATE OR REPLACE FUNCTION populate_work_order_fg_production(
    p_production_wms_id VARCHAR(100)
)
RETURNS void AS $$
DECLARE
    v_rows_inserted INTEGER := 0;
    v_work_order VARCHAR(50);
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION populate_work_order_fg_production IS 'Populate traceability linking work orders to finished/semifinished goods';

-- =============================================================================
-- 5. QUEUE SNAPSHOT RECALCULATION
-- =============================================================================
-- Queues snapshot recalculation (for backdated transactions)

CREATE OR REPLACE FUNCTION queue_snapshot_recalculation(
    p_company_code INTEGER,
    p_recalc_date DATE,
    p_item_type VARCHAR(10) DEFAULT NULL,
    p_item_code VARCHAR(50) DEFAULT NULL,
    p_reason VARCHAR(500) DEFAULT NULL,
    p_priority INTEGER DEFAULT 0
)
RETURNS BIGINT AS $$
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
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION queue_snapshot_recalculation IS 'Queue snapshot recalculation for backdated transactions';

-- =============================================================================
-- 6. PROCESS RECALC QUEUE (Worker Function)
-- =============================================================================
-- Processes pending recalculation queue items

CREATE OR REPLACE FUNCTION process_recalc_queue(
    p_batch_size INTEGER DEFAULT 10
)
RETURNS INTEGER AS $$
DECLARE
    v_queue_record RECORD;
    v_processed_count INTEGER := 0;
BEGIN
    FOR v_queue_record IN 
        SELECT id, company_code, recalc_date, item_type, item_code
        FROM snapshot_recalc_queue
        WHERE status = 'PENDING'::recalc_status
        ORDER BY priority DESC, queued_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    LOOP
        BEGIN
            -- Update status to IN_PROGRESS
            UPDATE snapshot_recalc_queue 
            SET status = 'IN_PROGRESS'::recalc_status, 
                started_at = CURRENT_TIMESTAMP
            WHERE id = v_queue_record.id;
            
            -- Recalculate snapshot
            PERFORM calculate_stock_snapshot(
                v_queue_record.company_code,
                v_queue_record.recalc_date
            );
            
            -- Mark as completed
            UPDATE snapshot_recalc_queue 
            SET status = 'COMPLETED'::recalc_status,
                completed_at = CURRENT_TIMESTAMP,
                error_message = NULL
            WHERE id = v_queue_record.id;
            
            v_processed_count := v_processed_count + 1;
            
        EXCEPTION WHEN OTHERS THEN
            -- Mark as failed
            UPDATE snapshot_recalc_queue 
            SET status = 'FAILED'::recalc_status,
                completed_at = CURRENT_TIMESTAMP,
                error_message = SQLERRM
            WHERE id = v_queue_record.id;
            
            RAISE WARNING 'Failed to process recalc queue ID=%: %', v_queue_record.id, SQLERRM;
        END;
    END LOOP;
    
    RAISE NOTICE 'Processed % recalc queue items', v_processed_count;
    RETURN v_processed_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION process_recalc_queue IS 'Process pending snapshot recalculation queue (worker function)';

-- =============================================================================
-- USAGE EXAMPLES
-- =============================================================================

-- Calculate snapshot for a specific date
-- SELECT calculate_stock_snapshot(1310, '2026-12-14');

-- Calculate snapshot for a date range
-- SELECT calculate_stock_snapshot_range(1310, '2026-12-01', '2026-12-31');

-- Populate traceability after material usage insert
-- SELECT populate_work_order_material_consumption('MAT-1310-20261214-001');

-- Populate traceability after production output insert
-- SELECT populate_work_order_fg_production('PROD-1310-20261214-001');

-- Queue recalculation for backdated transaction
-- SELECT queue_snapshot_recalculation(1310, '2026-12-14', NULL, NULL, 'Backdated incoming goods', 5);

-- Process recalc queue (run by worker/cron)
-- SELECT process_recalc_queue(10);

-- =============================================================================
-- END OF FILE
-- =============================================================================
