-- =====================================================================
-- Stock Calculation Engine - SQL Functions
-- =====================================================================
-- Purpose: Calculate daily stock snapshots for all item types
-- Author: Stock Calculation Engine
-- Last Updated: 2025-12-02
-- Database Schema Version: 2.0
-- =====================================================================

-- =====================================================================
-- Helper Function: Get Opening Balance
-- =====================================================================
CREATE OR REPLACE FUNCTION get_opening_balance(
    p_company_code VARCHAR(50),
    p_item_code VARCHAR(50),
    p_target_date DATE
) RETURNS NUMERIC(15,2) AS $$
DECLARE
    v_opening_balance NUMERIC(15,2);
    v_prev_date DATE;
BEGIN
    v_prev_date := p_target_date - INTERVAL '1 day';

    -- Try to get previous day's closing balance
    SELECT closing_balance INTO v_opening_balance
    FROM stock_daily_snapshot
    WHERE company_code = p_company_code
      AND item_code = p_item_code
      AND snapshot_date = v_prev_date
    LIMIT 1;

    -- If no previous day, check beginning balance
    IF v_opening_balance IS NULL THEN
        SELECT balance_qty INTO v_opening_balance
        FROM beginning_balances
        WHERE company_code = p_company_code
          AND item_code = p_item_code
          AND effective_date = v_prev_date
        LIMIT 1;
    END IF;

    -- Default to 0 if no balance found
    RETURN COALESCE(v_opening_balance, 0);
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Helper Function: Validate Snapshot Calculation
-- =====================================================================
CREATE OR REPLACE FUNCTION validate_snapshot_calculation(
    p_company_code VARCHAR(50),
    p_target_date DATE
) RETURNS TABLE (
    validation_type VARCHAR(50),
    issue_count INTEGER,
    details JSONB
) AS $$
BEGIN
    -- Check 1: Balance mismatch for transaction-based items
    RETURN QUERY
    SELECT
        'BALANCE_MISMATCH'::VARCHAR(50) AS validation_type,
        COUNT(*)::INTEGER AS issue_count,
        jsonb_agg(jsonb_build_object(
            'item_code', item_code,
            'expected', (opening_balance + COALESCE(incoming_qty, 0) - COALESCE(material_usage_qty, 0)
                        + COALESCE(production_qty, 0) - COALESCE(outgoing_qty, 0) + COALESCE(adjustment_qty, 0)),
            'actual', closing_balance
        )) AS details
    FROM stock_daily_snapshot
    WHERE company_code = p_company_code
      AND snapshot_date = p_target_date
      AND calculation_method = 'TRANSACTION'
      AND ABS(closing_balance - (opening_balance + COALESCE(incoming_qty, 0) - COALESCE(material_usage_qty, 0)
              + COALESCE(production_qty, 0) - COALESCE(outgoing_qty, 0) + COALESCE(adjustment_qty, 0))) > 0.01;

    -- Check 2: Negative stock
    RETURN QUERY
    SELECT
        'NEGATIVE_STOCK'::VARCHAR(50) AS validation_type,
        COUNT(*)::INTEGER AS issue_count,
        jsonb_agg(jsonb_build_object(
            'item_code', item_code,
            'item_name', item_name,
            'closing_balance', closing_balance
        )) AS details
    FROM stock_daily_snapshot
    WHERE company_code = p_company_code
      AND snapshot_date = p_target_date
      AND closing_balance < 0;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Main Function: Calculate Stock Snapshot
-- =====================================================================
CREATE OR REPLACE FUNCTION calculate_stock_snapshot(
    p_company_code VARCHAR(50),
    p_target_date DATE,
    p_item_type_code VARCHAR(10) DEFAULT NULL,
    p_item_code VARCHAR(50) DEFAULT NULL
) RETURNS TABLE (
    items_processed INTEGER,
    calculation_method VARCHAR(20),
    execution_time_ms BIGINT,
    validation_results JSONB
) AS $$
DECLARE
    v_start_time TIMESTAMP;
    v_items_processed INTEGER := 0;
    v_validation_results JSONB := '[]'::jsonb;
