-- CreateTable
CREATE TABLE "insw_preparation_rollout" (
    "id" UUID NOT NULL,
    "company_code" INTEGER NOT NULL,
    "source_kind" VARCHAR(30) NOT NULL DEFAULT 'INCOMING',
    "mode" VARCHAR(20) NOT NULL DEFAULT 'DISABLED',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insw_preparation_rollout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_preparation_member" (
    "id" UUID NOT NULL,
    "rollout_id" UUID NOT NULL,
    "company_code" INTEGER NOT NULL,
    "source_kind" VARCHAR(30) NOT NULL DEFAULT 'INCOMING',
    "wms_reference" VARCHAR(100) NOT NULL,
    "source_id" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "proof" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insw_preparation_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insw_preparation_ledger" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "rollout_id" UUID NOT NULL,
    "company_code" INTEGER NOT NULL,
    "source_kind" VARCHAR(30) NOT NULL DEFAULT 'INCOMING',
    "wms_reference" VARCHAR(100) NOT NULL,
    "source_id" INTEGER NOT NULL,
    "business_date" DATE NOT NULL,
    "state" VARCHAR(30) NOT NULL DEFAULT 'SOURCE_OBSERVED',
    "reason" VARCHAR(60) NOT NULL DEFAULT 'ACCEPTANCE_UNPROVEN',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_eligible_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "owner_token" UUID,
    "lease_until" TIMESTAMPTZ(6),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "queue_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "insw_preparation_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "insw_preparation_rollout_company_code_source_kind_key" ON "insw_preparation_rollout"("company_code", "source_kind");

-- CreateIndex
CREATE INDEX "insw_preparation_member_rollout_id_id_idx" ON "insw_preparation_member"("rollout_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "insw_preparation_member_company_code_source_kind_wms_refere_key" ON "insw_preparation_member"("company_code", "source_kind", "wms_reference");

-- CreateIndex
CREATE UNIQUE INDEX "insw_preparation_ledger_member_id_key" ON "insw_preparation_ledger"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "insw_preparation_ledger_queue_id_key" ON "insw_preparation_ledger"("queue_id");

-- CreateIndex
CREATE INDEX "insw_preparation_ledger_rollout_id_state_next_eligible_at_idx" ON "insw_preparation_ledger"("rollout_id", "state", "next_eligible_at");

-- CreateIndex
CREATE UNIQUE INDEX "insw_preparation_ledger_company_code_source_kind_wms_refere_key" ON "insw_preparation_ledger"("company_code", "source_kind", "wms_reference");

-- No activation or historical population in this slice. C2C must replace this
-- constraint only after exclusive routing, drain and membership are reviewed.
ALTER TABLE insw_preparation_rollout
 ADD CHECK (source_kind = 'INCOMING'),
 ADD CHECK (mode IN ('DISABLED', 'PREPARED')),
 ADD UNIQUE (id, company_code, source_kind);
ALTER TABLE insw_preparation_member
 ADD CHECK (source_kind = 'INCOMING' AND source_id > 0 AND length(trim(wms_reference)) > 0),
 ADD FOREIGN KEY (rollout_id, company_code, source_kind)
 REFERENCES insw_preparation_rollout(id, company_code, source_kind),
 ADD UNIQUE (id, rollout_id, company_code, source_kind, wms_reference, source_id, business_date);
ALTER TABLE insw_preparation_ledger
 ADD FOREIGN KEY (member_id, rollout_id, company_code, source_kind, wms_reference, source_id, business_date)
 REFERENCES insw_preparation_member(id, rollout_id, company_code, source_kind, wms_reference, source_id, business_date),
 ADD FOREIGN KEY (queue_id) REFERENCES insw_queue_cycle(id),
 ADD CHECK (state IN ('SOURCE_OBSERVED','PENDING','CLAIMED','RETRYABLE','REVIEW_HOLD','QUEUE_CREATED')),
 ADD CHECK (reason IN ('ACCEPTANCE_UNPROVEN','SYNTHETIC_MEMBERSHIP_VERIFIED','PREPARING','TRANSIENT_DATABASE','PERMANENT_PREPARATION','BUDGET_EXHAUSTED','REMOTE_SUCCESS_NO_REPOST','DIRECT_HISTORY_REQUIRES_REVIEW','EXISTING_QUEUE_REQUIRES_REVIEW','SOURCE_IDENTITY_UNCONFIRMED','QUEUE_CREATED')),
 ADD CHECK (attempt_count BETWEEN 0 AND 5 AND fence >= 0),
 ADD CHECK ((state = 'CLAIMED') = (owner_token IS NOT NULL AND lease_until IS NOT NULL)),
 ADD CHECK ((state = 'QUEUE_CREATED') = (queue_id IS NOT NULL));
CREATE INDEX insw_preparation_queue_correlation_idx ON insw_queue_cycle(company_code, operation, wms_reference);
-- No triggers or foreign keys are added to WMS source tables.
