import amqp from 'amqplib';
import { Redis } from 'ioredis';
import { createPool } from '@localstock/database';
import { createLogger } from '@localstock/logger';
import { loadConfig } from './config.js';
import { buildConnectorRegistry } from '@localstock/connectors';
import { createCollector, createFreshnessPolicy, createHealthJob, createRefreshScheduler, createSourceRegistry } from '@localstock/external-data';
import { createJobPublisher, runCollectionConsumer } from './consumers/external-collection.js';
import { createExternalChangeHandler, createSearchProjectionHandler, handleNotification } from './consumers/handlers.js';
import { runConsumer } from './consumers/run-consumer.js';
import { createOutboxPublisher } from './jobs/outbox-publisher.js';
import { createReconciliationJob } from './jobs/reconciliation.js';
import { createReservationExpiryJob } from './jobs/reservation-expiry.js';
import { every } from './jobs/scheduler.js';
import { assertTopology, QUEUES } from './messaging/topology.js';

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, base: { service: 'worker' } });

async function connectWithRetry(url, attempts = 30) {
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

const pool = createPool(config.DATABASE_URL, { max: 5 });
pool.on('error', (err) => logger.error('idle postgres client error', { err }));
const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 3 });
redis.on('error', (err) => logger.warn('redis error', { err: err.message }));

const connection = await connectWithRetry(config.RABBITMQ_URL);
let shuttingDown = false;
// Without a broker connection the worker cannot do its job; exit and let the supervisor restart it.
connection.on('close', () => {
  if (!shuttingDown) {
    logger.error('rabbitmq connection closed unexpectedly');
    process.exit(1);
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
await runCollectionConsumer({ channel: collectChannel, queue: QUEUES.externalCollection.name, collector, logger });
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
];
logger.info('worker started', { queues: Object.values(QUEUES).map((q) => q.name) });

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info('shutting down', { signal });
  setTimeout(() => process.exit(1), 15_000).unref();
  await Promise.allSettled(jobs.map((j) => j.stop()));
  await Promise.allSettled([consumeChannel.close(), collectChannel.close(), publishChannel.close()]);
  await Promise.allSettled([connection.close(), pool.end(), redis.quit()]);
  logger.info('shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
