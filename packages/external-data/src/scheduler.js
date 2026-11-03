// Open jobs are unique per dedup key (partial unique index), and a key that succeeded
// within the source's minRefreshSeconds is not scheduled again.
import { createHash } from 'node:crypto';
import { MAX_JOB_ATTEMPTS } from './collector.js';
import { topDemand } from './demand.js';
import { createSourceRegistry } from './sources.js';

const STUCK_AFTER_SECONDS = 600;

export const dedupKey = (sourceCode, cell, query) => `search:${sourceCode}:${cell}:${createHash('sha1').update(query).digest('hex')}`;

// RabbitMQ priority 1-9, logarithmic in demand.
export const demandPriority = (count) => Math.min(9, Math.max(1, Math.ceil(Math.log2(count + 1))));

// publish must use publisher confirms.
export function createRefreshScheduler({ pool, redis, connectors, policy, publish, logger, maxJobsPerSource = 20, sources = createSourceRegistry({ pool }) }) {
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

  // Also re-sends jobs whose earlier publish failed.
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

  // A worker that died mid-job leaves it RUNNING; give it back to the queue, unless it has
  // used all its attempts (a job that keeps killing the worker must not loop forever).
  async function recoverStuck() {
    const { rows } = await pool.query(
      `UPDATE external_collection_jobs
          SET status = CASE WHEN attempts >= $2 THEN 'FAILED' ELSE 'PENDING' END,
              last_error_code = CASE WHEN attempts >= $2 THEN 'WORKER_LOST' ELSE last_error_code END,
              updated_at = now()
        WHERE status = 'RUNNING' AND updated_at < now() - make_interval(secs => $1)
        RETURNING status`,
      [STUCK_AFTER_SECONDS, MAX_JOB_ATTEMPTS],
    );
    const abandoned = rows.filter((r) => r.status === 'FAILED').length;
    if (abandoned) logger.warn('stuck collection jobs gave up after the last attempt', { abandoned });
    return rows.length - abandoned;
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
