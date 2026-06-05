-- =============================================================================
-- iMAPS Production Hotfix
-- Disable legacy WIP Balance -> stock_daily_snapshot side-effect triggers
--
-- Safe production usage:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f scripts/sql/production/20260526_disable_wip_sds_side_effect_hotfix.sql
--
-- This patch is only useful when a database has a trigger attached to
-- public.wip_balances whose trigger function body references stock_daily_snapshot.
-- In environments without such a trigger it is a safe no-op and does not prove
-- that WIP was the root cause.
--
-- It does not drop tables, truncate data, rebuild indexes, touch partitions,
-- or clean existing bad SDS rows.
--
-- Manual cleanup for already-created bad rows, after backup/audit:
--   DELETE FROM stock_daily_snapshot WHERE calculation_method = 'WIP_SNAPSHOT';
-- =============================================================================

DO $$
DECLARE
    v_trigger RECORD;
    v_dropped_count INTEGER := 0;
BEGIN
    FOR v_trigger IN
        SELECT
            n.nspname AS schema_name,
            c.relname AS table_name,
            t.tgname AS trigger_name,
            p.proname AS function_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE n.nspname = 'public'
          AND c.relname = 'wip_balances'
          AND NOT t.tgisinternal
          AND regexp_replace(
                regexp_replace(
                    pg_get_functiondef(p.oid),
                    '/\*([^*]|\*[^/])*\*/',
                    '',
                    'gs'
                ),
                '--[^\r\n]*',
                '',
                'g'
              ) ILIKE '%stock_daily_snapshot%'
    LOOP
        EXECUTE format(
            'DROP TRIGGER IF EXISTS %I ON %I.%I',
            v_trigger.trigger_name,
            v_trigger.schema_name,
            v_trigger.table_name
        );

        v_dropped_count := v_dropped_count + 1;
        RAISE NOTICE
            'Dropped WIP -> SDS trigger %.% using function %',
            v_trigger.table_name,
            v_trigger.trigger_name,
            v_trigger.function_name;
    END LOOP;

    IF v_dropped_count = 0 THEN
        RAISE NOTICE 'No WIP -> stock_daily_snapshot triggers found on public.wip_balances';
    ELSE
        RAISE NOTICE 'Dropped % WIP -> stock_daily_snapshot trigger(s)', v_dropped_count;
    END IF;
END $$;
