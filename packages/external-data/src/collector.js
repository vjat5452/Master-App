// Runs one background collection job: ask the source, check and match what it returned,
// store the observations and any detected changes in one transaction, then refresh the
// shared comparison cache. The source is queried at the centre of the job's location cell,
// never at a customer's coordinates.
import { ConnectorError, decodeGeohash, ERROR_CODES } from '@localstock/connectors';
import { enqueueEvent, withTransaction } from '@localstock/database';
import { compareCacheKey, writeCompareCache } from './compare-cache.js';
import { createMatchingService } from './matching.js';
import { persistListingObservations, persistServiceability } from './observations.js';
import { checkListingQuality } from './quality.js';
import { createSourceRegistry } from './sources.js';

export const MAX_JOB_ATTEMPTS = 3;
const retryDelaySeconds = (attempt) => Math.min(3600, 60 * 2 ** (attempt - 1));
// Error messages stored with a run are already safe (ConnectorError messages carry no
// payloads or credentials), but are capped in length.
const safeMessage = (err) => (err instanceof ConnectorError ? err.message : 'unexpected collector failure').slice(0, 300);

/**
 * @param {{ pool, redis, connectors, logger, sources?, matching? }} deps
 */
export function createCollector({ pool, redis, connectors, logger, sources = createSourceRegistry({ pool }), matching = createMatchingService({ pool, sources }) }) {
  async function claim(jobId) {
    const { rows } = await pool.query(
      `UPDATE external_collection_jobs j SET status = 'RUNNING', attempts = attempts + 1, updated_at = now()
         FROM external_sources s
        WHERE j.id = $1 AND j.status IN ('PENDING', 'QUEUED') AND s.id = j.source_id
        RETURNING j.id, j.job_type, j.query_cell, j.search_query, j.attempts, j.source_id, s.code AS source_code`,
      [jobId],
    );
    return rows[0];
  }

  async function fail(job, runId, err, startedAt) {
    const code = err instanceof ConnectorError ? err.code : ERROR_CODES.UPSTREAM_ERROR;
    const retry = err instanceof ConnectorError && err.retryable && job.attempts < MAX_JOB_ATTEMPTS;
    await withTransaction(pool, async (client) => {
      if (runId) {
        await client.query(
          `UPDATE external_collection_runs SET status = 'FAILED', completed_at = now(), error_code = $2, error_message = $3, latency_ms = $4 WHERE id = $1`,
          [runId, code, safeMessage(err), Date.now() - startedAt],
        );
      }
      await client.query(
        `UPDATE external_collection_jobs
            SET status = $2, last_error_code = $3, updated_at = now(),
                scheduled_for = CASE WHEN $2 = 'PENDING' THEN now() + make_interval(secs => $4) ELSE scheduled_for END
          WHERE id = $1`,
        [job.id, retry ? 'PENDING' : 'FAILED', code, retryDelaySeconds(job.attempts)],
      );
      await enqueueEvent(client, {
        eventType: 'CollectionFailed',
        aggregateType: 'external_collection',
        aggregateId: job.id,
        payload: { schemaVersion: 1, jobId: job.id, runId, sourceCode: job.source_code, cell: job.query_cell, errorCode: code, willRetry: retry },
      });
    });
    logger.warn('external collection failed', { jobId: job.id, source: job.source_code, errorCode: code, willRetry: retry });
    return { status: 'FAILED', source: job.source_code, errorCode: code, willRetry: retry };
  }

  return {
    /**
     * Idempotent: a job that is not PENDING/QUEUED (already done, running elsewhere or
     * cancelled) is skipped, so a redelivered message does nothing.
     */
    async runJob(jobId) {
      const job = await claim(jobId);
      if (!job) return { status: 'SKIPPED' };
      const startedAt = Date.now();
      const connector = connectors.get(job.source_code);
      if (!connector || !connector.validateConfiguration().ok) {
        return fail(job, null, new ConnectorError(ERROR_CODES.SOURCE_NOT_CONFIGURED, 'source is no longer configured'), startedAt);
      }
      if (job.job_type !== 'SEARCH') return fail(job, null, new ConnectorError(ERROR_CODES.UNSUPPORTED, `job type ${job.job_type} is not implemented`), startedAt);

      const source = await sources.ensure(connector);
      const requestId = `job-${job.id}`;
      const { rows: run } = await pool.query(
        `INSERT INTO external_collection_runs (source_id, job_id, request_id) VALUES ($1, $2, $3) RETURNING id`,
        [source.sourceId, job.id, requestId],
      );
      const runId = run[0].id;

      try {
        const location = decodeGeohash(job.query_cell);
        const result = await connector.searchProducts(job.search_query, location, { requestId, limit: 50 });
        let serviceability = null;
        if (connector.capabilities.serviceability === 'SUPPORTED') {
          serviceability = await connector.resolveServiceability(location, { requestId }).catch((err) => {
            logger.warn('serviceability lookup failed', { source: connector.code, requestId, errorCode: err.code });
            return null;
          });
        }

        const checked = result.items.map((listing) => checkListingQuality(listing));
        const rejected = checked.filter((c) => c.issues.some((i) => i.severity === 'ERROR')).length;
        const matches = await matching.resolve(connector, checked);
        const entries = checked.map((c) => ({ ...c, listingRecordId: matches.get(c.listing.externalListingId)?.listingRecordId ?? null }));
        const ctx = { ...source, sourceCode: connector.code, runId, cell: job.query_cell };

        const counts = await withTransaction(pool, async (client) => {
          const listed = await persistListingObservations(client, ctx, entries);
          const served = serviceability ? await persistServiceability(client, ctx, serviceability) : { observations: 0, changes: 0 };
          const observations = listed.observations + served.observations;
          await client.query(
            `UPDATE external_collection_runs
                SET status = 'SUCCEEDED', completed_at = now(), items_received = $2, items_valid = $3, items_rejected = $4,
                    observations_written = $5, latency_ms = $6
              WHERE id = $1`,
            [runId, result.items.length, result.items.length - rejected, rejected, observations, Date.now() - startedAt],
          );
          await client.query(`UPDATE external_collection_jobs SET status = 'SUCCEEDED', last_error_code = NULL, updated_at = now() WHERE id = $1`, [job.id]);
          return { observations, changes: listed.changes + served.changes };
        });

        // The comparison API reads this; a failure here only costs a later live lookup.
        await writeCompareCache(redis, compareCacheKey(connector.code, job.query_cell, job.search_query), {
          collectedAt: new Date().toISOString(),
          items: result.items,
        }).catch(() => {});
        logger.info('external collection succeeded', { jobId: job.id, source: connector.code, items: result.items.length, ...counts });
        return { status: 'SUCCEEDED', source: connector.code, runId, items: result.items.length, ...counts };
      } catch (err) {
        return fail(job, runId, err, startedAt);
      }
    },
  };
}
