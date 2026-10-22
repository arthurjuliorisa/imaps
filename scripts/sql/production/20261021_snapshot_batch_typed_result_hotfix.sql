-- iMAPS wrapper-only corrective: SQLSTATE 42703 at batch RETURN QUERY.
-- NOT APPLIED / PRODUCTION NOT AUTHORIZED. User-controlled local clone only.
-- Runbook: scripts/sql/local/20261021_snapshot_wrapper_corrective_runbook.sql
-- Apply AFTER base snapshot SQL and the 20260525 description hotfix.
-- Never rerun the base/deploy:sql afterward without reapplying this correction.
-- User command: psql -X -v ON_ERROR_STOP=1 -1 -f <this file>
-- No DROP, owner/ACL changes, schema changes, or data manipulation.
-- pg_get_functiondef supplies CREATE OR REPLACE with installed attributes.
-- Exact source allowlist prevents silently replacing an unreviewed wrapper.
DO $hotfix$
DECLARE
    v_oid OID := 'public.upsert_items_stock_snapshot(integer,jsonb,date)'::regprocedure;
    v_source TEXT;
    v_definition TEXT;
    v_metadata JSONB;
    v_corrected_source CONSTANT TEXT := $wrapper$
DECLARE
    v_item JSONB;
    v_item_type VARCHAR(10);
    v_item_code VARCHAR(50);
    v_item_name VARCHAR(200);
    v_uom VARCHAR(20);
    v_opening_balance NUMERIC;
    v_closing_balance NUMERIC;
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
            SELECT s.opening_balance, s.closing_balance
            INTO STRICT v_opening_balance, v_closing_balance
            FROM upsert_item_stock_snapshot(
                p_company_code,
                v_item_type,
                v_item_code,
                v_item_name,
                v_uom,
                p_snapshot_date
            ) AS s;

            IF v_opening_balance IS NULL OR v_closing_balance IS NULL
               OR v_opening_balance::TEXT IN ('NaN', 'Infinity', '-Infinity')
               OR v_closing_balance::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
                RAISE EXCEPTION 'Snapshot balances must be finite and non-null';
            END IF;

            RETURN QUERY SELECT
                v_item_code::VARCHAR(50),
                v_opening_balance::NUMERIC(15,3),
                v_closing_balance::NUMERIC(15,3),
                'SUCCESS'::VARCHAR(20),
                format('Item %s snapshot calculated', v_item_code)::TEXT;

        EXCEPTION WHEN OTHERS THEN
            RETURN QUERY SELECT
                v_item_code::VARCHAR(50),
                NULL::NUMERIC(15,3),
                NULL::NUMERIC(15,3),
                'ERROR'::VARCHAR(20),
                format('Failed to upsert snapshot: %s', SQLERRM)::TEXT;
        END;
    END LOOP;
END;
$wrapper$;
BEGIN
    IF current_database() <> 'imaps_prod_repro'
       OR inet_server_addr() IS NULL
       OR inet_server_addr() NOT IN (inet '127.0.0.1', inet '::1')
       OR current_user <> 'imapsuser' THEN
        RAISE EXCEPTION 'Expected loopback imaps_prod_repro clone as imapsuser; production not authorized';
    END IF;

    SELECT p.prosrc, pg_get_functiondef(p.oid), to_jsonb(p) - 'prosrc'
    INTO STRICT v_source, v_definition, v_metadata
    FROM pg_proc p WHERE p.oid = v_oid;

    IF v_source = v_corrected_source THEN
        RAISE NOTICE 'Wrapper corrective already applied; no change';
        RETURN;
    END IF;
    IF md5(v_source) <> 'f7e4c494f3577d10d5ee1b236cc744e0' THEN
        RAISE EXCEPTION 'Wrapper source differs from proven definition; stop and review';
    END IF;
    IF (length(v_definition) - length(replace(v_definition, v_source, '')))
           <> length(v_source) THEN
        RAISE EXCEPTION 'Expected exactly one source occurrence in saved definition';
    END IF;

    EXECUTE replace(v_definition, v_source, v_corrected_source);

    -- Includes OID, signature/OUT names and types, owner, ACL, security,
    -- strictness, volatility, cost, rows, parallel, support and config.
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid
          AND p.prosrc = v_corrected_source
          AND (to_jsonb(p) - 'prosrc') = v_metadata
    ) THEN
        RAISE EXCEPTION 'Wrapper metadata/source changed unexpectedly; rolling back corrective';
    END IF;
    RAISE NOTICE 'Wrapper result extraction corrected; all other pg_proc fields preserved';
END;
$hotfix$;
