-- Add section column to production_outputs table
ALTER TABLE production_outputs
ADD COLUMN section VARCHAR(100);

-- Add section column to material_usages table
ALTER TABLE material_usages
ADD COLUMN section VARCHAR(100);
