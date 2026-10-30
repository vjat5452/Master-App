import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessFreshness,
  compareCacheKey,
  createFreshnessPolicy,
  dedupKey,
  demandPriority,
  deriveHealth,
  detectChanges,
  invalidateCompareCache,
  normalizeQuery,
  parseFreshnessConfig,
  recordDemand,
  topDemand,
} from '../src/index.js';

function fakeRedis() {
  const zsets = new Map();
  const strings = new Map();
  return {
    zsets,
    strings,
    async zincrby(key, by, member) {
      const z = zsets.get(key) ?? new Map();
      z.set(member, (z.get(member) ?? 0) + by);
      zsets.set(key, z);
    },
    async expire() {},
    async zrevrange(key) {
      const z = [...(zsets.get(key) ?? new Map())].sort((a, b) => b[1] - a[1]);
      return z.flatMap(([m, s]) => [m, String(s)]);
    },
    async scan(_cursor, _match, pattern) {
      const prefix = pattern.replace(/\*$/, '');
      return ['0', [...strings.keys()].filter((k) => k.startsWith(prefix))];
    },
    async del(...keys) {
      keys.forEach((k) => strings.delete(k));
      return keys.length;
    },
  };
}

test('freshness overrides are validated and applied per source', () => {
  assert.deepEqual(parseFreshnessConfig(''), {});
  assert.throws(() => parseFreshnessConfig('{nope'), /valid JSON/);
  assert.throws(() => parseFreshnessConfig('{"acme":{"price":{"freshSeconds":900,"expireSeconds":60}}}'), /freshSeconds must not exceed/);
  assert.throws(() => parseFreshnessConfig('{"acme":{"minRefreshSeconds":5}}'), /minRefreshSeconds/);

  const policy = createFreshnessPolicy(parseFreshnessConfig('{"acme":{"availability":{"freshSeconds":60,"expireSeconds":600},"minRefreshSeconds":1800}}'));
  assert.equal(policy.minRefreshSeconds('acme'), 1800);
  assert.equal(policy.minRefreshSeconds('other'), 900);

  const now = Date.parse('2026-10-29T12:00:00Z');
  const twoMinutesOld = { sourceType: 'EXTERNAL', collectedAt: '2026-10-29T11:58:00Z' };
  assert.equal(assessFreshness({ ...twoMinutesOld, sourceCode: 'acme' }, { now, policy }).fields.availability, 'STALE');
  assert.equal(assessFreshness({ ...twoMinutesOld, sourceCode: 'other' }, { now, policy }).fields.availability, 'FRESH');
});

test('change detection compares price fields and availability, not first sightings', () => {
  const price = (item, mrp = 5600) => ({ itemPriceMinor: item, mrpMinor: mrp, currency: 'INR' });
  assert.deepEqual(detectChanges({}, { price: price(5400), availability: 'IN_STOCK' }), []);
  assert.deepEqual(detectChanges({ price: price(5400), availability: 'IN_STOCK' }, { price: price(5400), availability: 'IN_STOCK' }), []);
  assert.deepEqual(
    detectChanges({ price: price(5400), availability: 'IN_STOCK' }, { price: price(5200), availability: 'OUT_OF_STOCK' }).map((c) => c.entityType),
    ['PRICE', 'AVAILABILITY'],
  );
  assert.equal(detectChanges({ price: price(5400, 5600) }, { price: price(5400, 5800) })[0].entityType, 'PRICE', 'an MRP change is a price change');
  assert.deepEqual(detectChanges({ price: price(5400) }, { price: null }), [], 'a dropped price is not a price change');
});

test('health combines the connector check with recent runs', () => {
  assert.equal(deriveHealth({ health: 'NOT_CONFIGURED' }, { total: 0, errorRate: 0 }), 'NOT_CONFIGURED');
  assert.equal(deriveHealth({ health: 'DOWN' }, { total: 10, errorRate: 0 }), 'DOWN');
  assert.equal(deriveHealth({ health: 'HEALTHY' }, { total: 4, errorRate: 1 }), 'DOWN');
  assert.equal(deriveHealth({ health: 'HEALTHY' }, { total: 4, errorRate: 0.5 }), 'DEGRADED');
  assert.equal(deriveHealth({ health: 'HEALTHY' }, { total: 2, errorRate: 1 }), 'HEALTHY', 'too few runs to judge');
  assert.equal(deriveHealth({ health: 'UNKNOWN' }, { total: 5, errorRate: 0.2 }), 'HEALTHY');
  assert.equal(deriveHealth({ health: 'UNKNOWN' }, { total: 0, errorRate: 0 }), 'UNKNOWN');
});

test('demand is counted per normalized query and coarse cell, most demanded first', async () => {
  const redis = fakeRedis();
  const now = Date.parse('2026-10-29T12:30:00Z');
  for (let i = 0; i < 3; i++) await recordDemand(redis, { query: 'Amul  Milk ', cell: 'ttnfv2', now });
  await recordDemand(redis, { query: 'bread', cell: 'ttnfv2', now: now - 3600_000 });
  await recordDemand(redis, { query: 'amul milk', cell: 'ttnfx9', now });
  const top = await topDemand(redis, { now });
  assert.deepEqual(top, [
    { query: 'amul milk', cell: 'ttnfv2', count: 3 },
    { query: 'amul milk', cell: 'ttnfx9', count: 1 },
    { query: 'bread', cell: 'ttnfv2', count: 1 },
  ]);
  assert.ok([...redis.zsets.keys()].every((k) => /^external:demand:2026-10-29T1[12]$/.test(k)));
  assert.deepEqual(await topDemand(redis, { now, hours: 1 }).then((t) => t.map((d) => d.query)), ['amul milk', 'amul milk']);
  assert.equal(normalizeQuery('  Amul   MILK '), 'amul milk');
});

test('job keys and priorities', () => {
  assert.equal(dedupKey('s', 'ttnfv2', 'amul milk'), dedupKey('s', 'ttnfv2', 'amul milk'));
  assert.notEqual(dedupKey('s', 'ttnfv2', 'amul milk'), dedupKey('s', 'ttnfx9', 'amul milk'));
  assert.deepEqual([1, 3, 10, 1000].map(demandPriority), [1, 2, 4, 9]);
});

test('cache invalidation removes only that source and cell', async () => {
  const redis = fakeRedis();
  for (const k of [compareCacheKey('a', 'ttnfv2', 'milk'), compareCacheKey('a', 'ttnfv2', 'bread'), compareCacheKey('a', 'ttnfx9', 'milk'), compareCacheKey('b', 'ttnfv2', 'milk')]) {
    redis.strings.set(k, '{}');
  }
  assert.equal(await invalidateCompareCache(redis, 'a', 'ttnfv2'), 2);
  assert.deepEqual([...redis.strings.keys()], [compareCacheKey('a', 'ttnfx9', 'milk'), compareCacheKey('b', 'ttnfv2', 'milk')]);
  assert.equal(compareCacheKey('a', 'ttnfv2', 'Milk '), compareCacheKey('a', 'ttnfv2', 'milk'), 'keys use the normalized query');
});
