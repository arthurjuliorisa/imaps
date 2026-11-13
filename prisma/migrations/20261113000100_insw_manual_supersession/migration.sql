BEGIN;
-- SUPERSEDED is administrative completion, never delivery success or failure.
-- The existing active-identity index already excludes this new status; HELD
-- remains in that index. No index relaxation or historical conversion is needed.
ALTER TABLE insw_queue_cycle DROP CONSTRAINT insw_cycle_hold,
  DROP CONSTRAINT insw_cycle_completion;
ALTER TABLE insw_queue_cycle
  ADD CONSTRAINT insw_cycle_hold CHECK ((status IN ('HELD', 'SUPERSEDED')) = (hold_reason IS NOT NULL)),
  ADD CONSTRAINT insw_cycle_completion CHECK ((status IN ('SUCCEEDED', 'FAILED', 'SUPERSEDED')) = (completed_at IS NOT NULL)),
  ADD CONSTRAINT insw_superseded_uncertain CHECK (status <> 'SUPERSEDED' OR delivery_state <> 'KNOWN_SUCCESS');

CREATE TABLE insw_manual_supersession (
  parent_queue_id uuid PRIMARY KEY REFERENCES insw_queue_cycle(id) ON DELETE RESTRICT,
  successor_queue_id uuid NOT NULL UNIQUE REFERENCES insw_queue_cycle(id) ON DELETE RESTRICT,
  source_log_id bigint NOT NULL UNIQUE REFERENCES insw_tracking_log(id) ON DELETE RESTRICT,
  operator varchar(100) NOT NULL CHECK (length(btrim(operator)) BETWEEN 1 AND 100),
  reason varchar(500) NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500 AND reason !~ '[[:cntrl:]]'),
  commitment boolean NOT NULL CHECK (commitment),
  authorized_at timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  CHECK (parent_queue_id <> successor_queue_id)
);

CREATE FUNCTION insw_guard_supersession() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'insw_manual_supersession' THEN
    RAISE EXCEPTION 'INSW supersession audit is immutable';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'SUPERSEDED' THEN RAISE EXCEPTION 'INSW supersession must retire an existing HELD cycle'; END IF;
    RETURN NEW;
  END IF;
  IF OLD.status = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'INSW superseded cycle is immutable and cannot dispatch';
  END IF;
  IF NEW.status = 'SUPERSEDED' THEN
    IF OLD.status <> 'HELD' OR OLD.owner_token IS NOT NULL OR OLD.lease_until IS NOT NULL
       OR OLD.delivery_state = 'KNOWN_SUCCESS'
       OR (to_jsonb(NEW) - 'status' - 'completed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'completed_at')
       OR EXISTS (SELECT 1 FROM insw_queue_attempt a WHERE a.queue_id = OLD.id
         AND (a.completed_at IS NULL OR a.delivery_state = 'KNOWN_SUCCESS'))
       OR NOT EXISTS (SELECT 1 FROM insw_dispatch_gate g WHERE g.id = 1
         AND g.owner_token IS NULL AND g.lease_until IS NULL AND g.busy_attempt_id IS NULL AND g.process_identity IS NULL) THEN
      RAISE EXCEPTION 'INSW supersession requires unchanged evidence and local inactivity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER insw_guard_superseded_cycle BEFORE INSERT OR UPDATE ON insw_queue_cycle
  FOR EACH ROW EXECUTE FUNCTION insw_guard_supersession();
CREATE TRIGGER insw_guard_supersession_audit BEFORE UPDATE OR DELETE ON insw_manual_supersession
  FOR EACH ROW EXECUTE FUNCTION insw_guard_supersession();

-- Deferred until commit: retirement must never survive without its exact
-- successor and operator audit, including a failure between any two statements.
CREATE FUNCTION insw_check_supersession_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'insw_queue_cycle' THEN
    IF NEW.status <> 'SUPERSEDED' THEN RETURN NULL; END IF;
    parent_id := NEW.id;
  ELSE
    parent_id := NEW.parent_queue_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM insw_manual_supersession r
    JOIN insw_queue_cycle p ON p.id = r.parent_queue_id
    JOIN insw_queue_cycle s ON s.id = r.successor_queue_id
    JOIN insw_tracking_log l ON l.id = r.source_log_id
    JOIN insw_queue_attempt a ON a.id = l.queue_attempt_id
    WHERE p.id = parent_id AND p.status = 'SUPERSEDED' AND r.commitment
      AND s.identity_key = p.identity_key AND s.company_code = p.company_code
      AND s.operation = p.operation AND s.cycle = p.cycle + 1 AND s.intent = 'MANUAL_RESUBMIT'
      AND s.status = 'READY' AND s.delivery_state = 'NOT_STARTED' AND s.owner_token IS NULL AND s.lease_until IS NULL
      AND s.source_log_id = l.id AND s.requested_by = r.operator
      AND s.frozen_payload = p.frozen_payload AND s.payload_sha256 = p.payload_sha256
      AND a.queue_id = p.id AND a.completed_at IS NOT NULL AND a.retry_index = p.retry_index
      AND l.company_code = p.company_code AND l.transaction_type = lower(p.operation::text)
      AND l.insw_status = 'FAILED' AND l.insw_request_payload = p.frozen_payload
      AND l.metadata#>>'{manual_resend,queue_id}' = s.id::text
      AND l.metadata#>>'{manual_resend,prior_queue_id}' = p.id::text
      AND l.metadata#>'{manual_resend,commitment}' = 'true'::jsonb
  ) THEN RAISE EXCEPTION 'INSW supersession requires an atomic linked successor and operator audit'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER insw_superseded_link AFTER INSERT OR UPDATE ON insw_queue_cycle
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION insw_check_supersession_link();
CREATE CONSTRAINT TRIGGER insw_supersession_link AFTER INSERT ON insw_manual_supersession
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION insw_check_supersession_link();
COMMIT;
