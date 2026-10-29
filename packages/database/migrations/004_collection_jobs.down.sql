-- Reverts 004_collection_jobs.sql. SEARCH jobs are removed first so the old constraint fits.
DROP INDEX IF EXISTS external_collection_jobs_running_idx;
DROP INDEX IF EXISTS external_collection_jobs_dedup_recent_idx;
DELETE FROM external_collection_runs WHERE job_id IN (SELECT id FROM external_collection_jobs WHERE job_type = 'SEARCH');
DELETE FROM external_collection_jobs WHERE job_type = 'SEARCH';
ALTER TABLE external_collection_jobs DROP CONSTRAINT external_collection_jobs_job_type_check;
ALTER TABLE external_collection_jobs ADD CONSTRAINT external_collection_jobs_job_type_check
  CHECK (job_type IN ('CATALOGUE', 'PRICE', 'AVAILABILITY', 'SERVICEABILITY', 'HEALTH'));
