-- Reverts 002_external_platforms.sql. Drops all external observation data.

DROP TABLE IF EXISTS external_change_events;
DROP TABLE IF EXISTS external_offer_observations;
DROP TABLE IF EXISTS external_availability_observations;
DROP TABLE IF EXISTS external_price_observations;
DROP TABLE IF EXISTS external_serviceability_observations;
DROP TABLE IF EXISTS external_source_health;
DROP TABLE IF EXISTS external_collection_runs;
DROP TABLE IF EXISTS external_collection_jobs;
DROP TABLE IF EXISTS external_product_mappings;
DROP TABLE IF EXISTS external_listings;
DROP TABLE IF EXISTS external_fulfillment_nodes;
DROP TABLE IF EXISTS external_sources;
DROP TABLE IF EXISTS external_platforms;
