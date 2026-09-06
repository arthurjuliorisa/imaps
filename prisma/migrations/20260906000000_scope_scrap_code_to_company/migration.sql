-- Scrap Master is company-owned. The compound unique index already protects
-- company_code + scrap_code, so only the conflicting global index is removed.
DROP INDEX IF EXISTS "scrap_items_scrap_code_key";
