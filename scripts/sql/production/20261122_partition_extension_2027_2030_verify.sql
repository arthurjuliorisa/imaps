-- Read-only psql catalog verification; safe before/after application once target access is approved.
-- 464 expected nodes: 292 target leaves, 147 historical leaves, 25 partitioned nodes.
-- Any non-OK row blocks acceptance. Missing target rows before application are expected.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL statement_timeout = '30s';
SELECT current_database(), current_user, inet_server_addr(), inet_server_port(),
       current_setting('server_version'), current_setting('transaction_read_only');
WITH RECURSIVE
roots(root, key) AS (VALUES
    ('incoming_goods', 'incoming_date'), ('material_usages', 'transaction_date'),
    ('wip_balances', 'stock_date'), ('production_outputs', 'transaction_date'),
    ('outgoing_goods', 'outgoing_date'), ('adjustments', 'transaction_date'),
    ('stock_daily_snapshot', 'snapshot_date')),
companies(company) AS (VALUES (1310), (1370), (1380)),
ranges AS (
    SELECT root, root || '_' || company AS parent, key, y, q,
           make_date(y, (q - 1) * 3 + 1, 1) AS lo,
           (make_date(y, (q - 1) * 3 + 1, 1) + interval '3 months')::date AS hi
    FROM roots CROSS JOIN companies CROSS JOIN generate_series(2025, 2030) y
    CROSS JOIN generate_series(1, 4) q WHERE root <> 'stock_daily_snapshot'
    UNION ALL
    SELECT root, root, key, y, NULL::integer, make_date(y, 1, 1), make_date(y + 1, 1, 1)
    FROM roots CROSS JOIN generate_series(2024, 2030) y WHERE root = 'stock_daily_snapshot'
),
expected(name, parent, root, kind, bound, partkey, scope) AS (
    SELECT root, NULL::text, root, 'p', NULL::text,
           CASE WHEN root = 'stock_daily_snapshot' THEN 'RANGE (snapshot_date)' ELSE 'LIST (company_code)' END,
           'root' FROM roots
    UNION ALL
    SELECT root || '_' || company, root, root, 'p', format('FOR VALUES IN (%s)', company),
           format('RANGE (%I)', key), 'company'
    FROM roots CROSS JOIN companies WHERE root <> 'stock_daily_snapshot'
    UNION ALL
    SELECT parent || '_' || y || CASE WHEN q IS NULL THEN '' ELSE '_q' || q END,
           parent, root, 'r', format('FOR VALUES FROM (%L) TO (%L)', lo, hi), NULL,
           CASE WHEN y >= 2027 THEN 'target' ELSE 'historical' END FROM ranges
),
actual_tree(oid) AS (
    SELECT c.oid FROM roots r JOIN pg_namespace n ON n.nspname = 'public'
    JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = r.root
    UNION ALL SELECT i.inhrelid FROM actual_tree t JOIN pg_inherits i ON i.inhparent = t.oid
),
checks AS (
    SELECT e.*, c.oid, pg_get_expr(c.relpartbound, c.oid) AS actual_bound,
           array_remove(ARRAY[
        CASE WHEN c.oid IS NULL THEN 'MISSING' END,
        CASE WHEN c.oid IS NOT NULL AND (c.relkind::text <> e.kind
            OR c.relispartition <> (e.parent IS NOT NULL)
            OR pg_get_partkeydef(c.oid) IS DISTINCT FROM e.partkey) THEN 'KIND_OR_KEY' END,
        CASE WHEN pg_get_expr(c.relpartbound, c.oid) IS DISTINCT FROM e.bound THEN 'BOUNDS' END,
        CASE WHEN (SELECT count(*) FROM pg_inherits WHERE inhrelid = c.oid) <>
                      CASE WHEN e.parent IS NULL THEN 0 ELSE 1 END
             OR (e.parent IS NOT NULL AND NOT EXISTS (SELECT FROM pg_inherits
                  WHERE inhrelid = c.oid AND inhparent = p.oid)) THEN 'PARENT' END,
        CASE WHEN c.relowner IS DISTINCT FROM rc.relowner THEN 'OWNER' END,
        CASE WHEN EXISTS (SELECT FROM pg_partitioned_table WHERE partrelid = c.oid AND partdefid <> 0)
             THEN 'DEFAULT' END,
        CASE WHEN c.oid IS NOT NULL AND (NOT EXISTS (SELECT FROM pg_index WHERE indrelid = c.oid)
             OR EXISTS (SELECT FROM pg_index WHERE indrelid = c.oid
                        AND (NOT indisvalid OR NOT indisready OR NOT indislive))) THEN 'INVALID_OR_NO_INDEX' END,
        CASE WHEN e.parent IS NOT NULL AND EXISTS (SELECT FROM pg_index pi WHERE pi.indrelid = p.oid
             AND NOT EXISTS (SELECT FROM pg_inherits ii JOIN pg_index ci ON ci.indexrelid = ii.inhrelid
                 WHERE ii.inhparent = pi.indexrelid AND ci.indrelid = c.oid
                   AND ci.indisvalid AND ci.indisready AND ci.indislive
                   AND ci.indisunique = pi.indisunique)) THEN 'INDEX_ATTACHMENT' END,
        CASE WHEN EXISTS (SELECT FROM pg_constraint WHERE conrelid = c.oid AND NOT convalidated)
             OR EXISTS (SELECT FROM pg_constraint pc WHERE pc.conrelid = p.oid AND (pc.contype <> 'c' OR NOT pc.connoinherit)
               AND NOT EXISTS (SELECT FROM pg_constraint cc WHERE cc.conrelid = c.oid AND cc.convalidated
                 AND cc.contype = pc.contype AND (cc.conparentid = pc.oid OR (cc.conname = pc.conname
                   AND pg_get_constraintdef(cc.oid) = pg_get_constraintdef(pc.oid))))) THEN 'CONSTRAINT' END,
        CASE WHEN EXISTS (SELECT FROM pg_attribute pa WHERE pa.attrelid = p.oid AND pa.attnum > 0
             AND NOT pa.attisdropped AND NOT EXISTS (SELECT FROM pg_attribute ca
                 WHERE ca.attrelid = c.oid AND ca.attname = pa.attname AND NOT ca.attisdropped
                   AND ca.atttypid = pa.atttypid AND ca.atttypmod = pa.atttypmod
                   AND (NOT pa.attnotnull OR ca.attnotnull))) THEN 'COLUMN_OR_NOT_NULL' END
    ], NULL) AS failures
    FROM expected e LEFT JOIN pg_namespace n ON n.nspname = 'public'
    LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = e.name
    LEFT JOIN pg_class p ON p.relnamespace = n.oid AND p.relname = e.parent
    LEFT JOIN pg_class rc ON rc.relnamespace = n.oid AND rc.relname = e.root
),
result AS (
    SELECT scope, name, parent, bound, actual_bound,
           CASE WHEN cardinality(failures) = 0 THEN 'OK' ELSE array_to_string(failures, ',') END AS status
    FROM checks
    UNION ALL
    SELECT 'unexpected', n.nspname || '.' || c.relname, NULL, NULL, pg_get_expr(c.relpartbound, c.oid),
           'UNEXPECTED_ATTACHED_RELATION'
    FROM actual_tree t JOIN pg_class c ON c.oid = t.oid JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT EXISTS (SELECT FROM expected e WHERE n.nspname = 'public' AND e.name = c.relname)
)
SELECT *, count(*) FILTER (WHERE scope = 'target') OVER () AS expected_target_count,
          count(*) FILTER (WHERE scope = 'target' AND status = 'OK') OVER () AS verified_target_count,
          count(*) FILTER (WHERE status <> 'OK') OVER () AS total_problem_rows