BEGIN
    v_start_time := clock_timestamp();

    -- Use Serializable isolation level for race condition prevention
    SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;

    -- Delete existing snapshot for target date (idempotent)
    DELETE FROM stock_daily_snapshot
    WHERE company_code = p_company_code
      AND snapshot_date = p_target_date
      AND (p_item_type_code IS NULL OR item_type_code = p_item_type_code)
      AND (p_item_code IS NULL OR item_code = p_item_code);

    -- ================================================================
    -- ROH Calculation (Raw Materials)
    -- Formula: Opening + Incoming - Material_Usage ± Adjustment
    -- ================================================================
    INSERT INTO stock_daily_snapshot (
        company_code, item_type_code, item_code, item_name, uom,
        opening_balance, incoming_qty, material_usage_qty, adjustment_qty,
        closing_balance, snapshot_date, calculation_method, calculated_at
    )
    WITH roh_transactions AS (
        -- Incoming
        SELECT
            company_code, item_code, item_name, uom,
            SUM(qty) AS incoming_qty,
            0::NUMERIC(15,2) AS material_usage_qty,
            0::NUMERIC(15,2) AS adjustment_qty
        FROM incoming_details
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code = 'ROH'
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom

        UNION ALL

        -- Material Usage
        SELECT
            company_code, item_code, item_name, uom,
            0::NUMERIC(15,2) AS incoming_qty,
            SUM(qty) AS material_usage_qty,
            0::NUMERIC(15,2) AS adjustment_qty
        FROM material_usage_details
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code = 'ROH'
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom

        UNION ALL

        -- Adjustments
        SELECT
            company_code, item_code, item_name, uom,
            0::NUMERIC(15,2) AS incoming_qty,
            0::NUMERIC(15,2) AS material_usage_qty,
            SUM(adjusted_qty) AS adjustment_qty
        FROM adjustments
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code = 'ROH'
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom
    ),
    roh_aggregated AS (
        SELECT
            company_code, item_code, item_name, uom,
            SUM(incoming_qty) AS incoming_qty,
            SUM(material_usage_qty) AS material_usage_qty,
            SUM(adjustment_qty) AS adjustment_qty
        FROM roh_transactions
        GROUP BY company_code, item_code, item_name, uom
    )
    SELECT
        t.company_code,
        'ROH'::VARCHAR(10) AS item_type_code,
        t.item_code,
        t.item_name,
        t.uom,
        get_opening_balance(t.company_code, t.item_code, p_target_date) AS opening_balance,
        COALESCE(t.incoming_qty, 0) AS incoming_qty,
        COALESCE(t.material_usage_qty, 0) AS material_usage_qty,
        COALESCE(t.adjustment_qty, 0) AS adjustment_qty,
        get_opening_balance(t.company_code, t.item_code, p_target_date)
            + COALESCE(t.incoming_qty, 0)
            - COALESCE(t.material_usage_qty, 0)
            + COALESCE(t.adjustment_qty, 0) AS closing_balance,
        p_target_date AS snapshot_date,
        'TRANSACTION'::VARCHAR(20) AS calculation_method,
        CURRENT_TIMESTAMP AS calculated_at
    FROM roh_aggregated t
    WHERE (p_item_type_code IS NULL OR p_item_type_code = 'ROH');

    GET DIAGNOSTICS v_items_processed = ROW_COUNT;

    -- ================================================================
    -- HALB Calculation (Work-in-Progress)
    -- Formula: WIP_Snapshot (direct from wip_balance table)
    -- ================================================================
    INSERT INTO stock_daily_snapshot (
        company_code, item_type_code, item_code, item_name, uom,
        opening_balance, wip_balance_qty, closing_balance,
        snapshot_date, calculation_method, calculated_at
    )
    SELECT
        w.company_code,
        w.item_type_code,
        w.item_code,
        w.item_name,
        w.uom,
        get_opening_balance(w.company_code, w.item_code, p_target_date) AS opening_balance,
        w.qty AS wip_balance_qty,
        w.qty AS closing_balance,
        p_target_date AS snapshot_date,
        'WIP_SNAPSHOT'::VARCHAR(20) AS calculation_method,
        CURRENT_TIMESTAMP AS calculated_at
    FROM wip_balance w
    WHERE w.company_code = p_company_code
      AND w.trx_date = p_target_date
      AND w.item_type_code = 'HALB'
      AND (p_item_type_code IS NULL OR p_item_type_code = 'HALB')
      AND (p_item_code IS NULL OR w.item_code = p_item_code);

    GET DIAGNOSTICS v_items_processed = v_items_processed + ROW_COUNT;

    -- ================================================================
    -- FERT Calculation (Finished Goods)
    -- Formula: Opening + Production - Outgoing ± Adjustment
    -- ================================================================
    INSERT INTO stock_daily_snapshot (
        company_code, item_type_code, item_code, item_name, uom,
        opening_balance, production_qty, outgoing_qty, adjustment_qty,
        closing_balance, snapshot_date, calculation_method, calculated_at
    )
    WITH fert_transactions AS (
        -- Production
        SELECT
            company_code, item_code, item_name, uom,
            SUM(qty) AS production_qty,
            0::NUMERIC(15,2) AS outgoing_qty,
            0::NUMERIC(15,2) AS adjustment_qty
        FROM finished_goods_production_details
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom

        UNION ALL

        -- Outgoing
        SELECT
            company_code, item_code, item_name, uom,
            0::NUMERIC(15,2) AS production_qty,
            SUM(qty) AS outgoing_qty,
            0::NUMERIC(15,2) AS adjustment_qty
        FROM outgoing_details
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code = 'FERT'
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom

        UNION ALL

        -- Adjustments
        SELECT
            company_code, item_code, item_name, uom,
            0::NUMERIC(15,2) AS production_qty,
            0::NUMERIC(15,2) AS outgoing_qty,
            SUM(adjusted_qty) AS adjustment_qty
        FROM adjustments
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code = 'FERT'
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom
    ),
    fert_aggregated AS (
        SELECT
            company_code, item_code, item_name, uom,
            SUM(production_qty) AS production_qty,
            SUM(outgoing_qty) AS outgoing_qty,
            SUM(adjustment_qty) AS adjustment_qty
        FROM fert_transactions
        GROUP BY company_code, item_code, item_name, uom
    )
    SELECT
        t.company_code,
        'FERT'::VARCHAR(10) AS item_type_code,
        t.item_code,
        t.item_name,
        t.uom,
        get_opening_balance(t.company_code, t.item_code, p_target_date) AS opening_balance,
        COALESCE(t.production_qty, 0) AS production_qty,
        COALESCE(t.outgoing_qty, 0) AS outgoing_qty,
        COALESCE(t.adjustment_qty, 0) AS adjustment_qty,
        get_opening_balance(t.company_code, t.item_code, p_target_date)
            + COALESCE(t.production_qty, 0)
            - COALESCE(t.outgoing_qty, 0)
            + COALESCE(t.adjustment_qty, 0) AS closing_balance,
        p_target_date AS snapshot_date,
        'TRANSACTION'::VARCHAR(20) AS calculation_method,
        CURRENT_TIMESTAMP AS calculated_at
    FROM fert_aggregated t
    WHERE (p_item_type_code IS NULL OR p_item_type_code = 'FERT');

    GET DIAGNOSTICS v_items_processed = v_items_processed + ROW_COUNT;

    -- ================================================================
    -- HIBE* Calculation (Capital Goods)
    -- Formula: Opening + Incoming - Outgoing ± Adjustment
    -- ================================================================
    INSERT INTO stock_daily_snapshot (
        company_code, item_type_code, item_code, item_name, uom,
        opening_balance, incoming_qty, outgoing_qty, adjustment_qty,
        closing_balance, snapshot_date, calculation_method, calculated_at
    )
    WITH hibe_transactions AS (
        -- Incoming
        SELECT
            company_code, item_type_code, item_code, item_name, uom,
            SUM(qty) AS incoming_qty,
            0::NUMERIC(15,2) AS outgoing_qty,
            0::NUMERIC(15,2) AS adjustment_qty
        FROM incoming_details
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code IN ('HIBE', 'HIBE-M', 'HIBE-E', 'HIBE-T')
          AND (p_item_type_code IS NULL OR item_type_code = p_item_type_code)
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_type_code, item_code, item_name, uom

        UNION ALL

        -- Outgoing
        SELECT
            company_code, item_type_code, item_code, item_name, uom,
            0::NUMERIC(15,2) AS incoming_qty,
            SUM(qty) AS outgoing_qty,
            0::NUMERIC(15,2) AS adjustment_qty
        FROM outgoing_details
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code IN ('HIBE', 'HIBE-M', 'HIBE-E', 'HIBE-T')
          AND (p_item_type_code IS NULL OR item_type_code = p_item_type_code)
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_type_code, item_code, item_name, uom

        UNION ALL

        -- Adjustments
        SELECT
            company_code, item_type_code, item_code, item_name, uom,
            0::NUMERIC(15,2) AS incoming_qty,
            0::NUMERIC(15,2) AS outgoing_qty,
            SUM(adjusted_qty) AS adjustment_qty
        FROM adjustments
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code IN ('HIBE', 'HIBE-M', 'HIBE-E', 'HIBE-T')
          AND (p_item_type_code IS NULL OR item_type_code = p_item_type_code)
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_type_code, item_code, item_name, uom
    ),
    hibe_aggregated AS (
        SELECT
            company_code, item_type_code, item_code, item_name, uom,
            SUM(incoming_qty) AS incoming_qty,
            SUM(outgoing_qty) AS outgoing_qty,
            SUM(adjustment_qty) AS adjustment_qty
        FROM hibe_transactions
        GROUP BY company_code, item_type_code, item_code, item_name, uom
    )
    SELECT
        t.company_code,
        t.item_type_code,
        t.item_code,
        t.item_name,
        t.uom,
        get_opening_balance(t.company_code, t.item_code, p_target_date) AS opening_balance,
        COALESCE(t.incoming_qty, 0) AS incoming_qty,
        COALESCE(t.outgoing_qty, 0) AS outgoing_qty,
        COALESCE(t.adjustment_qty, 0) AS adjustment_qty,
        get_opening_balance(t.company_code, t.item_code, p_target_date)
            + COALESCE(t.incoming_qty, 0)
            - COALESCE(t.outgoing_qty, 0)
            + COALESCE(t.adjustment_qty, 0) AS closing_balance,
        p_target_date AS snapshot_date,
        'TRANSACTION'::VARCHAR(20) AS calculation_method,
        CURRENT_TIMESTAMP AS calculated_at
    FROM hibe_aggregated t
    WHERE (p_item_type_code IS NULL OR p_item_type_code IN ('HIBE', 'HIBE-M', 'HIBE-E', 'HIBE-T'));

    GET DIAGNOSTICS v_items_processed = v_items_processed + ROW_COUNT;

    -- ================================================================
    -- SCRAP Calculation (Production Waste)
    -- Formula: Opening + Incoming - Outgoing ± Adjustment
    -- Note: SCRAP data is NOT from WMS API, handled internally in iMAPS
    -- ================================================================
    INSERT INTO stock_daily_snapshot (
        company_code, item_type_code, item_code, item_name, uom,
        opening_balance, incoming_qty, outgoing_qty, adjustment_qty,
        closing_balance, snapshot_date, calculation_method, calculated_at
    )
    WITH scrap_transactions AS (
        -- Incoming (manual input in iMAPS)
        SELECT
            company_code, item_code, item_name, uom,
            SUM(qty) AS incoming_qty,
            0::NUMERIC(15,2) AS outgoing_qty,
            0::NUMERIC(15,2) AS adjustment_qty
        FROM incoming_details
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code = 'SCRAP'
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom

        UNION ALL

        -- Outgoing (Excel upload from CEISA/INSW)
        SELECT
            company_code, item_code, item_name, uom,
            0::NUMERIC(15,2) AS incoming_qty,
            SUM(qty) AS outgoing_qty,
            0::NUMERIC(15,2) AS adjustment_qty
        FROM outgoing_details
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code = 'SCRAP'
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom

        UNION ALL

        -- Adjustments
        SELECT
            company_code, item_code, item_name, uom,
            0::NUMERIC(15,2) AS incoming_qty,
            0::NUMERIC(15,2) AS outgoing_qty,
            SUM(adjusted_qty) AS adjustment_qty
        FROM adjustments
        WHERE company_code = p_company_code
          AND trx_date = p_target_date
          AND item_type_code = 'SCRAP'
          AND (p_item_code IS NULL OR item_code = p_item_code)
        GROUP BY company_code, item_code, item_name, uom
    ),
    scrap_aggregated AS (
        SELECT
            company_code, item_code, item_name, uom,
            SUM(incoming_qty) AS incoming_qty,
            SUM(outgoing_qty) AS outgoing_qty,
            SUM(adjustment_qty) AS adjustment_qty
        FROM scrap_transactions
        GROUP BY company_code, item_code, item_name, uom
    )
    SELECT
        t.company_code,
        'SCRAP'::VARCHAR(10) AS item_type_code,
        t.item_code,
        t.item_name,
        t.uom,
        get_opening_balance(t.company_code, t.item_code, p_target_date) AS opening_balance,
        COALESCE(t.incoming_qty, 0) AS incoming_qty,
        COALESCE(t.outgoing_qty, 0) AS outgoing_qty,
        COALESCE(t.adjustment_qty, 0) AS adjustment_qty,
        get_opening_balance(t.company_code, t.item_code, p_target_date)
            + COALESCE(t.incoming_qty, 0)
            - COALESCE(t.outgoing_qty, 0)
            + COALESCE(t.adjustment_qty, 0) AS closing_balance,
        p_target_date AS snapshot_date,
        'TRANSACTION'::VARCHAR(20) AS calculation_method,
        CURRENT_TIMESTAMP AS calculated_at
    FROM scrap_aggregated t
    WHERE (p_item_type_code IS NULL OR p_item_type_code = 'SCRAP');

    GET DIAGNOSTICS v_items_processed = v_items_processed + ROW_COUNT;

    -- Run validation checks
    SELECT jsonb_agg(
        jsonb_build_object(
            'validation_type', v.validation_type,
            'issue_count', v.issue_count,
            'details', v.details
        )
    ) INTO v_validation_results
    FROM validate_snapshot_calculation(p_company_code, p_target_date) v
    WHERE v.issue_count > 0;

    -- Return results
    RETURN QUERY SELECT
        v_items_processed,
        'TRANSACTION'::VARCHAR(20) AS calculation_method,
        EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start_time)::BIGINT AS execution_time_ms,
        COALESCE(v_validation_results, '[]'::jsonb) AS validation_results;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Cascade Recalculation Function
