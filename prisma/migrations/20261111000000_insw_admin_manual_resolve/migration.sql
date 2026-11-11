-- No queue, attempt, tracking or WMS history is rewritten.
CREATE TABLE "insw_admin_resolution" (
  "queue_id" uuid PRIMARY KEY REFERENCES "insw_queue_cycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolved_by" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "resolved_at" timestamptz(6) NOT NULL DEFAULT clock_timestamp(),
  "notes" varchar(2000) NOT NULL,
  CONSTRAINT "insw_admin_resolution_notes_check" CHECK (length(btrim(notes)) BETWEEN 1 AND 2000)
);
