ALTER TABLE "incoming_goods"
  ALTER COLUMN "invoice_number" DROP NOT NULL,
  ALTER COLUMN "invoice_date" DROP NOT NULL;
