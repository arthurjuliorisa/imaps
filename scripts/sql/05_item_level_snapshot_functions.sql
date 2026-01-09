-- =============================================================================
-- iMAPS Database - Item-Level Stock Snapshot Functions
-- File: 05_item_level_snapshot_functions.sql
-- Purpose: Direct recalculation of item-level snapshots without queue
-- Version: 1.0 (Item-level, incoming_goods focused, extensible for other sources)
-- =============================================================================

-- =============================================================================
-- 1. GET ITEM OPENING BALANCE
-- Purpose: Find opening balance for a single item at a given date
-- Logic:
--   1. Check beginning_balances for exact date
--   2. If not found, get closing_balance from MAX(snapshot_date) < target_date
--   3. If not found, return 0
-- =============================================================================

CREATE OR REPLACE FUNCTION get_item_opening_balance(
    p_company_code INTEGER,
    p_item_type VARCHAR(10),
    p_item_code VARCHAR(50),
    p_snapshot_date DATE
)
RETURNS NUMERIC(15,3)
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
    v_opening_balance NUMERIC(15,3);
BEGIN
    -- Try 1: Get from beginning_balances (exact date)
    SELECT qty INTO v_opening_balance
    FROM beginning_balances
    WHERE company_code = p_company_code
      AND item_type = p_item_type
      AND item_code = p_item_code
      AND balance_date = p_snapshot_date
      AND deleted_at IS NULL
    LIMIT 1;

    IF v_opening_balance IS NOT NULL THEN
        RETURN v_opening_balance;
    END IF;

    -- Try 2: Get closing_balance from previous snapshot (latest before target_date)
    SELECT closing_balance INTO v_opening_balance
    FROM stock_daily_snapshot
    WHERE company_code = p_company_code
      AND item_type = p_item_type
      AND item_code = p_item_code
      AND snapshot_date < p_snapshot_date
    ORDER BY snapshot_date DESC
    LIMIT 1;

    IF v_opening_balance IS NOT NULL THEN
        RETURN v_opening_balance;
    END IF;

    -- Default: 0
    RETURN NUMERIC '0.000';
END;
$$;

-- =============================================================================
-- 2. UPSERT ITEM STOCK SNAPSHOT (SINGLE ITEM)
-- Purpose: Calculate and upsert snapshot for ONE item on ONE date
-- Returns: Detail of opening, closing, and quantities
-- Logic:
--   1. Get opening balance via get_item_opening_balance()
--   2. Query SUM quantities dari transaksi pada tanggal tersebut:
--      - incoming_good_items (untuk incoming_goods)
--      - (Nanti: outgoing, adjustments, production, material_usage, scrap)
--   3. Calculate closing = opening + incoming - outgoing - usage + production ± adjustment
--   4. UPSERT ke stock_daily_snapshot ON CONFLICT DO UPDATE
-- =============================================================================