-- =====================================================================
CREATE OR REPLACE FUNCTION recalculate_cascade(
    p_company_code VARCHAR(50),
    p_start_date DATE,
    p_end_date DATE DEFAULT NULL
) RETURNS TABLE (
    recalc_date DATE,
    items_processed INTEGER,
    execution_time_ms BIGINT,
    validation_results JSONB
) AS $$
DECLARE
    v_current_date DATE;
    v_final_date DATE;
    v_result RECORD;
BEGIN
    -- Default end date to current date if not specified
    v_final_date := COALESCE(p_end_date, CURRENT_DATE);
    v_current_date := p_start_date;

    -- Loop through each date and recalculate
    WHILE v_current_date <= v_final_date LOOP
        -- Calculate snapshot for this date
        FOR v_result IN
            SELECT * FROM calculate_stock_snapshot(p_company_code, v_current_date)
        LOOP
            RETURN QUERY SELECT
                v_current_date,
                v_result.items_processed,
                v_result.execution_time_ms,
                v_result.validation_results;
        END LOOP;

        -- Move to next date
        v_current_date := v_current_date + INTERVAL '1 day';
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Get Stock Balance Function
-- =====================================================================
CREATE OR REPLACE FUNCTION get_stock_balance(
    p_company_code VARCHAR(50),
    p_item_code VARCHAR(50),
    p_as_of_date DATE DEFAULT NULL
) RETURNS TABLE (
    company_code VARCHAR(50),
    item_code VARCHAR(50),
    item_name VARCHAR(200),
    item_type_code VARCHAR(10),
    uom VARCHAR(20),
    closing_balance NUMERIC(15,2),
    snapshot_date DATE
) AS $$
DECLARE
    v_target_date DATE;
