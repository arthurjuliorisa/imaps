-- =============================================================================
-- iMAPS Production Hotfix
-- Stock daily snapshot item_name consolidation, legacy snapshot guard,
-- and cascade recalculation advisory lock for race-condition prevention
--
-- Correct production order:
--   1. Backup database:
--      pg_dump "$DATABASE_URL" -Fc -f "/tmp/imaps_before_stock_snapshot_hotfix_$(date +%Y%m%d_%H%M%S).dump"
--   2. Apply this function-only hotfix.
--   3. Run scripts/sql/07_stock_snapshot_description_audit.sql.
--
-- Safe production hotfix command:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/sql/production/20260525_stock_snapshot_description_hotfix.sql
--
-- This patch only creates/replaces functions and grants execute permission.
-- It does not create/drop/truncate tables, rebuild indexes, recreate views,
-- or update stock_daily_snapshot rows during patch application.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_latest_stock_item_name(
    p_company_code INTEGER,
    p_item_type VARCHAR(10),
    p_item_code VARCHAR(50),
    p_uom VARCHAR(20)
)
RETURNS VARCHAR(200)
LANGUAGE sql
STABLE
AS $$
    WITH candidates AS (
        SELECT
            igi.item_name,
            ig.incoming_date AS effective_date,
            igi.updated_at,
            igi.created_at,
            igi.id::BIGINT AS source_id,
            10 AS source_priority,
            'incoming_good_items' AS source_name
        FROM incoming_good_items igi
        JOIN incoming_goods ig
          ON ig.company_code = igi.incoming_good_company
         AND ig.id = igi.incoming_good_id
         AND ig.incoming_date = igi.incoming_good_date
        WHERE ig.company_code = p_company_code
          AND igi.item_type = p_item_type
          AND igi.item_code = p_item_code
          AND igi.uom = p_uom
          AND ig.deleted_at IS NULL
          AND igi.deleted_at IS NULL

        UNION ALL

        SELECT
            ogi.item_name,
            og.outgoing_date AS effective_date,
            ogi.updated_at,
            ogi.created_at,
            ogi.id::BIGINT AS source_id,
            20 AS source_priority,
            'outgoing_good_items' AS source_name
        FROM outgoing_good_items ogi
        JOIN outgoing_goods og
          ON og.company_code = ogi.outgoing_good_company
         AND og.id = ogi.outgoing_good_id
         AND og.outgoing_date = ogi.outgoing_good_date
        WHERE og.company_code = p_company_code
          AND ogi.item_type = p_item_type
          AND ogi.item_code = p_item_code
          AND ogi.uom = p_uom
          AND og.deleted_at IS NULL
          AND ogi.deleted_at IS NULL

        UNION ALL

        SELECT
            mui.item_name,
            mu.transaction_date AS effective_date,
            mui.updated_at,
            mui.created_at,
            mui.id::BIGINT AS source_id,
            30 AS source_priority,
            'material_usage_items' AS source_name
        FROM material_usage_items mui
        JOIN material_usages mu
          ON mu.company_code = mui.material_usage_company
         AND mu.id = mui.material_usage_id
         AND mu.transaction_date = mui.material_usage_date
        WHERE mu.company_code = p_company_code
          AND mui.item_type = p_item_type
          AND mui.item_code = p_item_code
          AND mui.uom = p_uom
          AND mu.deleted_at IS NULL
          AND mui.deleted_at IS NULL

        UNION ALL

        SELECT
            poi.item_name,
            po.transaction_date AS effective_date,
            poi.updated_at,
            poi.created_at,
            poi.id::BIGINT AS source_id,
            40 AS source_priority,
            'production_output_items' AS source_name
        FROM production_output_items poi
        JOIN production_outputs po
          ON po.company_code = poi.production_output_company
         AND po.id = poi.production_output_id
         AND po.transaction_date = poi.production_output_date
        WHERE po.company_code = p_company_code
          AND poi.item_type = p_item_type
          AND poi.item_code = p_item_code
          AND poi.uom = p_uom
          AND po.deleted_at IS NULL
          AND poi.deleted_at IS NULL

        UNION ALL

        SELECT
            ai.item_name,
            a.transaction_date AS effective_date,
            ai.updated_at,
            ai.created_at,
            ai.id::BIGINT AS source_id,
            50 AS source_priority,
            'adjustment_items' AS source_name
        FROM adjustment_items ai
        JOIN adjustments a
          ON a.company_code = ai.adjustment_company
         AND a.id = ai.adjustment_id
         AND a.transaction_date = ai.adjustment_date
        WHERE a.company_code = p_company_code
          AND ai.item_type = p_item_type
          AND ai.item_code = p_item_code
          AND ai.uom = p_uom
          AND a.deleted_at IS NULL
          AND ai.deleted_at IS NULL

        UNION ALL

        SELECT
            bb.item_name,
            bb.balance_date AS effective_date,
            bb.updated_at,
            bb.created_at,
            bb.id::BIGINT AS source_id,
            60 AS source_priority,
            'beginning_balances' AS source_name
        FROM beginning_balances bb
        WHERE bb.company_code = p_company_code
          AND bb.item_type = p_item_type
          AND bb.item_code = p_item_code
          AND bb.uom = p_uom
          AND bb.deleted_at IS NULL

        UNION ALL

        SELECT
            sti.item_name,
            st.transaction_date AS effective_date,
            sti.updated_at,
            sti.created_at,
            sti.id::BIGINT AS source_id,
            70 AS source_priority,
            'scrap_transaction_items' AS source_name
        FROM scrap_transaction_items sti
        JOIN scrap_transactions st
          ON st.company_code = sti.scrap_transaction_company
         AND st.id = sti.scrap_transaction_id
         AND st.transaction_date = sti.scrap_transaction_date
        WHERE st.company_code = p_company_code
          AND sti.item_type = p_item_type
          AND sti.item_code = p_item_code
          AND sti.uom = p_uom
          AND st.deleted_at IS NULL
          AND sti.deleted_at IS NULL

        UNION ALL

        SELECT
            sds.item_name,
            sds.snapshot_date AS effective_date,
            sds.updated_at,
            sds.created_at,
            sds.id::BIGINT AS source_id,
            900 AS source_priority,
            'stock_daily_snapshot' AS source_name
        FROM stock_daily_snapshot sds
        WHERE sds.company_code = p_company_code
          AND sds.item_type = p_item_type
          AND sds.item_code = p_item_code
          AND sds.uom = p_uom
    )
    SELECT LEFT(TRIM(item_name), 200)::VARCHAR(200)
    FROM candidates
    WHERE NULLIF(TRIM(item_name), '') IS NOT NULL
    ORDER BY
        CASE WHEN source_priority = 900 THEN 1 ELSE 0 END ASC,
        effective_date DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        source_id DESC,
        source_priority ASC,
        source_name ASC
    LIMIT 1;
