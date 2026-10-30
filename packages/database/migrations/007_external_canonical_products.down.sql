-- Reverts 007_external_canonical_products.sql.
-- Externally discovered products that were never approved (no group) cannot exist under
-- the old schema, so they and their mappings are deleted. Approved ones (with a group) stay
-- as ordinary products.
DELETE FROM external_product_mappings m USING product_variants v
 WHERE m.variant_id = v.id AND v.group_id IS NULL;
DELETE FROM product_variants WHERE group_id IS NULL;
-- Links to approved products are kept, recorded as manual.
UPDATE external_product_mappings SET match_method = 'MANUAL' WHERE match_method = 'NEW_CANONICAL';

ALTER TABLE external_product_mappings DROP CONSTRAINT external_product_mappings_match_method_check;
ALTER TABLE external_product_mappings ADD CONSTRAINT external_product_mappings_match_method_check
  CHECK (match_method IN ('GTIN', 'MANUFACTURER_ID', 'BRAND_ATTRIBUTES', 'ATTRIBUTES', 'FUZZY_CANDIDATE', 'MANUAL'));

DROP INDEX IF EXISTS product_variants_external_review_idx;
ALTER TABLE product_variants
  DROP CONSTRAINT IF EXISTS product_variants_group_check,
  DROP COLUMN IF EXISTS created_from_listing_id,
  DROP COLUMN IF EXISTS origin,
  ALTER COLUMN group_id SET NOT NULL;
