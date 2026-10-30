// The latest answer of one source to one query in one location cell, shared by the
// comparison API (which reads and fills it) and the background collector (which refreshes
// it). Keyed by the coarse cell, never by coordinates.
import { createHash } from 'node:crypto';
import { normalizeQuery } from './demand.js';

const PREFIX = 'compare:src';
export const CACHE_TTL_SECONDS = 3600;

export const compareCacheKey = (sourceCode, cell, query) =>
  `${PREFIX}:${sourceCode}:${cell}:${createHash('sha1').update(normalizeQuery(query)).digest('hex')}`;

/** Pattern for every cached answer of a source in a cell (used to invalidate on change). */
export const compareCachePattern = (sourceCode, cell) => `${PREFIX}:${sourceCode}:${cell}:*`;

/** @returns {Promise<{ collectedAt: string, items: object[] } | null>} */
export async function readCompareCache(redis, key) {
  const hit = await redis.get(key);
  return hit ? JSON.parse(hit) : null;
}

export function writeCompareCache(redis, key, { collectedAt, items }) {
  return redis.set(key, JSON.stringify({ collectedAt, items }), 'EX', CACHE_TTL_SECONDS);
}

/** Deletes the cached answers of a source in a cell. Bounded SCAN; returns keys removed. */
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
