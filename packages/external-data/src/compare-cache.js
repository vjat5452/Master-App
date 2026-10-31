// Latest answer per source, query and cell; keyed by the coarse cell, never by coordinates.
import { createHash } from 'node:crypto';
import { normalizeQuery } from './demand.js';

const PREFIX = 'compare:src';
export const CACHE_TTL_SECONDS = 3600;

export const compareCacheKey = (sourceCode, cell, query) =>
  `${PREFIX}:${sourceCode}:${cell}:${createHash('sha1').update(normalizeQuery(query)).digest('hex')}`;

export const compareCachePattern = (sourceCode, cell) => `${PREFIX}:${sourceCode}:${cell}:*`;

export async function readCompareCache(redis, key) {
  const hit = await redis.get(key);
  return hit ? JSON.parse(hit) : null;
}

export function writeCompareCache(redis, key, { collectedAt, items }) {
  return redis.set(key, JSON.stringify({ collectedAt, items }), 'EX', CACHE_TTL_SECONDS);
}

// Bounded SCAN; returns the number of keys removed.
export async function invalidateCompareCache(redis, sourceCode, cell, { maxKeys = 1000 } = {}) {
  let cursor = '0';
  let removed = 0;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', compareCachePattern(sourceCode, cell), 'COUNT', 200);
    cursor = next;
    if (keys.length) removed += await redis.del(...keys);
  } while (cursor !== '0' && removed < maxKeys);
  return removed;
}
