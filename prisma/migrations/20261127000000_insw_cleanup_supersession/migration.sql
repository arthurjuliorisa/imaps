BEGIN;
-- Separate DELETE authorization from the unchanged normal UPDATE/dispatch guard.
-- No constraint, queue immutability or supersession admission rule is relaxed.
CREATE FUNCTION insw_guard_cleanup_supersession_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE target_company integer;
BEGIN
  target_company := nullif(current_setting('imaps.cleanup_company', true), '')::integer;
  IF target_company IS NULL OR NOT EXISTS (
    SELECT 1 FROM users u JOIN companies c ON c.code = u.company_code
    WHERE u.id = current_setting('imaps.cleanup_operator', true)
      AND u.role = 'ADMIN' AND u.is_active AND u.deleted_at IS NULL
      AND c.code = target_company AND c.status = 'ACTIVE' AND c.deleted_at IS NULL
  ) THEN RAISE EXCEPTION 'INSW supersession audit is immutable outside authorized company Cleanup'; END IF;

  -- The caller must already hold the same writer fence used by Cleanup.
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['insw_dispatch_gate', 'insw_queue_cycle',
      'insw_queue_attempt', 'insw_tracking_log', 'insw_manual_supersession']) AS required(tbl)
    WHERE NOT EXISTS (SELECT 1 FROM pg_locks k
      WHERE k.pid = pg_backend_pid() AND k.locktype = 'relation' AND k.granted
        AND k.relation = to_regclass(required.tbl) AND k.mode = 'ShareRowExclusiveLock')
  ) THEN RAISE EXCEPTION 'INSW Cleanup writer locks required'; END IF;
  PERFORM id FROM insw_dispatch_gate WHERE id = 1 AND owner_token IS NULL
    AND lease_until IS NULL AND process_identity IS NULL AND busy_attempt_id IS NULL
    FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'INSW Cleanup requires an idle dispatch gate'; END IF;

  -- Transition table validates the batch once, including both ends of a chain.
  IF EXISTS (
    SELECT 1 FROM removed_supersessions r
    LEFT JOIN insw_queue_cycle p ON p.id = r.parent_queue_id
    LEFT JOIN insw_queue_cycle s ON s.id = r.successor_queue_id
    LEFT JOIN insw_tracking_log l ON l.id = r.source_log_id
    WHERE p.company_code IS DISTINCT FROM target_company
      OR s.company_code IS DISTINCT FROM target_company
      OR l.company_code IS DISTINCT FROM target_company
      OR p.operation IS DISTINCT FROM s.operation
      OR p.identity_key IS DISTINCT FROM s.identity_key
  ) THEN RAISE EXCEPTION 'INSW Cleanup supersession scope conflict'; END IF;
  RETURN NULL;
END $$;
DROP TRIGGER insw_guard_supersession_audit ON insw_manual_supersession;
CREATE TRIGGER insw_guard_supersession_audit BEFORE UPDATE ON insw_manual_supersession
  FOR EACH ROW EXECUTE FUNCTION insw_guard_supersession();
CREATE TRIGGER insw_guard_supersession_cleanup AFTER DELETE ON insw_manual_supersession
  REFERENCING OLD TABLE AS removed_supersessions
  FOR EACH STATEMENT EXECUTE FUNCTION insw_guard_cleanup_supersession_delete();
COMMIT;
