-- Indexes for the retention job (Milestone 11): find old rows by time, and check quickly
-- whether a row is still referenced before deleting it.
CREATE INDEX external_collection_runs_started_idx ON external_collection_runs (started_at);
CREATE INDEX external_collection_runs_job_idx ON external_collection_runs (job_id) WHERE job_id IS NOT NULL;
CREATE INDEX external_collection_jobs_updated_idx ON external_collection_jobs (updated_at)
  WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE INDEX external_price_observations_run_idx ON external_price_observations (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX external_availability_observations_run_idx ON external_availability_observations (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX external_offer_observations_run_idx ON external_offer_observations (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX external_offer_observations_collected_idx ON external_offer_observations (collected_at);
CREATE INDEX external_serviceability_observations_run_idx ON external_serviceability_observations (run_id) WHERE run_id IS NOT NULL;
CREATE INDEX external_serviceability_observations_collected_idx ON external_serviceability_observations (collected_at);
CREATE INDEX external_availability_observations_svc_idx ON external_availability_observations (serviceability_observation_id)
  WHERE serviceability_observation_id IS NOT NULL;
CREATE INDEX external_change_events_outbox_idx ON external_change_events (outbox_event_id) WHERE outbox_event_id IS NOT NULL;
CREATE INDEX outbox_events_published_idx ON outbox_events (published_at) WHERE published_at IS NOT NULL;
CREATE INDEX inbox_events_processed_idx ON inbox_events (processed_at);