FROM result ORDER BY scope, name;

-- Explicit business identity expectations, independent of whether any indexes happen to exist.
WITH required(root, columns, primary_key) AS (VALUES
    ('incoming_goods', ARRAY['company_code','wms_id','incoming_date'], false),
    ('incoming_goods', ARRAY['company_code','id','incoming_date'], false),
    ('material_usages', ARRAY['company_code','wms_id','transaction_date'], false),
    ('material_usages', ARRAY['company_code','id','transaction_date'], false),
    ('wip_balances', ARRAY['company_code','wms_id','stock_date'], false),
    ('production_outputs', ARRAY['company_code','wms_id','transaction_date'], false),
    ('production_outputs', ARRAY['company_code','id','transaction_date'], false),
    ('outgoing_goods', ARRAY['company_code','wms_id','outgoing_date'], false),
    ('outgoing_goods', ARRAY['company_code','id','outgoing_date'], false),
    ('adjustments', ARRAY['company_code','wms_id','transaction_date'], false),
    ('adjustments', ARRAY['company_code','id','transaction_date'], false),
    ('stock_daily_snapshot', ARRAY['company_code','item_type','item_code','uom','snapshot_date'], false),
    ('stock_daily_snapshot', ARRAY['id','snapshot_date'], true)
)
SELECT root, columns, primary_key, CASE WHEN EXISTS (
    SELECT FROM pg_index i WHERE i.indrelid = to_regclass(format('public.%I', root))
    AND i.indisunique AND i.indisvalid AND i.indisready AND i.indislive
    AND i.indpred IS NULL AND i.indexprs IS NULL AND (NOT primary_key OR i.indisprimary)
    AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num, ord)
        JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.num
        WHERE k.ord <= i.indnkeyatts ORDER BY k.ord) = required.columns
) THEN 'OK' ELSE 'MISSING_OR_INVALID_BUSINESS_KEY' END AS status
FROM required ORDER BY root, columns;

