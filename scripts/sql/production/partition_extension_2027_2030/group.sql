-- Private include for the driver. No persistent helper functions or temp objects.
-- Replacement inserts SQL literals; identifiers inside DO use format(%I).
SELECT replace(replace(replace($command$
BEGIN;
SET LOCAL search_path = pg_catalog;
SET LOCAL datestyle = 'ISO, YMD';
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';
DO $group$
DECLARE
    root_name text := @ROOT@;
    date_key text := @KEY@;
    company text := @COMPANY@;
    parent_name text;
    root_oid oid;
    parent_oid oid;
    child_oid oid;
    owner_oid oid;
    leaf text;
    lo date;
    hi date;
    y integer;
    q integer;
    link record;
    required_key record;
    made integer := 0;
    skipped integer := 0;
BEGIN
    -- Fail closed on unsupported inputs, including standalone accidental includes.
    IF (root_name, date_key) NOT IN (
        ('incoming_goods', 'incoming_date'), ('material_usages', 'transaction_date'),
        ('wip_balances', 'stock_date'), ('production_outputs', 'transaction_date'),
        ('outgoing_goods', 'outgoing_date'), ('adjustments', 'transaction_date'),
        ('stock_daily_snapshot', 'snapshot_date'))
        OR (root_name = 'stock_daily_snapshot') <> (company = 'none')
        OR company NOT IN ('1310', '1370', '1380', 'none') THEN
        RAISE EXCEPTION 'Unexpected extension inputs: %, %, %', root_name, date_key, company;
    END IF;
    parent_name := CASE WHEN company = 'none' THEN root_name ELSE root_name || '_' || company END;
    -- ONLY prevents recursively locking historical leaves. Root first, consistent order.
    EXECUTE format('LOCK TABLE ONLY public.%I IN ACCESS SHARE MODE', root_name);
    EXECUTE format('LOCK TABLE ONLY public.%I IN ACCESS EXCLUSIVE MODE', parent_name);
    root_oid := to_regclass(format('public.%I', root_name));
    parent_oid := to_regclass(format('public.%I', parent_name));
    SELECT relowner INTO owner_oid FROM pg_class WHERE oid = root_oid;
    IF NOT EXISTS (SELECT FROM pg_class WHERE oid = root_oid AND relkind = 'p' AND NOT relispartition)
        OR pg_get_partkeydef(root_oid) IS DISTINCT FROM
            (CASE WHEN company = 'none' THEN 'RANGE (snapshot_date)' ELSE 'LIST (company_code)' END)
        OR pg_get_partkeydef(parent_oid) IS DISTINCT FROM format('RANGE (%I)', date_key)
        OR NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid = parent_oid AND attname = date_key
                       AND atttypid = 'date'::regtype AND NOT attisdropped)
        OR (company <> 'none' AND NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid = root_oid
                       AND attname = 'company_code' AND atttypid = 'int4'::regtype AND NOT attisdropped))
        OR NOT EXISTS (SELECT FROM pg_class WHERE oid = parent_oid AND relkind = 'p'
                       AND relowner = owner_oid)
        OR owner_oid IS DISTINCT FROM (SELECT oid FROM pg_roles WHERE rolname = current_user)
        OR NOT has_schema_privilege(current_user, 'public', 'USAGE')
        OR NOT has_schema_privilege(current_user, 'public', 'CREATE') THEN
        RAISE EXCEPTION 'Topology/key/owner mismatch for public.%; run as actual common owner; no repair attempted', parent_name;
    END IF;
    IF company <> 'none' AND (
        NOT EXISTS (SELECT FROM pg_inherits WHERE inhrelid = parent_oid AND inhparent = root_oid)
        OR (SELECT count(*) FROM pg_inherits WHERE inhrelid = parent_oid) <> 1
        OR (SELECT pg_get_expr(relpartbound, oid) FROM pg_class WHERE oid = parent_oid)
           IS DISTINCT FROM format('FOR VALUES IN (%s)', company)
        OR (SELECT count(*) FROM pg_inherits WHERE inhparent = root_oid) <> 3
        OR EXISTS (SELECT FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
                   WHERE i.inhparent = root_oid AND (c.relkind <> 'p' OR NOT c.relispartition
                   OR pg_get_expr(c.relpartbound, c.oid) NOT IN
                       ('FOR VALUES IN (1310)', 'FOR VALUES IN (1370)', 'FOR VALUES IN (1380)')))
    ) THEN
        RAISE EXCEPTION 'Company attachment/bounds mismatch for public.%', parent_name;
    END IF;
    IF EXISTS (SELECT FROM pg_partitioned_table WHERE partrelid IN (root_oid, parent_oid)
               AND partdefid <> 0) THEN
        RAISE EXCEPTION 'Unexpected DEFAULT partition under public.%', parent_name;
    END IF;
    FOR required_key IN
        SELECT CASE WHEN company = 'none' THEN ARRAY['company_code', 'item_type', 'item_code', 'uom', 'snapshot_date']
                    ELSE ARRAY['company_code', 'wms_id', date_key] END AS columns, false AS primary_key
        UNION ALL
        SELECT CASE WHEN company = 'none' THEN ARRAY['id', 'snapshot_date']
                    ELSE ARRAY['company_code', 'id', date_key] END, company = 'none'
        WHERE root_name <> 'wip_balances'
    LOOP
        IF NOT EXISTS (SELECT FROM pg_index i WHERE i.indrelid = root_oid AND i.indisunique
            AND i.indisvalid AND i.indisready AND i.indislive AND i.indpred IS NULL AND i.indexprs IS NULL
            AND (NOT required_key.primary_key OR i.indisprimary)
            AND ARRAY(SELECT a.attname::text FROM unnest(i.indkey) WITH ORDINALITY k(num, ord)
                JOIN pg_attribute a ON a.attrelid = root_oid AND a.attnum = k.num
                WHERE k.ord <= i.indnkeyatts ORDER BY k.ord) = required_key.columns) THEN
            RAISE EXCEPTION 'Missing expected root unique/primary key on public.%: %', root_name, required_key.columns;
        END IF;
    END LOOP;
    FOR y IN 2027..2030 LOOP
        FOR q IN 1..(CASE WHEN company = 'none' THEN 1 ELSE 4 END) LOOP
            lo := make_date(y, (q - 1) * 3 + 1, 1);
            hi := (lo + CASE WHEN company = 'none' THEN interval '1 year' ELSE interval '3 months' END)::date;
            leaf := parent_name || '_' || y || CASE WHEN company = 'none' THEN '' ELSE '_q' || q END;
            child_oid := to_regclass(format('public.%I', leaf));
            IF child_oid IS NULL THEN
                -- PostgreSQL rejects intersecting differently named bounds. No DEFAULT scan.
                EXECUTE format('CREATE TABLE public.%I PARTITION OF public.%I FOR VALUES FROM (%L) TO (%L)',
                               leaf, parent_name, lo, hi);
                child_oid := to_regclass(format('public.%I', leaf));
                made := made + 1;
            ELSE
                skipped := skipped + 1;
            END IF;
            IF NOT EXISTS (SELECT FROM pg_class WHERE oid = child_oid AND relkind = 'r'
                           AND relispartition AND relowner = owner_oid
                           AND pg_get_expr(relpartbound, oid) = format('FOR VALUES FROM (%L) TO (%L)', lo, hi))
                OR (SELECT count(*) FROM pg_inherits WHERE inhrelid = child_oid) <> 1
                OR NOT EXISTS (SELECT FROM pg_inherits WHERE inhrelid = child_oid AND inhparent = parent_oid) THEN
                RAISE EXCEPTION 'Conflicting object public.%: expected regular leaf of public.%, bounds [%, %), owner %',
                                leaf, parent_name, lo, hi, pg_get_userbyid(owner_oid);
            END IF;
        END LOOP;
    END LOOP;
    -- Verify indexes/constraints on BOTH levels, including already existing children.
    FOR link IN
        SELECT root_oid AS p, parent_oid AS c WHERE root_oid <> parent_oid
        UNION ALL
        SELECT parent_oid, i.inhrelid FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = parent_oid AND c.relname ~ '_20(27|28|29|30)(_q[1-4])?$'
    LOOP
        IF NOT EXISTS (SELECT FROM pg_index WHERE indrelid = link.p)
            OR EXISTS (SELECT FROM pg_index pi WHERE pi.indrelid = link.p AND (
                NOT pi.indisvalid OR NOT pi.indisready OR NOT pi.indislive OR NOT EXISTS (
                    SELECT FROM pg_inherits ii JOIN pg_index ci ON ci.indexrelid = ii.inhrelid
                    WHERE ii.inhparent = pi.indexrelid AND ci.indrelid = link.c
                      AND ci.indisvalid AND ci.indisready AND ci.indislive
                      AND ci.indisunique = pi.indisunique)))
            OR EXISTS (SELECT FROM pg_constraint pc WHERE pc.conrelid = link.p AND (pc.contype <> 'c' OR NOT pc.connoinherit)
                AND (NOT pc.convalidated OR NOT EXISTS (SELECT FROM pg_constraint cc
                    WHERE cc.conrelid = link.c AND cc.convalidated AND cc.contype = pc.contype
                      AND (cc.conparentid = pc.oid OR (cc.conname = pc.conname
                           AND pg_get_constraintdef(cc.oid) = pg_get_constraintdef(pc.oid))))))
            OR EXISTS (SELECT FROM pg_attribute pa WHERE pa.attrelid = link.p AND pa.attnum > 0
                AND NOT pa.attisdropped AND NOT EXISTS (SELECT FROM pg_attribute ca
                    WHERE ca.attrelid = link.c AND ca.attname = pa.attname AND NOT ca.attisdropped
                      AND ca.atttypid = pa.atttypid AND ca.atttypmod = pa.atttypmod
                      AND (NOT pa.attnotnull OR ca.attnotnull))) THEN
            RAISE EXCEPTION 'Index/constraint/column inheritance mismatch: % -> %; no repair attempted',
                            link.p::regclass, link.c::regclass;
        END IF;
    END LOOP;
    RAISE NOTICE 'public.%: created %, verified/skipped %', parent_name, made, skipped;
END;
$group$;
COMMIT;
$command$, '@ROOT@', quote_literal(:'root')), '@KEY@', quote_literal(:'date_key')),
    '@COMPANY@', quote_literal(:'company'))
\gexec
