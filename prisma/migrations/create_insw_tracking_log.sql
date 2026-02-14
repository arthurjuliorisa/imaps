-- ============================================================================
-- INSW Tracking Log Table
-- ============================================================================
-- Purpose: Track all INSW transmission attempts (success and failures)
-- Usage: Logging and monitoring for WMS → iMAPS → INSW flow
-- ============================================================================

CREATE TABLE IF NOT EXISTS insw_tracking_log (
  id BIGSERIAL PRIMARY KEY,

  -- Transaction reference
  transaction_type VARCHAR(20) NOT NULL,  -- 'incoming', 'outgoing', 'adjustment', 'stock_opname', 'saldo_awal'
  transaction_id INTEGER,                 -- ID from source table (incoming_goods.id, outgoing_goods.id, etc)
  wms_id VARCHAR(100),                    -- WMS ID for reference
  company_code INTEGER NOT NULL,

  -- INSW transmission details
  insw_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- 'PENDING', 'SENT', 'SUCCESS', 'FAILED', 'SKIPPED'
  insw_activity_code VARCHAR(10),        -- '30' (Pemasukan), '31' (Pengeluaran), '32' (Stock Opname), '33' (Adjustment)

  -- Request/Response data
  insw_request_payload JSONB,            -- Payload yang dikirim ke INSW
  insw_response JSONB,                   -- Response dari INSW API
  insw_error TEXT,                       -- Error message jika gagal

  -- Timing
  sent_at TIMESTAMPTZ,                   -- Waktu kirim ke INSW
  retry_count INTEGER DEFAULT 0,         -- Jumlah percobaan ulang

  -- Metadata
  metadata JSONB,                        -- Additional metadata (batch_id, user_id, etc)

  -- Audit
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_insw_tracking_transaction
  ON insw_tracking_log(transaction_type, transaction_id);

CREATE INDEX IF NOT EXISTS idx_insw_tracking_wms_id
  ON insw_tracking_log(wms_id, company_code);

CREATE INDEX IF NOT EXISTS idx_insw_tracking_status
  ON insw_tracking_log(insw_status, company_code);

CREATE INDEX IF NOT EXISTS idx_insw_tracking_company_date
  ON insw_tracking_log(company_code, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_insw_tracking_sent_at
  ON insw_tracking_log(sent_at DESC) WHERE sent_at IS NOT NULL;

-- Comments
COMMENT ON TABLE insw_tracking_log IS 'Logging table for INSW transmission tracking';
COMMENT ON COLUMN insw_tracking_log.transaction_type IS 'Type: incoming, outgoing, adjustment, stock_opname, saldo_awal';
COMMENT ON COLUMN insw_tracking_log.insw_status IS 'Status: PENDING, SENT, SUCCESS, FAILED, SKIPPED';
COMMENT ON COLUMN insw_tracking_log.insw_activity_code IS 'INSW activity code: 30 (Pemasukan), 31 (Pengeluaran), 32 (Stock Opname), 33 (Adjustment)';
COMMENT ON COLUMN insw_tracking_log.retry_count IS 'Number of retry attempts';

-- ============================================================================
-- Example Queries
-- ============================================================================

-- Get recent transmissions
-- SELECT * FROM insw_tracking_log
-- WHERE company_code = 1310
-- ORDER BY created_at DESC
-- LIMIT 100;

-- Get failed transmissions
-- SELECT id, transaction_type, transaction_id, wms_id, insw_error, retry_count
-- FROM insw_tracking_log
-- WHERE insw_status = 'FAILED'
--   AND company_code = 1310
-- ORDER BY sent_at DESC;

-- Get success rate by transaction type
-- SELECT
--   transaction_type,
--   COUNT(*) as total,
--   SUM(CASE WHEN insw_status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
--   SUM(CASE WHEN insw_status = 'FAILED' THEN 1 ELSE 0 END) as failed,
--   ROUND(100.0 * SUM(CASE WHEN insw_status = 'SUCCESS' THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
-- FROM insw_tracking_log
-- WHERE company_code = 1310
--   AND sent_at >= CURRENT_DATE - INTERVAL '7 days'
-- GROUP BY transaction_type;

-- Get transmission timeline (last 24 hours)
-- SELECT
--   DATE_TRUNC('hour', sent_at) as hour,
--   COUNT(*) as transmissions,
--   SUM(CASE WHEN insw_status = 'SUCCESS' THEN 1 ELSE 0 END) as success,
--   SUM(CASE WHEN insw_status = 'FAILED' THEN 1 ELSE 0 END) as failed
-- FROM insw_tracking_log
-- WHERE sent_at >= NOW() - INTERVAL '24 hours'
--   AND company_code = 1310
-- GROUP BY DATE_TRUNC('hour', sent_at)
-- ORDER BY hour DESC;
