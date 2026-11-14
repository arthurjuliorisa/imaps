-- NOT RUN by default. Only after separate authorization and external target
-- verification; see the corrective implementation report. No sender is invoked.
-- psql -X -v ON_ERROR_STOP=1 -v expected_data_directory=... -v expected_role=... \
--   -v expected_port=... "$TASK_DATABASE_URL" -f __tests__/sql/insw-manual-supersession.sql
BEGIN;
SELECT set_config('insw_test.expected_directory', :'expected_data_directory', true),
       set_config('insw_test.expected_role', :'expected_role', true),
       set_config('insw_test.expected_port', :'expected_port', true);
DO $$
BEGIN
  IF current_database() !~ '_insw_supersession_test$'
    OR current_user <> current_setting('insw_test.expected_role')
    OR current_setting('data_directory') <> current_setting('insw_test.expected_directory')
    OR inet_server_port()::text IS DISTINCT FROM current_setting('insw_test.expected_port')
    OR host(inet_server_addr()) NOT IN ('127.0.0.1', '::1') THEN
    RAISE EXCEPTION 'Isolated supersession target identity mismatch';
  END IF;
END $$;
-- Serialize with the actual gate, never clear an owner or change pacing state.
SELECT id FROM insw_dispatch_gate WHERE id = 1 FOR UPDATE;
DO $$
DECLARE
  p uuid := gen_random_uuid(); s uuid := gen_random_uuid(); a uuid := gen_random_uuid();
  worker_token uuid := gen_random_uuid(); unrelated uuid := gen_random_uuid(); busy uuid := gen_random_uuid();
  saved_gate jsonb;
  log_id bigint; identity text := 'supersession-ddl-fixture:' || p::text;
  frozen jsonb := '{"data":[{"kdKegiatan":"30","dokumenKegiatan":[{"nomorDokKegiatan":"DDL-ONLY","barangTransaksi":[{"kdBarang":"ITEM"}]}]}]}';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM insw_dispatch_gate WHERE id = 1 AND owner_token IS NULL
    AND lease_until IS NULL AND busy_attempt_id IS NULL AND process_identity IS NULL) THEN
    RAISE EXCEPTION 'Isolated test gate must already be inactive';
  END IF;
  INSERT INTO insw_queue_cycle(id,company_code,operation,identity_key,source_revision,business_date,
    wms_reference,cycle,intent,requested_by,frozen_payload,payload_sha256,max_auto_retry_snapshot,
    status,delivery_state,hold_reason)
    VALUES(p,1370,'INCOMING',identity,'ACCEPTED_WMS_ID','2026-11-13','DDL-ONLY',1,'SOURCE_COMMIT',
      'ddl-test',frozen,repeat('a',64),0,'HELD','POSSIBLY_STARTED','DELIVERY_UNKNOWN');
  INSERT INTO insw_queue_attempt(id,queue_id,retry_index,owner_token,delivery_state,completed_at)
    VALUES(a,p,0,gen_random_uuid(),'POSSIBLY_STARTED',clock_timestamp());
  INSERT INTO insw_tracking_log(queue_attempt_id,transaction_type,company_code,wms_id,insw_status,
    insw_request_payload,metadata,updated_at) VALUES(a,'incoming',1370,'DDL-ONLY','FAILED',frozen,
    '{"classification":"UNKNOWN","reasonCode":"MALFORMED_RESPONSE","responseEvidence":"COMPLETE"}',clock_timestamp())
    RETURNING id INTO log_id;
  -- Forward-policy fixture: these predicates/locks require physical PostgreSQL.
  -- This script remains authorization gated and always rolls back.
  IF NOT insw_manual_enqueue_gate_safe(identity, NULL) THEN RAISE EXCEPTION 'Inactive gate rejected'; END IF;
  UPDATE insw_dispatch_gate SET owner_token=worker_token, lease_until=clock_timestamp(), process_identity=NULL WHERE id=1;
  IF insw_manual_enqueue_gate_safe(identity, NULL) THEN RAISE EXCEPTION 'Corrupt owner admitted'; END IF;
  UPDATE insw_dispatch_gate SET process_identity=jsonb_build_object('host','fixture','machine','fixture',
    'boot','fixture','start','1','pidNamespace','fixture','pid',1,'uid',1000) WHERE id=1;
  IF NOT insw_manual_enqueue_gate_safe(identity, NULL) THEN RAISE EXCEPTION 'Idle sticky owner rejected'; END IF;
  -- A completed attempt still marked busy for this identity must block.
  UPDATE insw_queue_attempt SET owner_token=worker_token WHERE id=a;
  UPDATE insw_dispatch_gate SET busy_attempt_id=a WHERE id=1;
  IF insw_manual_enqueue_gate_safe(identity, NULL) THEN RAISE EXCEPTION 'Target busy admitted'; END IF;
  BEGIN
    UPDATE insw_queue_cycle SET status='SUPERSEDED', completed_at=clock_timestamp() WHERE id=p;
    RAISE EXCEPTION 'Expected target-busy rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INSW supersession requires unchanged evidence and local inactivity' THEN RAISE; END IF;
  END;
  UPDATE insw_dispatch_gate SET busy_attempt_id=NULL WHERE id=1;
  UPDATE insw_queue_attempt SET completed_at=NULL WHERE id=a;
  BEGIN
    UPDATE insw_queue_cycle SET status='SUPERSEDED', completed_at=clock_timestamp() WHERE id=p;
    RAISE EXCEPTION 'Expected unfinished-target rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INSW supersession requires unchanged evidence and local inactivity' THEN RAISE; END IF;
  END;
  UPDATE insw_queue_attempt SET completed_at=clock_timestamp() WHERE id=a;
  INSERT INTO insw_queue_cycle(id,company_code,operation,identity_key,source_revision,business_date,
    wms_reference,cycle,intent,requested_by,frozen_payload,payload_sha256,max_auto_retry_snapshot,
    status,owner_token,lease_until)
    VALUES(unrelated,1370,'INCOMING',identity || ':unrelated','ACCEPTED_WMS_ID','2026-11-13','OTHER',1,
      'SOURCE_COMMIT','ddl-test',frozen,repeat('a',64),0,'CLAIMED',worker_token,clock_timestamp());
  INSERT INTO insw_queue_attempt(id,queue_id,retry_index,owner_token)
    VALUES(busy,unrelated,0,worker_token);
  UPDATE insw_dispatch_gate SET busy_attempt_id=busy WHERE id=1;
  IF NOT insw_manual_enqueue_gate_safe(identity, NULL) THEN RAISE EXCEPTION 'Unrelated busy rejected'; END IF;
  IF insw_manual_enqueue_gate_safe(identity || ':unrelated', NULL) THEN RAISE EXCEPTION 'Same busy identity admitted'; END IF;
  IF NOT insw_manual_enqueue_gate_safe(identity || ':unrelated', unrelated) THEN RAISE EXCEPTION 'Self preflight rejected'; END IF;
  SELECT to_jsonb(g) INTO saved_gate FROM insw_dispatch_gate g WHERE id=1;
  -- HELD continues to occupy the unique active identity, even after attempt end.
  BEGIN
    INSERT INTO insw_queue_cycle(id,company_code,operation,identity_key,source_revision,business_date,
      cycle,intent,requested_by,frozen_payload,payload_sha256,max_auto_retry_snapshot)
      VALUES(s,1370,'INCOMING',identity,'ACCEPTED_WMS_ID','2026-11-13',2,'MANUAL_RESUBMIT',
        'ddl-test',frozen,repeat('a',64),0);
    RAISE EXCEPTION 'Expected active identity uniqueness violation';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  -- Simulate a failure before successor/audit. Subtransaction rolls retirement back.
  BEGIN
    UPDATE insw_queue_cycle SET status='SUPERSEDED', completed_at=clock_timestamp() WHERE id=p;
    SET CONSTRAINTS insw_superseded_link IMMEDIATE;
    RAISE EXCEPTION 'Expected missing-link rejection';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INSW supersession requires an atomic linked successor and operator audit' THEN RAISE; END IF;
  END;
  IF (SELECT status FROM insw_queue_cycle WHERE id=p) <> 'HELD' THEN RAISE EXCEPTION 'Parent retirement did not roll back'; END IF;
  UPDATE insw_queue_cycle SET status='SUPERSEDED', completed_at=clock_timestamp() WHERE id=p;
  INSERT INTO insw_queue_cycle(id,company_code,operation,identity_key,source_revision,business_date,
    wms_reference,cycle,intent,requested_by,source_log_id,frozen_payload,payload_sha256,max_auto_retry_snapshot)
    SELECT s,company_code,operation,identity_key,source_revision,business_date,wms_reference,2,
      'MANUAL_RESUBMIT','ddl-test',log_id,frozen_payload,payload_sha256,0 FROM insw_queue_cycle WHERE id=p;
  INSERT INTO insw_manual_supersession(parent_queue_id,successor_queue_id,source_log_id,operator,reason,commitment)
    VALUES(p,s,log_id,'ddl-test','Reviewed local evidence and accepted duplicate risk',true);
  UPDATE insw_tracking_log SET metadata = metadata || jsonb_build_object('manual_resend',
    jsonb_build_object('queue_id',s,'prior_queue_id',p,'commitment',true)) WHERE id=log_id;
  SET CONSTRAINTS ALL IMMEDIATE;
  IF (SELECT delivery_state FROM insw_queue_cycle WHERE id=p) <> 'POSSIBLY_STARTED'
    OR (SELECT hold_reason FROM insw_queue_cycle WHERE id=p) <> 'DELIVERY_UNKNOWN'
    OR (SELECT count(*) FROM insw_queue_cycle WHERE identity_key=identity AND status IN ('READY','CLAIMED','REMOTE_SUCCEEDED','HELD')) <> 1
    OR (SELECT count(*) FROM insw_queue_attempt WHERE queue_id=p) <> 1 THEN
    RAISE EXCEPTION 'Supersession erased evidence or violated active uniqueness';
  END IF;
  BEGIN
    UPDATE insw_queue_cycle SET status='READY',completed_at=NULL,hold_reason=NULL,delivery_state='NOT_STARTED' WHERE id=p;
    RAISE EXCEPTION 'Expected retired-cycle immutability';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INSW superseded cycle is immutable and cannot dispatch' THEN RAISE; END IF;
  END;
  IF (SELECT to_jsonb(g) FROM insw_dispatch_gate g WHERE id=1) IS DISTINCT FROM saved_gate THEN
    RAISE EXCEPTION 'Enqueue changed global ownership/busy/pacing evidence';
  END IF;
  BEGIN
    UPDATE insw_manual_supersession SET reason='changed' WHERE parent_queue_id=p;
    RAISE EXCEPTION 'Expected immutable audit';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'INSW supersession audit is immutable' THEN RAISE; END IF;
  END;
END $$;
-- Always retain the external psql evidence, but never persist these DDL fixtures.
ROLLBACK;
