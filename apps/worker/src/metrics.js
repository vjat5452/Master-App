// Worker metrics, served on WORKER_METRICS_PORT (optional) together with /health/live for
// container health checks. Backlogs are read at scrape time, so they are always current.
import http from 'node:http';
import { createRegistry, metricsAccess } from '@localstock/metrics';
import { QUEUES, DEAD_LETTER_QUEUE } from './messaging/topology.js';

export function createWorkerMetrics({ pool, channel }) {
  const registry = createRegistry();
  const collectionRuns = registry.counter('collection_jobs_total', 'Collection jobs processed by this worker, by source and outcome');

  registry.gauge('outbox_unpublished_events', 'Outbox events waiting to be published', async () => {
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL');
    return rows[0].n;
  });
  registry.gauge('outbox_oldest_unpublished_seconds', 'Age of the oldest unpublished outbox event', async () => {
    const { rows } = await pool.query(`SELECT coalesce(extract(epoch FROM now() - min(created_at)), 0)::int AS s FROM outbox_events WHERE published_at IS NULL`);
    return rows[0].s;
  });
  registry.gauge('collection_jobs', 'Collection jobs by status (open and recent)', async () => {
    const { rows } = await pool.query(
      `SELECT status, count(*)::int AS n FROM external_collection_jobs
        WHERE status IN ('PENDING', 'QUEUED', 'RUNNING') OR updated_at > now() - interval '1 hour' GROUP BY status`,
    );
    return rows.map((r) => ({ labels: { status: r.status }, value: r.n }));
  });
  registry.gauge('external_source_health', 'Latest health per external source (1 for the current state)', async () => {
    const { rows } = await pool.query(
      'SELECT s.code, h.health, h.error_rate FROM external_source_health h JOIN external_sources s ON s.id = h.source_id',
    );
    return rows.map((r) => ({ labels: { source: r.code, health: r.health }, value: 1 }));
  });
  registry.gauge('rabbitmq_queue_messages', 'Ready messages per queue', async () => {
    const names = [...Object.values(QUEUES).map((q) => q.name), DEAD_LETTER_QUEUE];
    const out = [];
    for (const name of names) {
      const q = await channel.checkQueue(name);
      out.push({ labels: { queue: name }, value: q.messageCount });
    }
    return out;
  });

  return { registry, collectionRuns };
}

export function startMetricsServer({ port, registry, token, production, logger }) {
  const allowed = metricsAccess({ token, production });
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}');
    } else if (req.url === '/metrics' && allowed(req.headers.authorization)) {
      res.writeHead(200, { 'content-type': registry.contentType }).end(await registry.render());
    } else {
      res.writeHead(404).end();
    }
  });
  server.listen(port, () => logger.info('worker metrics listening', { port }));
  return server;
}
