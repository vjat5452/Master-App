// Starts every worker duty (outbox publishing, consumers, scheduled jobs, external
// collection) and returns a stop() for graceful shutdown. Used by worker.js (standalone
// process) and by the all-in-one entry that runs the worker inside the API process on hosts
// without background workers (e.g. Render's free plan).
import amqp from 'amqplib';
import { Redis } from 'ioredis';
import { buildConnectorRegistry } from '@localstock/connectors';
import { createPool } from '@localstock/database';
import {
  createCollector,
  createFreshnessPolicy,
  createHealthJob,
  createRefreshScheduler,
  createRetentionJob,
  createSourceRegistry,
} from '@localstock/external-data';
import { createJobPublisher, runCollectionConsumer } from './consumers/external-collection.js';
import { createExternalChangeHandler, createSearchProjectionHandler, handleNotification } from './consumers/handlers.js';
import { runConsumer } from './consumers/run-consumer.js';
import { createOutboxPublisher } from './jobs/outbox-publisher.js';
import { createReconciliationJob } from './jobs/reconciliation.js';
import { createReservationExpiryJob } from './jobs/reservation-expiry.js';
import { every } from './jobs/scheduler.js';
import { assertTopology, QUEUES } from './messaging/topology.js';
import { createWorkerMetrics, startMetricsServer } from './metrics.js';

async function connectWithRetry(url, logger, attempts = 30) {
  for (let i = 1; ; i++) {
    try {
      return await amqp.connect(url);
    } catch (err) {
      if (i >= attempts) throw err;
      logger.warn('rabbitmq not reachable yet, retrying', { attempt: i, err: err.message });
      await new Promise((r) => setTimeout(r, Math.min(10_000, 500 * 2 ** i)));
    }
  }
}

/**
 * @param {{ config, logger, onFatal?: (reason: string) => void }} opts
 *   onFatal: called when the broker connection drops unexpectedly (default: exit so the
 *   supervisor restarts the process).
 * @returns {Promise<{ stop: () => Promise<void> }>}
 */
export async function startWorker({ config, logger, onFatal = () => process.exit(1) }) {
  const pool = createPool(config.DATABASE_URL, { max: 5 });
  pool.on('error', (err) => logger.error('idle postgres client error', { err }));
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
  redis.on('error', (err) => logger.warn('redis error', { err: err.message }));

  const connection = await connectWithRetry(config.RABBITMQ_URL, logger);
  let stopping = false;
  // Without a broker connection the worker cannot do its job.
  connection.on('close', () => {
    if (!stopping) {
      logger.error('rabbitmq connection closed unexpectedly');
      onFatal('rabbitmq connection closed');
    }
  });

  const publishChannel = await connection.createConfirmChannel();
  await assertTopology(publishChannel);
  const consumeChannel = await connection.createChannel();
  await consumeChannel.prefetch(10);

  await runConsumer({ channel: consumeChannel, pool, logger, queue: QUEUES.notifications.name, consumer: 'notifications', handle: handleNotification });
  await runConsumer({
    channel: consumeChannel,
    pool,
    logger,
    queue: QUEUES.searchProjection.name,
    consumer: 'search-projection',
    handle: createSearchProjectionHandler(redis),
  });
  await runConsumer({
    channel: consumeChannel,
    pool,
    logger,
    queue: QUEUES.externalChanges.name,
    consumer: 'external-cache-invalidation',
    handle: createExternalChangeHandler(redis),
  });

  // External sources: only configured ones are ever called (all are disabled by default).
  const connectors = buildConnectorRegistry({ env: process.env, logger: logger.child({ component: 'connectors' }) });
  const sources = createSourceRegistry({ pool });
  const collector = createCollector({ pool, redis, connectors, logger, sources });
  // Own channel so slow sources cannot starve the other consumers.
  const collectChannel = await connection.createChannel();
  await collectChannel.prefetch(config.EXTERNAL_COLLECTION_CONCURRENCY);
  const metrics = createWorkerMetrics({ pool, channel: publishChannel });
  await runCollectionConsumer({
    channel: collectChannel,
    queue: QUEUES.externalCollection.name,
    collector,
    logger,
    onResult: (r) => r.source && metrics.collectionRuns.inc({ source: r.source, status: r.status }),
  });
  const refreshScheduler = createRefreshScheduler({
    pool,
    redis,
    connectors,
    sources,
    policy: createFreshnessPolicy(config.EXTERNAL_FRESHNESS),
    publish: createJobPublisher(publishChannel, QUEUES.externalCollection.name),
    logger,
  });

  const jobs = [
    every('outbox-publisher', config.OUTBOX_POLL_INTERVAL_MS, createOutboxPublisher({ pool, channel: publishChannel, logger }), logger),
    every('reservation-expiry', config.RESERVATION_EXPIRY_INTERVAL_MS, createReservationExpiryJob({ pool, logger }), logger),
    every('reconciliation', config.RECONCILIATION_INTERVAL_MS, createReconciliationJob({ pool, logger }), logger),
    every('external-refresh', config.EXTERNAL_REFRESH_INTERVAL_MS, refreshScheduler.tick, logger),
    every('external-health', config.EXTERNAL_HEALTH_INTERVAL_MS, createHealthJob({ pool, connectors, logger, sources }), logger),
    every(
      'retention',
      config.RETENTION_INTERVAL_MS,
      createRetentionJob({ pool, logger, externalDays: config.EXTERNAL_RETENTION_DAYS, eventDays: config.EVENT_RETENTION_DAYS }),
      logger,
    ),
  ];
  const metricsServer = config.WORKER_METRICS_PORT
    ? startMetricsServer({ port: config.WORKER_METRICS_PORT, registry: metrics.registry, token: config.METRICS_TOKEN, production: config.NODE_ENV === 'production', logger })
    : null;
  logger.info('worker started', { queues: Object.values(QUEUES).map((q) => q.name) });

  return {
    async stop() {
      stopping = true;
      metricsServer?.close();
      await Promise.allSettled(jobs.map((j) => j.stop()));
      await Promise.allSettled([consumeChannel.close(), collectChannel.close(), publishChannel.close()]);
      await Promise.allSettled([connection.close(), pool.end(), redis.quit()]);
    },
  };
}