$$;

COMMENT ON FUNCTION get_latest_stock_item_name IS 'Returns deterministic latest display item_name for company_code + item_type + item_code + uom; wip_balances is excluded and stock_daily_snapshot is fallback only.';

CREATE OR REPLACE FUNCTION sync_stock_daily_snapshot_item_name_for_identity(
    p_company_code INTEGER,
    p_item_type VARCHAR,
    p_item_code VARCHAR,
    p_uom VARCHAR
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_item_name VARCHAR(200);
    v_updated_count INTEGER := 0;
BEGIN
    v_item_name := get_latest_stock_item_name(
        p_company_code,
        p_item_type::VARCHAR(10),
        p_item_code::VARCHAR(50),
        p_uom::VARCHAR(20)
    );

    IF v_item_name IS NULL OR v_item_name = '' THEN
        RETURN 0;
    END IF;

    UPDATE stock_daily_snapshot sds
    SET
        item_name = v_item_name,
        updated_at = NOW()
    WHERE sds.company_code = p_company_code
      AND sds.item_type = p_item_type
      AND sds.item_code = p_item_code
      AND sds.uom = p_uom
      AND sds.item_name IS DISTINCT FROM v_item_name;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION sync_stock_daily_snapshot_item_name_for_identity IS 'Synchronizes stock_daily_snapshot.item_name for one company_code + item_type + item_code + uom identity; updates no quantities and does not touch transaction or WIP tables.';

CREATE OR REPLACE FUNCTION sync_item_description_from_payload(
    p_company_code INTEGER,
    p_item_type VARCHAR,
    p_item_code VARCHAR,
    p_uom VARCHAR,
    p_item_name VARCHAR
)
RETURNS TABLE(
    sds_updated_count INTEGER,
    wip_updated_count INTEGER
)
LANGUAGE plpgsql
AS $$
DECLARE
    v_item_name VARCHAR(200);
BEGIN
    v_item_name := LEFT(TRIM(p_item_name), 200)::VARCHAR(200);

    IF NULLIF(v_item_name, '') IS NULL THEN
        sds_updated_count := 0;
        wip_updated_count := 0;
        RETURN NEXT;
        RETURN;
    END IF;

    UPDATE stock_daily_snapshot
    SET
        item_name = v_item_name,
        updated_at = NOW()
    WHERE company_code = p_company_code
      AND item_type = p_item_type
      AND item_code = p_item_code
      AND uom = p_uom
      AND item_name IS DISTINCT FROM v_item_name;

    GET DIAGNOSTICS sds_updated_count = ROW_COUNT;

    UPDATE wip_balances
    SET
        item_name = v_item_name,
        updated_at = NOW()
    WHERE company_code = p_company_code
      AND item_type = p_item_type
      AND item_code = p_item_code
      AND uom = p_uom
      AND item_name IS DISTINCT FROM v_item_name;

    GET DIAGNOSTICS wip_updated_count = ROW_COUNT;

    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION sync_item_description_from_payload IS 'Payload-driven display item_name sync for stock_daily_snapshot and wip_balances; updates only changed item_name/updated_at rows and never scans historical source tables.';

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
    operation VARCHAR(20)
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
    v_item_name VARCHAR(200);
BEGIN
    v_opening_balance := get_item_opening_balance(
        p_company_code, p_item_type, p_item_code, p_uom, p_snapshot_date
    );

    SELECT COALESCE(SUM(qty), NUMERIC '0.000')
    INTO v_incoming_qty
    FROM (
      SELECT qty
      FROM incoming_good_items
      WHERE incoming_good_company = p_company_code
        AND item_type = p_item_type
        AND item_type != 'SCRAP'
        AND item_code = p_item_code
        AND uom = p_uom
        AND incoming_good_date = p_snapshot_date
        AND deleted_at IS NULL

      UNION ALL

      SELECT sti.qty
      FROM scrap_transaction_items sti
      JOIN scrap_transactions st ON sti.scrap_transaction_id = st.id
      WHERE st.company_code = p_company_code
        AND sti.item_type = 'SCRAP'
        AND p_item_type = 'SCRAP'
        AND sti.item_code = p_item_code
        AND sti.uom = p_uom
        AND st.transaction_type = 'IN'
        AND st.transaction_date = p_snapshot_date
        AND st.deleted_at IS NULL
        AND sti.deleted_at IS NULL
    ) AS combined_incoming;

    SELECT COALESCE(SUM(qty), NUMERIC '0.000')
    INTO v_outgoing_qty
    FROM (
      SELECT qty
      FROM outgoing_good_items
      WHERE outgoing_good_company = p_company_code
        AND item_type = p_item_type
        AND item_code = p_item_code
        AND uom = p_uom
        AND outgoing_good_date = p_snapshot_date
        AND deleted_at IS NULL

      UNION ALL

      SELECT sti.qty
      FROM scrap_transaction_items sti
      JOIN scrap_transactions st ON sti.scrap_transaction_id = st.id
      WHERE st.company_code = p_company_code
        AND sti.item_type = 'SCRAP'
        AND p_item_type = 'SCRAP'
        AND sti.item_code = p_item_code
        AND sti.uom = p_uom
        AND st.transaction_type = 'OUT'
        AND st.transaction_date = p_snapshot_date
        AND st.deleted_at IS NULL
        AND sti.deleted_at IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM outgoing_good_items
          WHERE outgoing_good_company = p_company_code
            AND item_type = 'SCRAP'
            AND item_code = p_item_code
            AND uom = p_uom
            AND outgoing_good_date = p_snapshot_date
            AND deleted_at IS NULL
        )
    ) AS combined_outgoing;

    SELECT COALESCE(SUM(
        CASE
            WHEN mu.reversal = 'Y' THEN -mui.qty
            ELSE mui.qty
        END
    ), NUMERIC '0.000')
    INTO v_material_usage_qty
    FROM material_usage_items mui
    JOIN material_usages mu ON mui.material_usage_id = mu.id
    WHERE mu.company_code = p_company_code
      AND mui.item_type = p_item_type
      AND mui.item_code = p_item_code
      AND mui.uom = p_uom
      AND mu.transaction_date = p_snapshot_date
      AND mu.deleted_at IS NULL
      AND mui.deleted_at IS NULL;

    SELECT COALESCE(SUM(
        CASE
            WHEN po.reversal = 'Y' THEN -poi.qty
            ELSE poi.qty
        END
    ), NUMERIC '0.000')
    INTO v_production_qty
    FROM production_output_items poi
    JOIN production_outputs po ON poi.production_output_id = po.id
    WHERE po.company_code = p_company_code
      AND poi.item_type = p_item_type
      AND poi.item_code = p_item_code
      AND poi.uom = p_uom
      AND po.transaction_date = p_snapshot_date
      AND po.deleted_at IS NULL
      AND poi.deleted_at IS NULL;

    SELECT COALESCE(SUM(
        CASE
            WHEN ai.adjustment_type = 'GAIN' THEN ai.qty
            ELSE -ai.qty
        END
    ), NUMERIC '0.000')
    INTO v_adjustment_qty
    FROM adjustment_items ai
    WHERE ai.adjustment_company = p_company_code
      AND ai.item_type = p_item_type
      AND ai.item_code = p_item_code
      AND ai.uom = p_uom
      AND ai.adjustment_date = p_snapshot_date
      AND ai.deleted_at IS NULL;

    v_closing_balance := v_opening_balance
                       + v_incoming_qty
                       - v_outgoing_qty
                       - v_material_usage_qty
                       + v_production_qty
                       + v_adjustment_qty;

    SELECT EXISTS (
        SELECT 1 FROM stock_daily_snapshot
        WHERE company_code = p_company_code
          AND item_type = p_item_type
          AND item_code = p_item_code
          AND uom = p_uom
          AND snapshot_date = p_snapshot_date
    ) INTO v_exists;

    v_item_name := COALESCE(
        NULLIF(LEFT(TRIM(p_item_name), 200), ''),
        (
            SELECT NULLIF(item_name, '')
            FROM stock_daily_snapshot
            WHERE company_code = p_company_code
              AND item_type = p_item_type
              AND item_code = p_item_code
              AND uom = p_uom
              AND snapshot_date = p_snapshot_date
            LIMIT 1
        ),
        ''
    );

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
        v_item_name,
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
    ON CONFLICT (company_code, item_type, item_code, uom, snapshot_date) DO UPDATE
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

    v_operation := CASE WHEN v_exists THEN 'UPDATE' ELSE 'INSERT' END;

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

