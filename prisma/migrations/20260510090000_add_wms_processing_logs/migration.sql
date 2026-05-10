-- Additive Phase 1 WMS backend processing audit table.
-- No existing table/column/constraint is dropped or changed.

CREATE TABLE "wms_processing_logs" (
    "id" BIGSERIAL NOT NULL,
    "wms_transmission_log_id" BIGINT,
    "endpoint" VARCHAR(120) NOT NULL,
    "http_method" VARCHAR(10) NOT NULL,
    "wms_id" VARCHAR(100),
    "company_code" INTEGER,
    "request_id" VARCHAR(100),
    "payload_hash" VARCHAR(128),
    "validation_status" VARCHAR(30) NOT NULL DEFAULT 'RECEIVED',
    "backend_processing_status" VARCHAR(30) NOT NULL DEFAULT 'NOT_STARTED',
    "transmitted_item_count" INTEGER,
    "validated_item_count" INTEGER,
    "queued_item_count" INTEGER,
    "inserted_item_count" INTEGER,
    "updated_item_count" INTEGER,
    "failed_item_count" INTEGER,
    "error_code" VARCHAR(80),
    "error_message" TEXT,
    "error_target" TEXT,
    "sanitized_error_stack" TEXT,
    "backend_processing_started_at" TIMESTAMPTZ(6),
    "backend_processing_finished_at" TIMESTAMPTZ(6),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wms_processing_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wms_processing_logs_wms_transmission_log_id_idx" ON "wms_processing_logs"("wms_transmission_log_id");
CREATE INDEX "wms_processing_logs_endpoint_created_at_idx" ON "wms_processing_logs"("endpoint", "created_at" DESC);
CREATE INDEX "wms_processing_logs_wms_id_company_code_created_at_idx" ON "wms_processing_logs"("wms_id", "company_code", "created_at" DESC);
CREATE INDEX "wms_processing_logs_backend_processing_status_created_at_idx" ON "wms_processing_logs"("backend_processing_status", "created_at" DESC);
CREATE INDEX "wms_processing_logs_validation_status_created_at_idx" ON "wms_processing_logs"("validation_status", "created_at" DESC);
CREATE INDEX "wms_processing_logs_company_code_created_at_idx" ON "wms_processing_logs"("company_code", "created_at" DESC);

ALTER TABLE "wms_processing_logs"
ADD CONSTRAINT "wms_processing_logs_wms_transmission_log_id_fkey"
FOREIGN KEY ("wms_transmission_log_id")
REFERENCES "wms_transmission_logs"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