BEGIN
    v_target_date := COALESCE(p_as_of_date, CURRENT_DATE);

    RETURN QUERY
    SELECT
        s.company_code,
        s.item_code,
        s.item_name,
        s.item_type_code,
        s.uom,
        s.closing_balance,
        s.snapshot_date
    FROM stock_daily_snapshot s
    WHERE s.company_code = p_company_code
      AND s.item_code = p_item_code
      AND s.snapshot_date = (
          SELECT MAX(snapshot_date)
          FROM stock_daily_snapshot
          WHERE company_code = p_company_code
            AND item_code = p_item_code
            AND snapshot_date <= v_target_date
      )
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- Create Indexes for Performance Optimization
-- =====================================================================

-- Covering indexes for stock calculation queries
CREATE INDEX IF NOT EXISTS idx_incoming_details_stock_calc
ON incoming_details (company_code, item_code, item_type_code, trx_date DESC)
INCLUDE (qty, uom, item_name);

CREATE INDEX IF NOT EXISTS idx_outgoing_details_stock_calc
ON outgoing_details (company_code, item_code, item_type_code, trx_date DESC)
INCLUDE (qty, uom, item_name);

CREATE INDEX IF NOT EXISTS idx_material_usage_details_stock_calc
ON material_usage_details (company_code, item_code, item_type_code, trx_date DESC)
INCLUDE (qty, uom, item_name);

