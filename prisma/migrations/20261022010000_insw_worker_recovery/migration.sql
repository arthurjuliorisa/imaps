-- Additive, inactive worker infrastructure. No policy/default/history rewrites.
ALTER TABLE insw_dispatch_gate
  ADD COLUMN prior_interval_ms integer CHECK (prior_interval_ms > 0),
  ADD COLUMN recovery_barrier_at timestamptz(6),
  ADD COLUMN busy_attempt_id uuid REFERENCES insw_queue_attempt(id) ON DELETE RESTRICT,
  ADD COLUMN process_identity jsonb;
CREATE TABLE insw_worker_recovery (
  id uuid PRIMARY KEY,
  old_owner_token uuid NOT NULL,
  operator varchar(100) NOT NULL,
  evidence varchar(500) NOT NULL,
  process_identity jsonb NOT NULL,
  recovered_at timestamptz(6) NOT NULL DEFAULT clock_timestamp()
);
