-- Canonical products discovered on other platforms (2026-10-29).
--
-- A product that no LocalStock seller lists can still be found and compared. When an
-- external listing matches no catalogue product, a canonical product is created for it with
-- origin EXTERNAL and status PENDING_REVIEW:
--   - it is searchable and comparable;
--   - it has no group (category) until an admin classifies it;
--   - it cannot be sold: sellers can only create offers for ACTIVE products, and ACTIVE
--     requires a group;
--   - no seller, warehouse or stock row is ever created for it.

ALTER TABLE product_variants
  ALTER COLUMN group_id DROP NOT NULL,
  ADD COLUMN origin TEXT NOT NULL DEFAULT 'LOCALSTOCK'
    CONSTRAINT product_variants_origin_check CHECK (origin IN ('LOCALSTOCK', 'EXTERNAL')),
  ADD COLUMN created_from_listing_id UUID REFERENCES external_listings(id) ON DELETE SET NULL,
  -- Only externally discovered products may lack a group, and an ACTIVE product always has one.
  ADD CONSTRAINT product_variants_group_check CHECK ((origin = 'EXTERNAL' OR group_id IS NOT NULL) AND (status <> 'ACTIVE' OR group_id IS NOT NULL));

CREATE INDEX product_variants_external_review_idx ON product_variants (created_at) WHERE origin = 'EXTERNAL' AND status = 'PENDING_REVIEW';

-- The mapping that links a listing to the canonical product created from it.
ALTER TABLE external_product_mappings DROP CONSTRAINT external_product_mappings_match_method_check;
ALTER TABLE external_product_mappings ADD CONSTRAINT external_product_mappings_match_method_check
  CHECK (match_method IN ('GTIN', 'MANUFACTURER_ID', 'BRAND_ATTRIBUTES', 'ATTRIBUTES', 'FUZZY_CANDIDATE', 'MANUAL', 'NEW_CANONICAL'));
