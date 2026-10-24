import { Redis } from 'ioredis';

// Redis is a cache and rate-limit store only. Commands fail fast while disconnected so callers
// can fall back to PostgreSQL instead of queueing requests.
export function createRedis(url, logger) {
  const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false });
  let lastWarning = 0;
  redis.on('error', (err) => {
    if (Date.now() - lastWarning > 30_000) {
      lastWarning = Date.now();
      logger.warn('redis error', { err });
    }
  });
  return redis;
}

export const SEARCH_VERSION_KEY = 'search:version';