CREATE OR REPLACE FUNCTION recalculate_item_snapshots_from_date(
    p_company_code INTEGER,
    p_item_type VARCHAR(10),
    p_item_code VARCHAR(50),
    p_uom VARCHAR(20),
    p_from_date DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_snapshot_date DATE;
    v_item_name VARCHAR(200);
    v_count INTEGER := 0;
    v_dates_cursor CURSOR FOR
        SELECT DISTINCT snapshot_date
        FROM stock_daily_snapshot
        WHERE company_code = p_company_code
          AND item_type = p_item_type
          AND item_code = p_item_code
          AND uom = p_uom
          AND snapshot_date >= p_from_date
        ORDER BY snapshot_date ASC;
BEGIN
    -- Serialize cascades for the same stock identity so future dates do not
    -- read stale previous closing balances while another cascade is running.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            CONCAT_WS(
                '|',
                'stock_daily_snapshot_cascade',
                p_company_code::TEXT,
                p_item_type,
                p_item_code,
                p_uom
            ),
            0
        )
    );

    SELECT COALESCE(NULLIF(item_name, ''), '')
    INTO v_item_name
    FROM stock_daily_snapshot
    WHERE company_code = p_company_code
      AND item_type = p_item_type
      AND item_code = p_item_code
      AND uom = p_uom
      AND snapshot_date >= p_from_date
    ORDER BY snapshot_date ASC
    LIMIT 1;

    v_item_name := COALESCE(v_item_name, '');

    OPEN v_dates_cursor;
    LOOP
        FETCH v_dates_cursor INTO v_snapshot_date;
        EXIT WHEN v_snapshot_date IS NULL;

        PERFORM upsert_item_stock_snapshot(
            p_company_code,
            p_item_type,
            p_item_code,
            v_item_name,
            p_uom,
            v_snapshot_date
        );

        v_count := v_count + 1;
    END LOOP;
    CLOSE v_dates_cursor;

    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION sync_stock_daily_snapshot_item_names()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_updated_count INTEGER := 0;
