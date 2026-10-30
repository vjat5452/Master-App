-- First-party vendor extensions (Milestone 2). Additive only: every new column is nullable
-- or has a default, so existing rows and existing queries keep working.

-- MRP (maximum retail price). A seller may sell at or below MRP, never above it.
ALTER TABLE seller_offers
  ADD COLUMN mrp_minor BIGINT,
  ADD CONSTRAINT seller_offers_mrp_check CHECK (mrp_minor IS NULL OR mrp_minor >= price_minor);

ALTER TABLE companies
  ADD COLUMN vendor_type TEXT NOT NULL DEFAULT 'RETAILER'
    CONSTRAINT companies_vendor_type_check CHECK (vendor_type IN ('RETAILER', 'WHOLESALER', 'DISTRIBUTOR', 'BRAND', 'OTHER')),
  ADD COLUMN contact_phone TEXT
    CONSTRAINT companies_contact_phone_check CHECK (contact_phone ~ '^\+?[0-9 ()-]{6,20}$');

-- Store contact and opening hours, e.g. {"mon": [["08:00", "22:00"]], ...}. Shape is
-- validated by the API.
ALTER TABLE warehouses
  ADD COLUMN contact_phone TEXT
    CONSTRAINT warehouses_contact_phone_check CHECK (contact_phone ~ '^\+?[0-9 ()-]{6,20}$'),
  ADD COLUMN opening_hours JSONB;

-- Where an audited change came from. Existing rows were all made by users.
ALTER TABLE audit_logs
  ADD COLUMN source_of_change TEXT NOT NULL DEFAULT 'USER'
    CONSTRAINT audit_logs_source_of_change_check CHECK (source_of_change IN ('USER', 'ADMIN', 'CSV_IMPORT', 'SYSTEM'));

-- Parsed pack size, in base units: grams, millilitres or pieces, per item, times
-- pack_count items. "6 x 200 ml" is (200, ml, 6); "1 kg" is (1000, g, 1). NULL when the
-- size is unknown or could not be parsed; such variants are never matched on size.
-- Filled from `attributes` by `npm run backfill:pack-size -w @localstock/database`.
ALTER TABLE product_variants
  ADD COLUMN pack_quantity NUMERIC(12, 3) CONSTRAINT product_variants_pack_quantity_check CHECK (pack_quantity > 0),
  ADD COLUMN pack_unit TEXT CONSTRAINT product_variants_pack_unit_check CHECK (pack_unit IN ('g', 'ml', 'pcs')),
  ADD COLUMN pack_count INTEGER CONSTRAINT product_variants_pack_count_check CHECK (pack_count >= 1),
  ADD CONSTRAINT product_variants_pack_complete_check CHECK (
    (pack_quantity IS NULL) = (pack_unit IS NULL) AND (pack_quantity IS NULL) = (pack_count IS NULL));
CREATE INDEX product_variants_pack_idx ON product_variants (pack_unit, pack_quantity, pack_count)
  WHERE pack_quantity IS NOT NULL;
