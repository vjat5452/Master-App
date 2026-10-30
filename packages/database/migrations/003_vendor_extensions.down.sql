-- Reverts 003_vendor_extensions.sql. Drops MRP, vendor contact, opening hours, audit
-- source and parsed pack sizes.

DROP INDEX IF EXISTS product_variants_pack_idx;
ALTER TABLE product_variants
  DROP CONSTRAINT IF EXISTS product_variants_pack_complete_check,
  DROP COLUMN IF EXISTS pack_count,
  DROP COLUMN IF EXISTS pack_unit,
  DROP COLUMN IF EXISTS pack_quantity;

ALTER TABLE audit_logs DROP COLUMN IF EXISTS source_of_change;

ALTER TABLE warehouses
  DROP COLUMN IF EXISTS opening_hours,
  DROP COLUMN IF EXISTS contact_phone;

ALTER TABLE companies
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS vendor_type;

ALTER TABLE seller_offers DROP COLUMN IF EXISTS mrp_minor;