BEGIN
    WITH identities AS (
        SELECT DISTINCT
            sds.company_code,
            sds.item_type,
            sds.item_code,
            sds.uom
        FROM stock_daily_snapshot sds
    ),
    canonical AS (
        SELECT
            identities.company_code,
            identities.item_type,
            identities.item_code,
            identities.uom,
            get_latest_stock_item_name(
                identities.company_code,
                identities.item_type,
                identities.item_code,
                identities.uom
            ) AS item_name
        FROM identities
    )
    UPDATE stock_daily_snapshot sds
    SET
        item_name = canonical.item_name,
        updated_at = NOW()
    FROM canonical
    WHERE sds.company_code = canonical.company_code
      AND sds.item_type = canonical.item_type
      AND sds.item_code = canonical.item_code
      AND sds.uom = canonical.uom
      AND canonical.item_name IS NOT NULL
      AND canonical.item_name != ''
      AND sds.item_name IS DISTINCT FROM canonical.item_name;

    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION sync_stock_daily_snapshot_item_names IS 'Idempotently updates only stock_daily_snapshot.item_name to latest canonical display names; does not change transactions, quantities, dates, or rows.';

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

GRANT EXECUTE ON FUNCTION get_latest_stock_item_name(INTEGER, VARCHAR, VARCHAR, VARCHAR) TO imapsuser;
GRANT EXECUTE ON FUNCTION sync_stock_daily_snapshot_item_name_for_identity(INTEGER, VARCHAR, VARCHAR, VARCHAR) TO imapsuser;
GRANT EXECUTE ON FUNCTION sync_item_description_from_payload(INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO imapsuser;
GRANT EXECUTE ON FUNCTION upsert_item_stock_snapshot(INTEGER, VARCHAR, VARCHAR, VARCHAR, VARCHAR, DATE) TO imapsuser;
GRANT EXECUTE ON FUNCTION recalculate_item_snapshots_from_date(INTEGER, VARCHAR, VARCHAR, VARCHAR, DATE) TO imapsuser;
GRANT EXECUTE ON FUNCTION sync_stock_daily_snapshot_item_names() TO imapsuser;
GRANT EXECUTE ON FUNCTION calculate_stock_snapshot(INTEGER, DATE) TO imapsuser;
GRANT EXECUTE ON FUNCTION calculate_stock_snapshot_range(INTEGER, DATE, DATE) TO imapsuser;
GRANT EXECUTE ON FUNCTION process_recalc_queue(INTEGER) TO imapsuser;
