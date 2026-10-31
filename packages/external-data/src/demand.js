// Hourly Redis sorted sets of { query, coarse cell } that prioritize background refresh.
// Nothing identifies a customer and exact locations are never recorded.

const PREFIX = 'external:demand';
const BUCKET_TTL_SECONDS = 4 * 3600;

export const normalizeQuery = (query) => query.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200);

const bucketKey = (t) => `${PREFIX}:${new Date(t).toISOString().slice(0, 13)}`; // hour resolution

// Best effort: never fails the caller.
export async function recordDemand(redis, { query, cell, now = Date.now() }) {
  const key = bucketKey(now);
  try {
    await redis.zincrby(key, 1, JSON.stringify({ q: normalizeQuery(query), cell }));
    await redis.expire(key, BUCKET_TTL_SECONDS);
  } catch {
    // Demand is a scheduling hint; losing a count is harmless.
  }
}

export async function topDemand(redis, { hours = 2, limit = 50, now = Date.now() } = {}) {
  const totals = new Map();
  for (let h = 0; h < hours; h++) {
    const entries = await redis.zrevrange(bucketKey(now - h * 3600_000), 0, 499, 'WITHSCORES');
    for (let i = 0; i < entries.length; i += 2) totals.set(entries[i], (totals.get(entries[i]) ?? 0) + Number(entries[i + 1]));
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([member, count]) => {
      const { q, cell } = JSON.parse(member);
      return { query: q, cell, count };
    });
}
