BEGIN;
-- Shared projection/admission/preflight policy. Ownership is sticky, not a
-- liveness assertion: never infer quiescence from an expired lease. A preflight
-- may exclude only its already-admitted successor from the target busy fence.
CREATE FUNCTION insw_manual_enqueue_gate_safe(target_identity text, self_successor uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM insw_dispatch_gate g WHERE g.id = 1
      AND ((g.last_started_at IS NULL AND g.prior_interval_ms IS NULL AND g.recovery_barrier_at IS NULL)
        OR (g.last_started_at IS NOT NULL AND g.prior_interval_ms >= 3600))
      AND ((g.owner_token IS NULL AND g.lease_until IS NULL AND g.process_identity IS NULL AND g.busy_attempt_id IS NULL)
        OR (g.owner_token IS NOT NULL AND g.lease_until IS NOT NULL
          AND jsonb_typeof(g.process_identity) = 'object'
          AND jsonb_typeof(g.process_identity->'host') = 'string'
          AND jsonb_typeof(g.process_identity->'machine') = 'string'
          AND jsonb_typeof(g.process_identity->'boot') = 'string'
          AND jsonb_typeof(g.process_identity->'start') = 'string'
          AND jsonb_typeof(g.process_identity->'pidNamespace') = 'string'
          AND g.process_identity->>'host' <> '' AND g.process_identity->>'machine' <> ''
          AND g.process_identity->>'boot' <> '' AND g.process_identity->>'start' <> ''
          AND g.process_identity->>'pidNamespace' <> ''
          AND jsonb_typeof(g.process_identity->'pid') = 'number' AND g.process_identity->>'pid' ~ '^[1-9][0-9]*$'
          AND jsonb_typeof(g.process_identity->'uid') = 'number' AND g.process_identity->>'uid' ~ '^[0-9]+$'
          AND (g.busy_attempt_id IS NULL OR EXISTS (
            SELECT 1 FROM insw_queue_attempt a JOIN insw_queue_cycle q ON q.id = a.queue_id
            WHERE a.id = g.busy_attempt_id AND a.owner_token = g.owner_token
              AND a.completed_at IS NULL AND a.retry_index = q.retry_index
              AND (q.identity_key <> target_identity OR q.id = self_successor)
              AND ((q.status IN ('CLAIMED', 'REMOTE_SUCCEEDED') AND q.owner_token = g.owner_token AND q.lease_until IS NOT NULL)
                OR (q.status = 'HELD' AND q.owner_token IS NULL AND q.lease_until IS NULL
                  AND q.delivery_state = 'KNOWN_SUCCESS' AND q.hold_reason = 'LOCAL_FINALIZATION_REQUIRED'))))))
  );
$$;

-- BEFORE ROW triggers run after the executor takes the target tuple lock.
-- Fence status statements BEFORE that lock, including direct SQL callers.
-- NOWAIT prevents inversion for callers that already hold other locks; normal
-- admission/worker callers already hold this same gate and reacquire it safely.
CREATE FUNCTION insw_lock_status_gate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM insw_dispatch_gate WHERE id = 1 FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSW dispatch gate required'; END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER insw_status_gate BEFORE UPDATE OF status ON insw_queue_cycle
  FOR EACH STATEMENT EXECUTE FUNCTION insw_lock_status_gate();

CREATE OR REPLACE FUNCTION insw_guard_supersession() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE reference_key text;
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
    -- History predicates must see commits preceding the gate/reference fence.
    -- Higher isolation can retain an older snapshot even after lock acquisition.
    IF current_setting('transaction_isolation') <> 'read committed' THEN
      RAISE EXCEPTION 'INSW supersession requires READ COMMITTED revalidation';
    END IF;
    -- Also covers UPDATE statements whose SET list omits status but another
    -- trigger changes it. Never wait for a gate after acquiring a cycle tuple.
    PERFORM id FROM insw_dispatch_gate WHERE id = 1 FOR UPDATE NOWAIT;
    IF NOT FOUND THEN RAISE EXCEPTION 'INSW dispatch gate required'; END IF;
    IF OLD.wms_reference IS NULL THEN RAISE EXCEPTION 'INSW stable reference required'; END IF;
    -- Match JSON.stringify's compact array key exactly, including JSON escaping.
    reference_key := '["insw-source-reference",' || OLD.company_code::text || ','
      || to_json(OLD.operation::text)::text || ',' || to_json(OLD.wms_reference)::text || ']';
    -- Producers can hold reference locks without the gate. Nonblocking locks
    -- fail closed rather than invert reference/identity -> tuple lock ordering.
    IF NOT pg_try_advisory_xact_lock(hashtextextended(reference_key, 0)) THEN
      RAISE EXCEPTION 'INSW supersession reference busy';
    END IF;
    IF NOT pg_try_advisory_xact_lock(hashtextextended(OLD.identity_key, 0)) THEN
      RAISE EXCEPTION 'INSW supersession identity busy';
    END IF;
    IF OLD.status <> 'HELD' OR OLD.owner_token IS NOT NULL OR OLD.lease_until IS NOT NULL
       OR OLD.delivery_state = 'KNOWN_SUCCESS'
       OR (to_jsonb(NEW) - 'status' - 'completed_at') IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'completed_at')
       OR NOT insw_manual_enqueue_gate_safe(OLD.identity_key, NULL)
       OR EXISTS (SELECT 1 FROM insw_queue_cycle q WHERE q.identity_key = OLD.identity_key
         AND (q.delivery_state = 'KNOWN_SUCCESS' OR q.status IN ('SUCCEEDED', 'REMOTE_SUCCEEDED')
           OR q.owner_token IS NOT NULL OR q.lease_until IS NOT NULL
           OR q.cycle > OLD.cycle OR (q.id <> OLD.id AND q.status IN ('READY', 'CLAIMED', 'HELD'))))
       OR EXISTS (SELECT 1 FROM insw_queue_attempt a JOIN insw_queue_cycle q ON q.id = a.queue_id
         WHERE q.identity_key = OLD.identity_key AND (a.completed_at IS NULL OR a.delivery_state = 'KNOWN_SUCCESS'))
       OR EXISTS (SELECT 1 FROM insw_dispatch_gate g JOIN insw_queue_attempt a ON a.id = g.busy_attempt_id
         JOIN insw_queue_cycle q ON q.id = a.queue_id WHERE q.identity_key = OLD.identity_key) THEN
      RAISE EXCEPTION 'INSW supersession requires unchanged evidence and local inactivity';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- Existing deferred linkage/audit immutability, FK/checks and active identity
-- uniqueness are retained. No ownership, pacing, history or grant changes.
COMMIT;
