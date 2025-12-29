-- Add BC41 to CustomsDocumentType enum
-- BC41: Local Sales to Non-Bonded Zone from Local Purchase (BC40)

ALTER TYPE "CustomsDocumentType" ADD VALUE IF NOT EXISTS 'BC41';
