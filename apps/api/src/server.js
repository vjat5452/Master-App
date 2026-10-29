import './config/load-env.js';
import { buildConnectorRegistry } from '@localstock/connectors';
import { createPool } from '@localstock/database';
import { createLogger } from '@localstock/logger';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createRedis } from './infrastructure/cache.js';

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, base: { service: 'api' } });

const pool = createPool(config.DATABASE_URL);
pool.on('error', (err) => logger.error('idle postgres client error', { err }));

const redis = createRedis(config.REDIS_URL, logger);
redis.connect().catch((err) => logger.warn('redis unreachable at startup; continuing without cache', { err }));

// External sources from validated environment (all disabled unless configured).
const connectors = buildConnectorRegistry({ env: process.env, logger: logger.child({ component: 'connectors' }) });
logger.info('external sources', { enabled: connectors.enabled().map((c) => c.code), total: connectors.list().length });

const state = { shuttingDown: false };
const app = createApp({ config, logger, pool, redis, state, connectors });
const server = app.listen(config.API_PORT, () => logger.info('api listening', { port: config.API_PORT }));

// Graceful shutdown: fail readiness, stop accepting connections, let in-flight requests finish,
// then close dependencies. A hard deadline prevents hanging forever.
async function shutdown(signal) {
  if (state.shuttingDown) return;
  state.shuttingDown = true;
  logger.info('shutting down', { signal });
  setTimeout(() => {
    logger.error('forced exit after shutdown timeout');
    process.exit(1);
  }, 10_000).unref();

  server.close(async () => {
    await Promise.allSettled([pool.end(), redis.quit()]);
    logger.info('shutdown complete');
    process.exit(0);
  });
  server.closeIdleConnections();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
