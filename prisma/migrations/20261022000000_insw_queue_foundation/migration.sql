-- CreateEnum
CREATE TYPE "InswQueueOperation" AS ENUM ('INCOMING', 'OUTGOING', 'MATERIAL_USAGE', 'PRODUCTION_OUTPUT', 'ADJUSTMENT', 'STOCK_OPNAME', 'CAPITAL_OUTGOING', 'SCRAP_INCOMING', 'SCRAP_OUTGOING', 'SALDO_AWAL', 'FINAL_REGISTRATION');

-- CreateEnum
CREATE TYPE "InswQueueStatus" AS ENUM ('READY', 'CLAIMED', 'REMOTE_SUCCEEDED', 'HELD', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "InswDeliveryState" AS ENUM ('NOT_STARTED', 'POSSIBLY_STARTED', 'KNOWN_SUCCESS', 'KNOWN_FAILURE');

-- CreateEnum
CREATE TYPE "InswHoldReason" AS ENUM ('PRE_SEND_LEASE_EXPIRED', 'DELIVERY_UNKNOWN', 'LOCAL_FINALIZATION_REQUIRED', 'ENDPOINT_DISABLED');

-- AlterTable
ALTER TABLE "insw_tracking_log" ADD COLUMN     "queue_attempt_id" UUID;

-- CreateTable
CREATE TABLE "insw_transmission_policy" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "min_processing_interval_ms" INTEGER NOT NULL DEFAULT 3600,
    "max_auto_retry" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" VARCHAR(100) NOT NULL,
    "change_reason" VARCHAR(500) NOT NULL,

    CONSTRAINT "insw_transmission_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_policy_change" (
    "version" INTEGER NOT NULL,
    "min_processing_interval_ms" INTEGER NOT NULL,
    "max_auto_retry" INTEGER NOT NULL,
    "changed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" VARCHAR(100) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,

    CONSTRAINT "insw_policy_change_pkey" PRIMARY KEY ("version")
);

-- CreateTable
CREATE TABLE "insw_dispatch_gate" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "last_started_at" TIMESTAMPTZ(6),
    "owner_token" UUID,
    "lease_until" TIMESTAMPTZ(6),

    CONSTRAINT "insw_dispatch_gate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_queue_cycle" (
    "id" UUID NOT NULL,
    "company_code" INTEGER NOT NULL,
    "operation" "InswQueueOperation" NOT NULL,
    "identity_key" VARCHAR(2000) NOT NULL,
    "source_revision" VARCHAR(200) NOT NULL,
    "business_date" VARCHAR(10) NOT NULL,
    "wms_reference" VARCHAR(100),
    "cycle" INTEGER NOT NULL,
    "intent" VARCHAR(30) NOT NULL,
    "requested_by" VARCHAR(100) NOT NULL,
    "source_log_id" BIGINT,
    "frozen_payload" JSONB NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "status" "InswQueueStatus" NOT NULL DEFAULT 'READY',
    "retry_index" INTEGER NOT NULL DEFAULT 0,
    "max_auto_retry_snapshot" INTEGER NOT NULL,
    "tail_key" BIGSERIAL NOT NULL,
    "queued_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "next_eligible_at" TIMESTAMPTZ(6) NOT NULL DEFAULT clock_timestamp(),
    "claimed_at" TIMESTAMPTZ(6),
    "last_attempt_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "owner_token" UUID,
    "lease_until" TIMESTAMPTZ(6),
    "delivery_state" "InswDeliveryState" NOT NULL DEFAULT 'NOT_STARTED',
    "hold_reason" "InswHoldReason",
    "error_category" VARCHAR(50),
    "error_code" VARCHAR(100),
    "error_message" VARCHAR(500),

    CONSTRAINT "insw_queue_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_queue_attempt" (
    "id" UUID NOT NULL,
    "queue_id" UUID NOT NULL,
    "retry_index" INTEGER NOT NULL,
    "owner_token" UUID NOT NULL,
    "claimed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "delivery_state" "InswDeliveryState" NOT NULL DEFAULT 'NOT_STARTED',

    CONSTRAINT "insw_queue_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "insw_queue_cycle_status_next_eligible_at_tail_key_idx" ON "insw_queue_cycle"("status", "next_eligible_at", "tail_key");

-- CreateIndex
CREATE INDEX "insw_queue_cycle_status_lease_until_idx" ON "insw_queue_cycle"("status", "lease_until");

-- CreateIndex
CREATE INDEX "insw_queue_cycle_company_code_queued_at_idx" ON "insw_queue_cycle"("company_code", "queued_at");

-- CreateIndex
CREATE UNIQUE INDEX "insw_queue_cycle_identity_key_cycle_key" ON "insw_queue_cycle"("identity_key", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "insw_queue_attempt_queue_id_retry_index_key" ON "insw_queue_attempt"("queue_id", "retry_index");

-- CreateIndex
CREATE INDEX "insw_tracking_log_queue_attempt_id_idx" ON "insw_tracking_log"("queue_attempt_id");

-- AddForeignKey
ALTER TABLE "insw_tracking_log" ADD CONSTRAINT "insw_tracking_log_queue_attempt_id_fkey" FOREIGN KEY ("queue_attempt_id") REFERENCES "insw_queue_attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insw_queue_attempt" ADD CONSTRAINT "insw_queue_attempt_queue_id_fkey" FOREIGN KEY ("queue_id") REFERENCES "insw_queue_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Policy is global, fail-closed at read, with positive interval and retry-after-initial semantics.
ALTER TABLE "insw_transmission_policy"
  ADD CONSTRAINT "insw_policy_singleton" CHECK (id = 1),
  ADD CONSTRAINT "insw_policy_bounds" CHECK (
    min_processing_interval_ms BETWEEN 1 AND 2147483647 AND
    max_auto_retry BETWEEN 0 AND 2147483646 AND version > 0);
ALTER TABLE "insw_dispatch_gate" ADD CONSTRAINT "insw_gate_singleton" CHECK (id = 1),
  ADD CONSTRAINT "insw_gate_owner_pair" CHECK ((owner_token IS NULL) = (lease_until IS NULL));
ALTER TABLE "insw_queue_cycle"
  ADD CONSTRAINT "insw_cycle_bounds" CHECK (cycle > 0 AND retry_index >= 0 AND
    max_auto_retry_snapshot BETWEEN 0 AND 2147483646 AND retry_index <= max_auto_retry_snapshot),
  ADD CONSTRAINT "insw_cycle_hash" CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "insw_cycle_owner" CHECK (
    (status IN ('CLAIMED', 'REMOTE_SUCCEEDED') AND owner_token IS NOT NULL AND lease_until IS NOT NULL) OR
    (status NOT IN ('CLAIMED', 'REMOTE_SUCCEEDED') AND owner_token IS NULL AND lease_until IS NULL)),
  ADD CONSTRAINT "insw_cycle_hold" CHECK ((status = 'HELD') = (hold_reason IS NOT NULL)),
  ADD CONSTRAINT "insw_cycle_completion" CHECK ((status IN ('SUCCEEDED', 'FAILED')) = (completed_at IS NOT NULL)),
  ADD CONSTRAINT "insw_cycle_delivery" CHECK (
    (status NOT IN ('READY') OR delivery_state = 'NOT_STARTED') AND
    (status NOT IN ('SUCCEEDED', 'REMOTE_SUCCEEDED') OR delivery_state = 'KNOWN_SUCCESS') AND
    (status <> 'FAILED' OR delivery_state = 'KNOWN_FAILURE'));
ALTER TABLE "insw_queue_attempt" ADD CONSTRAINT "insw_attempt_retry" CHECK (retry_index >= 0);

-- HELD and REMOTE_SUCCEEDED continue to block another active cycle.
CREATE UNIQUE INDEX "insw_queue_one_active_identity" ON "insw_queue_cycle" (identity_key)
  WHERE status IN ('READY', 'CLAIMED', 'REMOTE_SUCCEEDED', 'HELD');
CREATE INDEX "insw_queue_ready_tail" ON "insw_queue_cycle" (tail_key, next_eligible_at)
  WHERE status = 'READY';

CREATE FUNCTION insw_queue_freeze_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.company_code, NEW.operation, NEW.identity_key, NEW.source_revision,
         NEW.business_date, NEW.wms_reference, NEW.cycle, NEW.intent, NEW.requested_by,
         NEW.source_log_id, NEW.frozen_payload, NEW.payload_sha256, NEW.max_auto_retry_snapshot)
     IS DISTINCT FROM
     ROW(OLD.company_code, OLD.operation, OLD.identity_key, OLD.source_revision,
         OLD.business_date, OLD.wms_reference, OLD.cycle, OLD.intent, OLD.requested_by,
         OLD.source_log_id, OLD.frozen_payload, OLD.payload_sha256, OLD.max_auto_retry_snapshot) THEN
    RAISE EXCEPTION 'INSW cycle identity, intent, payload and retry policy are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER insw_queue_freeze_cycle BEFORE UPDATE ON "insw_queue_cycle"
  FOR EACH ROW EXECUTE FUNCTION insw_queue_freeze_cycle();

-- No jobs or attempts are seeded, and no old logs are updated.
INSERT INTO "insw_transmission_policy" (id, updated_by, change_reason)
  VALUES (1, 'migration:phase-b', 'Initial inactive foundation defaults') ON CONFLICT (id) DO NOTHING;
INSERT INTO "insw_policy_change" (version, min_processing_interval_ms, max_auto_retry, changed_by, reason)
  SELECT version, min_processing_interval_ms, max_auto_retry, updated_by, change_reason
  FROM "insw_transmission_policy" WHERE id = 1 ON CONFLICT (version) DO NOTHING;
INSERT INTO "insw_dispatch_gate" (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
