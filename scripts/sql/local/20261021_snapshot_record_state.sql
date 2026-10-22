-- Read-only row counts/hashes; includes soft-deleted rows and all dates.
-- Run only on the confirmed local clone, with other writers stopped.
WITH company_rows AS (
    SELECT company_code, 'beginning_balances' AS relation, to_jsonb(b)::text AS row_data
    FROM public.beginning_balances b WHERE company_code IN (1310, 1370)
    UNION ALL
    SELECT company_code, 'stock_daily_snapshot', to_jsonb(s)::text
    FROM public.stock_daily_snapshot s WHERE company_code IN (1310, 1370)
    UNION ALL
    SELECT b.company_code, 'beginning_balance_ppkeks', to_jsonb(p)::text
    FROM public.beginning_balance_ppkeks p
    JOIN public.beginning_balances b ON b.id = p.beginning_balance_id
    WHERE b.company_code IN (1310, 1370)
), groups AS (
    SELECT c.company_code, t.relation, count(r.row_data) AS row_count,
           md5(COALESCE(string_agg(r.row_data, E'\n' ORDER BY r.row_data COLLATE "C"), '')) AS hash
    FROM (VALUES (1310), (1370)) c(company_code)
    CROSS JOIN (VALUES ('beginning_balances'), ('stock_daily_snapshot'), ('beginning_balance_ppkeks')) t(relation)
    LEFT JOIN company_rows r USING (company_code, relation)
    GROUP BY c.company_code, t.relation
)
SELECT jsonb_agg(to_jsonb(g) ORDER BY company_code, relation) AS state FROM groups g;
