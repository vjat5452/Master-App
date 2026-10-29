// Turns comparison demand into background refresh jobs, within each source's permitted
// cadence. One job = one query, in one location cell, from one source. Duplicate work is
// impossible: open jobs are unique per dedup key (a partial unique index), and a key
// that succeeded within the source's minRefreshSeconds is not scheduled again.
import { createHash } from 'node:crypto';
import { topDemand } from './demand.js';
import { createSourceRegistry } from './sources.js';

const STUCK_AFTER_SECONDS = 600;

export const dedupKey = (sourceCode, cell, query) => `search:${sourceCode}:${cell}:${createHash('sha1').update(query).digest('hex')}`;

/** More demand, higher RabbitMQ priority (0-9). */
export const demandPriority = (count) => Math.min(9, Math.max(1, Math.ceil(Math.log2(count + 1))));

/**
 * @param {{ pool, redis, connectors, policy, publish: (jobId: string, priority: number) => Promise<void>, logger, maxJobsPerSource?: number }} deps
 *   publish sends a job to the collection queue (with publisher confirms)
 */
export function createRefreshScheduler({ pool, redis, connectors, policy, publish, logger, maxJobsPerSource = 20, sources = createSourceRegistry({ pool }) }) {
  // Sources that can be refreshed in the background: configured and able to search.
  const refreshable = () =>
    connectors.list().filter((c) => c.validateConfiguration().ok && c.capabilities.product_search === 'SUPPORTED');

  async function enqueue(connector, demand) {
    const { sourceId } = await sources.ensure(connector);
    const minRefresh = policy.minRefreshSeconds(connector.code);
    let created = 0;
    for (const { query, cell, count } of demand) {
      if (created >= maxJobsPerSource) break;
      const key = dedupKey(connector.code, cell, query);
      const { rows: recent } = await pool.query(
        `SELECT 1 FROM external_collection_jobs
          WHERE dedup_key = $1 AND status = 'SUCCEEDED' AND updated_at > now() - make_interval(secs => $2) LIMIT 1`,
        [key, minRefresh],
      );
      if (recent.length) continue;
      const { rowCount } = await pool.query(
        `INSERT INTO external_collection_jobs (source_id, job_type, query_cell, search_query, priority, dedup_key)
         VALUES ($1, 'SEARCH', $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
        [sourceId, cell, query, demandPriority(count), key],
      );
      created += rowCount;
    }
    return created;
  }

  // Sends due PENDING jobs (new ones, retries whose backoff has passed, and any whose
  // earlier publish failed) to the queue and marks them QUEUED.
  async function dispatch(limit = 200) {
    const { rows } = await pool.query(
      `SELECT id, priority FROM external_collection_jobs
        WHERE status = 'PENDING' AND scheduled_for <= now()
        ORDER BY priority DESC, scheduled_for LIMIT $1`,
      [limit],
    );
    let sent = 0;
    for (const job of rows) {
      try {
        await publish(job.id, job.priority);
        await pool.query(`UPDATE external_collection_jobs SET status = 'QUEUED', updated_at = now() WHERE id = $1 AND status = 'PENDING'`, [job.id]);
        sent += 1;
      } catch (err) {
        logger.warn('could not queue collection job; will retry', { jobId: job.id, err: err.message });
        break;
      }
    }
    return sent;
  }

  // A worker that died mid-job leaves it RUNNING; give it back to the queue.
  async function recoverStuck() {
    const { rowCount } = await pool.query(
      `UPDATE external_collection_jobs SET status = 'PENDING', updated_at = now()
        WHERE status = 'RUNNING' AND updated_at < now() - make_interval(secs => $1)`,
      [STUCK_AFTER_SECONDS],
    );
    return rowCount;
  }

  return {
    async tick() {
      const sourcesToRefresh = refreshable();
      let scheduled = 0;
      if (sourcesToRefresh.length) {
        const demand = await topDemand(redis, { limit: 100 });
        for (const connector of sourcesToRefresh) scheduled += await enqueue(connector, demand);
      }
      const recovered = await recoverStuck();
      const queued = await dispatch();
      if (scheduled || queued || recovered) logger.info('external refresh scheduled', { scheduled, queued, recovered });
      return { scheduled, queued, recovered };
    },
  };
}
