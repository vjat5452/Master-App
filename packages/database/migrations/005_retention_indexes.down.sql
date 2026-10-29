-- Reverts 005_retention_indexes.sql.
DROP INDEX IF EXISTS inbox_events_processed_idx;
DROP INDEX IF EXISTS outbox_events_published_idx;
DROP INDEX IF EXISTS external_change_events_outbox_idx;
DROP INDEX IF EXISTS external_availability_observations_svc_idx;
DROP INDEX IF EXISTS external_serviceability_observations_collected_idx;
DROP INDEX IF EXISTS external_serviceability_observations_run_idx;
DROP INDEX IF EXISTS external_offer_observations_collected_idx;
DROP INDEX IF EXISTS external_offer_observations_run_idx;
DROP INDEX IF EXISTS external_availability_observations_run_idx;
DROP INDEX IF EXISTS external_price_observations_run_idx;
DROP INDEX IF EXISTS external_collection_jobs_updated_idx;
DROP INDEX IF EXISTS external_collection_runs_job_idx;
DROP INDEX IF EXISTS external_collection_runs_started_idx;
