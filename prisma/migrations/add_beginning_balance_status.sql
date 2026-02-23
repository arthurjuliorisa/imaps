-- Create the enum type
DO $$ BEGIN
  CREATE TYPE beginning_balance_status AS ENUM ('OPEN', 'TRANSMITTED_TO_INSW', 'LOCKED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add status column to beginning_balances
ALTER TABLE beginning_balances
  ADD COLUMN IF NOT EXISTS status beginning_balance_status NOT NULL DEFAULT 'OPEN';

-- Add index on status
CREATE INDEX IF NOT EXISTS beginning_balances_status_idx ON beginning_balances(status);
