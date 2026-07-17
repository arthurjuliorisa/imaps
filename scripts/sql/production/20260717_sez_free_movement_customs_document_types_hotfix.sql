ALTER TYPE "CustomsDocumentType" ADD VALUE IF NOT EXISTS 'free_movement';
ALTER TYPE "CustomsDocumentType" ADD VALUE IF NOT EXISTS 'free_movement-IN';
ALTER TYPE "CustomsDocumentType" ADD VALUE IF NOT EXISTS 'free_movement-OUT';

UPDATE companies
SET company_type = 'SEZ'::company_type,
    updated_at = NOW()
WHERE code = 1380
  AND company_type IS DISTINCT FROM 'SEZ'::company_type;
