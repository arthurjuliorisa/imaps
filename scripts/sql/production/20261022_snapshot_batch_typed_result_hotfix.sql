-- Operator-only Production wrapper correction. NOT APPLIED. Never auto-discover.
-- Read/approve docs/snapshot-wrapper-production-deployment.md first.
-- Requires psql -X -v ON_ERROR_STOP=1 -1 and all reviewed variables below.
-- No connection-host assumptions: Unix sockets and TCP are supported.
SELECT set_config('imaps_patch.approved_role', :'approved_role', true),
       set_config('imaps_patch.approved_source_md5', :'approved_source_md5', true),
       set_config('imaps_patch.approved_metadata_md5', :'approved_metadata_md5', true),
       set_config('imaps_patch.approved_item_definition_md5', :'approved_item_definition_md5', true),
       set_config('imaps_patch.approved_server_version_num', :'approved_server_version_num', true);

DO $hotfix$
DECLARE
    v_oid OID := 'public.upsert_items_stock_snapshot(integer,jsonb,date)'::regprocedure;
    v_item_oid OID := 'public.upsert_item_stock_snapshot(integer,character varying,character varying,character varying,character varying,date)'::regprocedure;
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
    IF current_setting('server_version_num')::INTEGER < 110000
       OR current_database() <> 'imaps_db'
       OR current_user <> current_setting('imaps_patch.approved_role')
       OR session_user <> current_user
       OR current_setting('server_version_num') <> current_setting('imaps_patch.approved_server_version_num') THEN
        RAISE EXCEPTION 'Production database, reviewed direct operator role or server version mismatch';
    END IF;

    SELECT p.prosrc, pg_get_functiondef(p.oid), to_jsonb(p) - 'prosrc'
    INTO STRICT v_source, v_definition, v_metadata
    FROM pg_proc p WHERE p.oid = v_oid;

    -- Full same-server catalog fingerprint includes OID, signature, OUT columns,
    -- owner, ACL, volatility, security, config and version-specific fields.
    IF md5(v_metadata::TEXT) <> current_setting('imaps_patch.approved_metadata_md5')
       OR md5(v_source) <> current_setting('imaps_patch.approved_source_md5')
       OR md5(pg_get_functiondef(v_item_oid)) <> current_setting('imaps_patch.approved_item_definition_md5') THEN
        RAISE EXCEPTION 'Installed source, metadata or per-item prerequisite differs from reviewed preflight';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_language l ON l.oid = p.prolang
        WHERE p.oid = v_oid AND l.lanname = 'plpgsql' AND p.prokind = 'f'
          AND NOT p.prosecdef
          AND pg_has_role(current_user, p.proowner, 'USAGE')
    ) OR to_regclass('public.stock_daily_snapshot') IS NULL
       OR to_regclass('public.beginning_balances') IS NULL
       OR NOT has_schema_privilege(current_user, 'public', 'CREATE')
       OR NOT has_schema_privilege(current_user, 'public', 'USAGE')
       OR NOT has_function_privilege(current_user, v_item_oid, 'EXECUTE')
       OR to_regprocedure('upsert_item_stock_snapshot(integer,character varying,character varying,character varying,character varying,date)') IS DISTINCT FROM v_item_oid
       OR pg_get_function_result(v_oid) <> 'TABLE(item_code character varying, opening_balance numeric, closing_balance numeric, status character varying, message text)' THEN
        RAISE EXCEPTION 'Function signature, security, resolution or operator permissions are not approved';
    END IF;

    -- All environment/metadata checks run even for the idempotent no-op.
    IF v_source = v_corrected_source THEN
        RAISE NOTICE 'Verified corrected wrapper already installed; no change';
        RETURN;
    END IF;
    -- Only the proven old body is eligible; an operator variable cannot extend this allowlist.
    IF md5(v_source) <> 'f7e4c494f3577d10d5ee1b236cc744e0' THEN
        RAISE EXCEPTION 'Unknown wrapper body; stop for separately reviewed patch';
    END IF;
    IF (length(v_definition) - length(replace(v_definition, v_source, '')))
           <> length(v_source) THEN
        RAISE EXCEPTION 'Expected exactly one source occurrence in saved definition';
    END IF;

    EXECUTE replace(v_definition, v_source, v_corrected_source);

    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        WHERE p.oid = v_oid AND p.prosrc = v_corrected_source
          AND (to_jsonb(p) - 'prosrc') = v_metadata
    ) THEN
        RAISE EXCEPTION 'Wrapper source/metadata verification failed; transaction must roll back';
    END IF;
    RAISE NOTICE 'Wrapper corrected with OID and all other pg_proc fields preserved';
END;
$hotfix$;
