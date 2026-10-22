-- Operator-run READ ONLY. Capture stdout with -X -At -v ON_ERROR_STOP=1.
-- Contains exact definitions and role/ACL metadata: store in a restricted backup directory.
BEGIN READ ONLY;
SELECT jsonb_pretty(jsonb_build_object(
    'database', current_database(),
    'server_version_num', current_setting('server_version_num'),
    'server_address', inet_server_addr(),
    'server_port', inet_server_port(),
    'current_user', current_user,
    'session_user', session_user,
    'search_path', current_setting('search_path'),
    'wrapper', jsonb_build_object(
        'definition', pg_get_functiondef(p.oid),
        'source', p.prosrc,
        'source_md5', md5(p.prosrc),
        'metadata', to_jsonb(p) - 'prosrc',
        'metadata_md5', md5((to_jsonb(p) - 'prosrc')::TEXT),
        'result', pg_get_function_result(p.oid),
        'owner', pg_get_userbyid(p.proowner),
        'comment', obj_description(p.oid, 'pg_proc'),
        'operator_has_owner_privileges', pg_has_role(current_user, p.proowner, 'USAGE'),
        'schema_create', has_schema_privilege(current_user, 'public', 'CREATE'),
        'schema_usage', has_schema_privilege(current_user, 'public', 'USAGE')
    ),
    'per_item', jsonb_build_object(
        'definition', pg_get_functiondef(i.oid),
        'definition_md5', md5(pg_get_functiondef(i.oid)),
        'metadata', to_jsonb(i) - 'prosrc',
        'operator_execute', has_function_privilege(current_user, i.oid, 'EXECUTE'),
        'unqualified_resolution_matches', to_regprocedure('upsert_item_stock_snapshot(integer,character varying,character varying,character varying,character varying,date)') = i.oid
    ),
    'snapshot_table', to_regclass('public.stock_daily_snapshot'),
    'beginning_balance_table', to_regclass('public.beginning_balances')
))
FROM pg_proc p CROSS JOIN pg_proc i
WHERE p.oid = 'public.upsert_items_stock_snapshot(integer,jsonb,date)'::regprocedure
  AND i.oid = 'public.upsert_item_stock_snapshot(integer,character varying,character varying,character varying,character varying,date)'::regprocedure;
ROLLBACK;