CREATE INDEX IF NOT EXISTS idx_finished_goods_production_details_stock_calc
ON finished_goods_production_details (company_code, item_code, trx_date DESC)
INCLUDE (qty, uom, item_name);

CREATE INDEX IF NOT EXISTS idx_adjustments_stock_calc
ON adjustments (company_code, item_code, item_type_code, trx_date DESC)
INCLUDE (adjusted_qty, uom, item_name);

CREATE INDEX IF NOT EXISTS idx_wip_balance_stock_calc
ON wip_balance (company_code, item_code, item_type_code, trx_date DESC)
INCLUDE (qty, uom, item_name);

-- Index for opening balance lookup
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_opening
ON stock_daily_snapshot (company_code, item_code, snapshot_date DESC);

-- Index for stock snapshot queries
CREATE INDEX IF NOT EXISTS idx_stock_snapshot_company_date
ON stock_daily_snapshot (company_code, snapshot_date DESC, item_type_code);

-- Index for beginning balances
CREATE INDEX IF NOT EXISTS idx_beginning_balances_lookup
ON beginning_balances (company_code, item_code, effective_date);

-- =====================================================================
-- Comments for Documentation
-- =====================================================================
COMMENT ON FUNCTION calculate_stock_snapshot IS
'Calculates daily stock snapshot for all item types using transaction-based or snapshot-based methods.
Supports ROH, HALB, FERT, HIBE*, and SCRAP item types. Uses Serializable isolation for race condition prevention.';

COMMENT ON FUNCTION recalculate_cascade IS
'Recalculates stock snapshots for a date range, cascading forward from start_date to end_date.
Used for backdated transactions that affect multiple days.';

COMMENT ON FUNCTION get_opening_balance IS
'Helper function to get opening balance for an item, checking previous day closing balance or beginning_balances table.';

COMMENT ON FUNCTION validate_snapshot_calculation IS
'Validates stock snapshot calculations for balance mismatches and negative stock.';

COMMENT ON FUNCTION get_stock_balance IS
'Retrieves the most recent stock balance for an item as of a specific date.';