CREATE OR REPLACE FUNCTION upsert_item_stock_snapshot(
    p_company_code INTEGER,
    p_item_type VARCHAR(10),
    p_item_code VARCHAR(50),
    p_item_name VARCHAR(200),
    p_uom VARCHAR(20),
    p_snapshot_date DATE
)
RETURNS TABLE(
    opening_balance NUMERIC(15,3),
    closing_balance NUMERIC(15,3),
    incoming_qty NUMERIC(15,3),
    outgoing_qty NUMERIC(15,3),
    material_usage_qty NUMERIC(15,3),
    production_qty NUMERIC(15,3),
    adjustment_qty NUMERIC(15,3),
    operation VARCHAR(20) -- 'INSERT' or 'UPDATE'
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_opening_balance NUMERIC(15,3);
    v_incoming_qty NUMERIC(15,3) := NUMERIC '0.000';
    v_outgoing_qty NUMERIC(15,3) := NUMERIC '0.000';
    v_material_usage_qty NUMERIC(15,3) := NUMERIC '0.000';
    v_production_qty NUMERIC(15,3) := NUMERIC '0.000';
    v_adjustment_qty NUMERIC(15,3) := NUMERIC '0.000';
    v_closing_balance NUMERIC(15,3);
    v_operation VARCHAR(20);
    v_exists BOOLEAN;
BEGIN
    -- Get opening balance
    v_opening_balance := get_item_opening_balance(
        p_company_code, p_item_type, p_item_code, p_snapshot_date
    );

    -- Query incoming quantities
    SELECT COALESCE(SUM(qty), NUMERIC '0.000')
    INTO v_incoming_qty
    FROM incoming_good_items
    WHERE incoming_good_company = p_company_code
      AND item_type = p_item_type
      AND item_code = p_item_code
      AND incoming_good_date = p_snapshot_date
      AND deleted_at IS NULL;

    -- Query outgoing quantities
    SELECT COALESCE(SUM(qty), NUMERIC '0.000')
    INTO v_outgoing_qty
    FROM outgoing_good_items
    WHERE outgoing_good_company = p_company_code
      AND item_type = p_item_type
      AND item_code = p_item_code
      AND outgoing_good_date = p_snapshot_date
      AND deleted_at IS NULL;

    -- Query material usage quantities
    SELECT COALESCE(SUM(
        CASE 
            WHEN mu.reversal = 'Y' THEN -mui.qty  -- Return increases stock
            ELSE mui.qty 
        END
    ), NUMERIC '0.000')
    INTO v_material_usage_qty
    FROM material_usage_items mui
    JOIN material_usages mu ON mui.material_usage_id = mu.id
    WHERE mu.company_code = p_company_code
      AND mui.item_type = p_item_type
      AND mui.item_code = p_item_code
      AND mu.transaction_date = p_snapshot_date
      AND mu.deleted_at IS NULL
      AND mui.deleted_at IS NULL;

    -- Query production quantities
    SELECT COALESCE(SUM(
        CASE 
            WHEN po.reversal = 'Y' THEN -poi.qty  -- Reversal decreases stock
            ELSE poi.qty 
        END
    ), NUMERIC '0.000')
    INTO v_production_qty
    FROM production_output_items poi
    JOIN production_outputs po ON poi.production_output_id = po.id
    WHERE po.company_code = p_company_code
      AND poi.item_type = p_item_type
      AND poi.item_code = p_item_code
      AND po.transaction_date = p_snapshot_date
      AND po.deleted_at IS NULL
      AND poi.deleted_at IS NULL;

    -- Query adjustment quantities (using File 03 pattern for consistency)
    SELECT COALESCE(SUM(
        CASE 
            WHEN ai.adjustment_type = 'GAIN' THEN ai.qty
            ELSE -ai.qty  -- LOSS
        END
    ), NUMERIC '0.000')
    INTO v_adjustment_qty
    FROM adjustment_items ai
    WHERE ai.adjustment_company = p_company_code
      AND ai.item_type = p_item_type
      AND ai.item_code = p_item_code
      AND ai.adjustment_date = p_snapshot_date
      AND ai.deleted_at IS NULL;

    -- Calculate closing balance
    -- Formula: Closing = Opening + In - Out - Usage + Production ± Adjustment
    v_closing_balance := v_opening_balance 
                       + v_incoming_qty 
                       - v_outgoing_qty 
                       - v_material_usage_qty 
                       + v_production_qty 
                       + v_adjustment_qty;

    -- Check if exists
    SELECT EXISTS (
        SELECT 1 FROM stock_daily_snapshot
        WHERE company_code = p_company_code
          AND item_type = p_item_type
          AND item_code = p_item_code
          AND snapshot_date = p_snapshot_date
    ) INTO v_exists;

    -- UPSERT
    INSERT INTO stock_daily_snapshot (
        company_code,
        item_type,
        item_code,
        item_name,
        uom,
        opening_balance,
        closing_balance,
        incoming_qty,
        outgoing_qty,
        material_usage_qty,
        production_qty,
        adjustment_qty,
        snapshot_date,
        calculated_at,
        calculation_method,
        created_at,
        updated_at
    ) VALUES (
        p_company_code,
        p_item_type,
        p_item_code,
        p_item_name,
        p_uom,
        v_opening_balance,
        v_closing_balance,
        v_incoming_qty,
        v_outgoing_qty,
        v_material_usage_qty,
        v_production_qty,
        v_adjustment_qty,
        p_snapshot_date,
        NOW(),
        'TRANSACTION'::calculation_method,
        NOW(),
        NOW()
    )
    ON CONFLICT (company_code, item_type, item_code, snapshot_date) DO UPDATE
    SET
        item_name = CASE WHEN EXCLUDED.item_name != '' THEN EXCLUDED.item_name ELSE stock_daily_snapshot.item_name END,
        uom = CASE WHEN EXCLUDED.uom != '' THEN EXCLUDED.uom ELSE stock_daily_snapshot.uom END,
        opening_balance = EXCLUDED.opening_balance,
        closing_balance = EXCLUDED.closing_balance,
        incoming_qty = EXCLUDED.incoming_qty,
        outgoing_qty = EXCLUDED.outgoing_qty,
        material_usage_qty = EXCLUDED.material_usage_qty,
        production_qty = EXCLUDED.production_qty,
        adjustment_qty = EXCLUDED.adjustment_qty,
        calculated_at = EXCLUDED.calculated_at,
        updated_at = NOW();

    -- Determine operation type
    v_operation := CASE WHEN v_exists THEN 'UPDATE' ELSE 'INSERT' END;

    -- Return result
    RETURN QUERY SELECT
        v_opening_balance AS opening_balance,
        v_closing_balance AS closing_balance,
        v_incoming_qty AS incoming_qty,
        v_outgoing_qty AS outgoing_qty,
        v_material_usage_qty AS material_usage_qty,
        v_production_qty AS production_qty,
        v_adjustment_qty AS adjustment_qty,
        v_operation::VARCHAR(20) AS operation;
END;
$$;

-- =============================================================================
-- 3. BATCH UPSERT ITEMS STOCK SNAPSHOT
-- Purpose: Process multiple items (dari satu transaksi) sekaligus
-- Input: JSONB array [{"item_type":"ROH","item_code":"MAT-001","item_name":"Material A","uom":"PCS"}, ...]
-- Returns: Status each item (item_code, opening, closing, status, message)
-- =============================================================================

CREATE OR REPLACE FUNCTION upsert_items_stock_snapshot(
    p_company_code INTEGER,
    p_items JSONB,
    p_snapshot_date DATE
)
RETURNS TABLE(
    item_code VARCHAR(50),
    opening_balance NUMERIC(15,3),
    closing_balance NUMERIC(15,3),
    status VARCHAR(20),
    message TEXT
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_item JSONB;
    v_item_type VARCHAR(10);
    v_item_code VARCHAR(50);
    v_item_name VARCHAR(200);
    v_uom VARCHAR(20);
    v_result RECORD;
BEGIN
    -- Loop through each item in the JSONB array
    FOR v_item IN SELECT jsonb_array_elements(p_items)
    LOOP
        v_item_type := v_item->>'item_type';
        v_item_code := v_item->>'item_code';
        v_item_name := v_item->>'item_name';
        v_uom := v_item->>'uom';

        BEGIN
            -- Call upsert_item_stock_snapshot untuk setiap item
            SELECT * INTO v_result
            FROM upsert_item_stock_snapshot(
                p_company_code,
                v_item_type,
                v_item_code,
                v_item_name,
                v_uom,
                p_snapshot_date
            );

            RETURN QUERY SELECT
                v_item_code,
                (v_result)."opening_balance",
                (v_result)."closing_balance",
                'SUCCESS'::VARCHAR(20),
                format('Item %s snapshot calculated', v_item_code)::TEXT;

        EXCEPTION WHEN OTHERS THEN
            RETURN QUERY SELECT
                v_item_code,
                NULL::NUMERIC(15,3),
                NULL::NUMERIC(15,3),
                'ERROR'::VARCHAR(20),
                format('Failed to upsert snapshot: %s', SQLERRM)::TEXT;
        END;
    END LOOP;
END;
$$;

-- =============================================================================
-- 4. RECALCULATE ITEM SNAPSHOTS FROM DATE
-- Purpose: Cascade recalculate snapshots dari tanggal tertentu ke snapshot-snapshot setelahnya
-- Logic:
--   1. Find semua DISTINCT snapshot_date >= p_from_date untuk item tersebut
--   2. Loop dari tanggal terkecil ke terbesar
--   3. Untuk setiap tanggal, panggil upsert_item_stock_snapshot()
-- Returns: INTEGER (jumlah tanggal yang di-recalculate)
-- =============================================================================

CREATE OR REPLACE FUNCTION recalculate_item_snapshots_from_date(
    p_company_code INTEGER,
    p_item_type VARCHAR(10),
    p_item_code VARCHAR(50),
    p_from_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_snapshot_date DATE;
    v_item_name VARCHAR(200);
    v_uom VARCHAR(20);
    v_count INTEGER := 0;
    v_dates_cursor CURSOR FOR
        SELECT DISTINCT snapshot_date
        FROM stock_daily_snapshot
        WHERE company_code = p_company_code
          AND item_type = p_item_type
          AND item_code = p_item_code
          AND snapshot_date >= p_from_date
        ORDER BY snapshot_date ASC;
BEGIN
    -- Try to find item_name/uom from MOST RECENT transaction (incoming or outgoing)
    -- Look in both tables to support all transaction types
    SELECT item_name, uom INTO v_item_name, v_uom
    FROM incoming_good_items
    WHERE item_type = p_item_type
      AND item_code = p_item_code
      AND incoming_good_company = p_company_code
      AND incoming_good_date >= p_from_date
    ORDER BY incoming_good_date DESC
    LIMIT 1;

    -- If not found in incoming, try outgoing
    IF v_item_name IS NULL THEN
        SELECT item_name, uom INTO v_item_name, v_uom
        FROM outgoing_good_items
        WHERE item_type = p_item_type
          AND item_code = p_item_code
          AND outgoing_good_company = p_company_code
          AND outgoing_good_date >= p_from_date
        ORDER BY outgoing_good_date DESC
        LIMIT 1;
    END IF;

    -- If still no item_name, use empty string (should not happen in normal flow)
    IF v_item_name IS NULL THEN
        v_item_name := '';
        v_uom := '';
    END IF;

    -- Open cursor and loop through dates
    OPEN v_dates_cursor;
    LOOP
        FETCH v_dates_cursor INTO v_snapshot_date;
        EXIT WHEN v_snapshot_date IS NULL;

        -- Recalculate snapshot for this date
        PERFORM upsert_item_stock_snapshot(
            p_company_code,
            p_item_type,
            p_item_code,
            v_item_name,
            v_uom,
            v_snapshot_date
        );

        v_count := v_count + 1;
    END LOOP;
    CLOSE v_dates_cursor;

    RETURN v_count;
END;
$$;

-- =============================================================================
-- 5. GRANT PERMISSIONS
-- =============================================================================

-- Grant execute permission to app user (adjust appuser to your actual user)
GRANT EXECUTE ON FUNCTION get_item_opening_balance(INTEGER, VARCHAR, VARCHAR, DATE) TO appuser;
GRANT EXECUTE ON FUNCTION upsert_item_stock_snapshot(INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, DATE) TO appuser;
GRANT EXECUTE ON FUNCTION upsert_items_stock_snapshot(INTEGER, JSONB, DATE) TO appuser;
GRANT EXECUTE ON FUNCTION recalculate_item_snapshots_from_date(INTEGER, VARCHAR, VARCHAR, DATE) TO appuser;
