-- CreateEnum for UserRole if it doesn't exist
DO $$ BEGIN
    CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'USER', 'VIEWER');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- AlterTable User - Add role and companyCode columns
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "role" "UserRole" NOT NULL DEFAULT 'USER';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "companyCode" TEXT;

-- Update existing test user if it exists
UPDATE "User"
SET "role" = 'ADMIN', "companyCode" = 'DEFAULT'
WHERE email = 'admin@email.com';

-- Update other existing users to have default role
UPDATE "User"
SET "role" = 'USER'
WHERE "role" IS NULL;