-- Stable catalog inventory for baseline comparison (no row scans, no physical size/statistics).
-- Save the HISTORY rows before/after and compare verbatim. New target children are excluded.
-- Root/intermediate definitions, ACLs, original OIDs, indexes, constraints and triggers included.
WITH RECURSIVE family(oid) AS (
    SELECT c.oid FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('incoming_goods', 'material_usages', 'wip_balances',
        'production_outputs', 'outgoing_goods', 'adjustments', 'stock_daily_snapshot')
    UNION ALL SELECT i.inhrelid FROM family f JOIN pg_inherits i ON i.inhparent = f.oid
)
SELECT 'HISTORY' AS section, c.oid, c.oid::regclass::text AS relation,
    jsonb_build_object('kind', c.relkind, 'partition', c.relispartition, 'owner', c.relowner,
        'acl', c.relacl, 'key', pg_get_partkeydef(c.oid), 'bound', pg_get_expr(c.relpartbound, c.oid),
        'parents', (SELECT jsonb_agg(inhparent ORDER BY inhparent) FROM pg_inherits WHERE inhrelid = c.oid),
        'columns', (SELECT jsonb_agg(jsonb_build_array(a.attnum, a.attname, a.atttypid, a.atttypmod,
            a.attnotnull, a.attisdropped, a.attidentity, a.attgenerated, a.attcollation,
            pg_get_expr(d.adbin, d.adrelid)) ORDER BY a.attnum)
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
            WHERE a.attrelid = c.oid AND a.attnum > 0),
        'indexes', (SELECT jsonb_agg(jsonb_build_array(i.indexrelid, pg_get_indexdef(i.indexrelid),
            i.indisvalid, i.indisready, i.indislive,
            (SELECT inhparent FROM pg_inherits WHERE inhrelid = i.indexrelid)) ORDER BY i.indexrelid)
            FROM pg_index i WHERE i.indrelid = c.oid),
        'constraints', (SELECT jsonb_agg(jsonb_build_array(oid, conname, conparentid, convalidated,
            pg_get_constraintdef(oid)) ORDER BY oid) FROM pg_constraint WHERE conrelid = c.oid),
        'triggers', (SELECT jsonb_agg(jsonb_build_array(oid, tgenabled, pg_get_triggerdef(oid)) ORDER BY oid)
            FROM pg_trigger WHERE tgrelid = c.oid)) AS metadata
FROM family f JOIN pg_class c ON c.oid = f.oid
WHERE c.relname !~ '_20(27|28|29|30)(_q[1-4])?$'
ORDER BY relation;
COMMIT;
