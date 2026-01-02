CREATE OR REPLACE FUNCTION fn_calculate_lpj_barang_sisa(
    p_item_types TEXT[],
    p_start_date DATE DEFAULT NULL,
    p_end_date DATE DEFAULT NULL
)
RETURNS TABLE (
    no BIGINT,
    company_code INTEGER,
    company_name VARCHAR(200),
    item_code VARCHAR(50),
    item_name VARCHAR(200),
    item_type VARCHAR(10),
    unit_quantity VARCHAR(20),
    snapshot_date DATE,
    opening_balance NUMERIC(15,3),
    quantity_received NUMERIC(15,3),
    quantity_issued_outgoing NUMERIC(15,3),
    adjustment NUMERIC(15,3),
    closing_balance NUMERIC(15,3),
    stock_count_result NUMERIC(15,3),
    quantity_difference NUMERIC(15,3),
    value_amount NUMERIC(18,4),
    currency VARCHAR(3),
    remarks TEXT
) AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
BEGIN
    -- Default: if date range not provided, use start of year to today
    v_start_date := COALESCE(p_start_date, DATE_TRUNC('year', CURRENT_DATE)::DATE);
    v_end_date := COALESCE(p_end_date, CURRENT_DATE);
    
    -- Return scrap mutation data based on provided or default date range
    RETURN QUERY
        WITH opening_balance_from_snapshot AS (
            -- Get opening balance from snapshot BEFORE start_date
            SELECT
                sds_open.company_code,
                sds_open.item_code,
                sds_open.closing_balance as opening_balance,
                sds_open.uom,
                sds_open.item_name,
                sds_open.item_type
            FROM stock_daily_snapshot sds_open
            INNER JOIN (
                SELECT sds_subq.company_code, sds_subq.item_code, MAX(sds_subq.snapshot_date) as max_date
                FROM stock_daily_snapshot sds_subq
                WHERE sds_subq.snapshot_date < v_start_date
                  AND sds_subq.item_type = ANY(p_item_types)
                GROUP BY sds_subq.company_code, sds_subq.item_code
            ) sds_max ON sds_open.company_code = sds_max.company_code
              AND sds_open.item_code = sds_max.item_code
              AND sds_open.snapshot_date = sds_max.max_date
        ),
        scrap_transactions_in_range AS (
            -- Aggregate scrap transactions within date range
            SELECT
                sti.scrap_transaction_company as company_code,
                sti.item_code,
                sti.item_name,
                sti.item_type,
                sti.uom,
                st.transaction_type,
                CASE 
                    WHEN st.transaction_type = 'IN' THEN sti.qty
                    ELSE 0::NUMERIC
                END as incoming_qty,
                CASE 
                    WHEN st.transaction_type = 'OUT' THEN sti.qty
                    ELSE 0::NUMERIC
                END as outgoing_qty,
                sti.amount as value_amount,
                sti.currency
            FROM scrap_transaction_items sti
            JOIN scrap_transactions st ON 
                sti.scrap_transaction_company = st.company_code
                AND sti.scrap_transaction_id = st.id
                AND sti.scrap_transaction_date = st.transaction_date
            WHERE sti.item_type = ANY(p_item_types)
              AND st.transaction_date BETWEEN v_start_date AND v_end_date
              AND sti.deleted_at IS NULL
              AND st.deleted_at IS NULL
        ),
        aggregated_scrap AS (
            -- Aggregate transactions by item
            SELECT
                str.company_code,
                str.item_code,
                str.item_name,
                str.item_type,
                str.uom,
                SUM(str.incoming_qty) as total_incoming,
                SUM(str.outgoing_qty) as total_outgoing,
                SUM(str.value_amount) as total_value,
                MAX(str.currency) as currency
            FROM scrap_transactions_in_range str
            GROUP BY str.company_code, str.item_code, str.item_name, str.item_type, str.uom
        )
        SELECT
            ROW_NUMBER() OVER (PARTITION BY COALESCE(agg.company_code, obs.company_code) ORDER BY COALESCE(agg.item_code, obs.item_code)) as no,
            COALESCE(agg.company_code, obs.company_code) as company_code,
            c.name as company_name,
            COALESCE(agg.item_code, obs.item_code) as item_code,
            COALESCE(agg.item_name, obs.item_name) as item_name,
            COALESCE(agg.item_type, obs.item_type) as item_type,
            COALESCE(agg.uom, obs.uom) as unit_quantity,
            v_end_date::DATE as snapshot_date,
            COALESCE(obs.opening_balance, 0::NUMERIC) as opening_balance,
            COALESCE(agg.total_incoming, 0::NUMERIC) as quantity_received,
            COALESCE(agg.total_outgoing, 0::NUMERIC) as quantity_issued_outgoing,
            0::NUMERIC(15,3) as adjustment,
            COALESCE(obs.opening_balance, 0::NUMERIC) + COALESCE(agg.total_incoming, 0::NUMERIC) - COALESCE(agg.total_outgoing, 0::NUMERIC) as closing_balance,
            NULL::NUMERIC(15,3) as stock_count_result,
            NULL::NUMERIC(15,3) as quantity_difference,
            COALESCE(agg.total_value, 0::NUMERIC) as value_amount,
            agg.currency,
            ('SCRAP MUTATION: ACCUMULATED FROM ' || v_start_date::TEXT || ' TO ' || v_end_date::TEXT) as remarks
        FROM aggregated_scrap agg
        FULL OUTER JOIN opening_balance_from_snapshot obs ON 
            agg.company_code = obs.company_code
            AND agg.item_code = obs.item_code
        JOIN companies c ON COALESCE(agg.company_code, obs.company_code) = c.code
        ORDER BY COALESCE(agg.item_code, obs.item_code);
END;
$$ LANGUAGE plpgsql STABLE;

COMMENT ON FUNCTION fn_calculate_lpj_barang_sisa IS 'Calculate LPJ for scrap/waste (independent scrap transactions only)';
