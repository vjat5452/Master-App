-- Background collection (Milestone 8).
-- SEARCH jobs refresh one query in one location cell from one source: the listings it
-- returns, with their prices and availability.
ALTER TABLE external_collection_jobs DROP CONSTRAINT external_collection_jobs_job_type_check;
ALTER TABLE external_collection_jobs ADD CONSTRAINT external_collection_jobs_job_type_check
  CHECK (job_type IN ('SEARCH', 'CATALOGUE', 'PRICE', 'AVAILABILITY', 'SERVICEABILITY', 'HEALTH'));

-- "When did this exact work last succeed?" decides whether the permitted cadence allows
-- another refresh.
CREATE INDEX external_collection_jobs_dedup_recent_idx ON external_collection_jobs (dedup_key, updated_at DESC);
-- Stuck RUNNING jobs are found and re-queued.
CREATE INDEX external_collection_jobs_running_idx ON external_collection_jobs (updated_at) WHERE status = 'RUNNING';
