-- Commit the enum addition before the following migration uses it (PostgreSQL).
-- No existing queue/attempt/log row is changed.
ALTER TYPE "InswQueueStatus" ADD VALUE 'SUPERSEDED';
