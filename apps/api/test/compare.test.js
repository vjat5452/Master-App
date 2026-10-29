// Comparison API with stubbed sources: no database, Redis or network needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { buildConnectorRegistry, ConnectorError, DemoFixtureConnector, ERROR_CODES } from '@localstock/connectors';
import { createLogger } from '@localstock/logger';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { createCompareService, externalResult } from '../src/modules/discovery/compare.service.js';
import { assessFreshness, fieldFreshness } from '@localstock/external-data';
import { splitQuery } from '../src/modules/discovery/local-vendor-source.js';

const config = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret',
  COMPARE_DEADLINE_MS: '300',
});
const logger = createLogger({ level: 'silent' });
const LOCATION = { latitude: 28.6129, longitude: 77.2295 };

function memoryRedis() {
  const store = new Map();
  return {
    get: async (k) => store.get(k) ?? null,
    set: async (k, v) => store.set(k, v),
    incr: async () => 1,
    expire: async () => 1,
    ping: async () => 'PONG',
    store,
  };
}

const listing = (overrides = {}) => ({
  externalListingId: 'L1',
  title: 'Amul Taaza Toned Milk',
  brand: 'Amul',
  variantText: '1 l',
  gtin: '8901262150064',
  imageUrl: null,
  deepLink: null,
  price: {
    itemPriceMinor: 5400,
    mrpMinor: 5600,
    currency: 'INR',
    taxInclusive: null,
    deliveryFeeMinor: 2500,
    platformFeeMinor: null,
    handlingFeeMinor: 400,
    otherFeeMinor: null,
    totalCostCompleteness: 'PARTIAL',
  },
  availability: 'IN_STOCK',
  eta: null,
  fulfillmentNode: null,
  sourceObservedAt: null,
  collectedAt: new Date().toISOString(),
  ...overrides,
});

/** A configured fake source; `search` decides what it answers. */
function stubSource(code, search, { platformCode = code, isDemo = false } = {}) {
  const source = {
    code,
    name: `Source ${code}`,
    platformCode,
    accessType: 'LICENSED_PROVIDER',
    isDemo,
    capabilities: { product_search: 'SUPPORTED' },
    calls: 0,
    validateConfiguration: () => ({ ok: true }),
    async searchProducts(...args) {
      source.calls += 1;
      return search(...args);
    },
  };
  return source;
}

const registryOf = (...sources) => ({ list: () => sources });
const emptyLocal = { search: async () => [] };

function service({ sources, local = emptyLocal, redis = memoryRedis() }) {
  return createCompareService({ pool: null, redis, logger, connectors: registryOf(...sources), config, localSource: local });
}

const request_ = (overrides = {}) => ({
  query: 'amul milk',
  location: LOCATION,
  radiusKm: 5,
  includeLocalVendors: true,
  refreshPolicy: 'prefer_fresh',
  limit: 20,
  ...overrides,
});

test('a slow source times out without failing the request', async () => {
  const fast = stubSource('fast', async () => ({ items: [listing()], queryCell: 'ttnfv2' }));
  const slow = stubSource('slow', () => new Promise(() => {}));
  const started = Date.now();
  const out = await service({ sources: [fast, slow] }).compare(request_());
  assert.ok(Date.now() - started < 2000);
  const bySource = Object.fromEntries(out.sources.map((s) => [s.sourceId, s]));
  assert.equal(bySource.fast.status, 'RESPONDED');
  assert.equal(bySource.slow.status, 'FAILED');
  assert.equal(bySource.slow.error.code, ERROR_CODES.TIMEOUT);
  assert.equal(out.results.length, 1);
  assert.deepEqual(out.sourceSummary, { requested: 3, responded: 2, failed: 1, notConfigured: 0, unsupported: 0, notCached: 0 });
});

test('a failing source is reported as failed, never turned into out-of-stock results', async () => {
  const broken = stubSource('broken', async () => {
    throw new ConnectorError(ERROR_CODES.UPSTREAM_ERROR, 'provider error (503)');
  });
  const fetchFailed = stubSource('partial', async () => ({ items: [listing({ availability: 'FETCH_FAILED', price: null })], queryCell: 'ttnfv2' }));
  const out = await service({ sources: [broken, fetchFailed] }).compare(request_());
  const failed = out.sources.find((s) => s.sourceId === 'broken');
  assert.deepEqual(failed.error, { code: 'UPSTREAM_ERROR', message: 'provider error (503)' });
  assert.equal(out.results.filter((r) => r.sourceId === 'broken').length, 0);
  assert.equal(out.results[0].availability, 'FETCH_FAILED');
  assert.equal(out.results.some((r) => r.availability === 'OUT_OF_STOCK'), false);
});

test('unexpected errors are not leaked to clients', async () => {
  const buggy = stubSource('buggy', async () => {
    throw new Error('connection string postgres://secret@host');
  });
  const out = await service({ sources: [buggy] }).compare(request_());
  assert.deepEqual(out.sources.find((s) => s.sourceId === 'buggy').error, { code: 'UPSTREAM_ERROR', message: 'The source could not be queried' });
});

test('disabled platforms are counted as not configured and never called', async () => {
  const registry = buildConnectorRegistry({ env: {} });
  const out = await createCompareService({ pool: null, redis: memoryRedis(), logger, connectors: registry, config, localSource: emptyLocal }).compare(request_());
  assert.deepEqual(out.sourceSummary, { requested: 7, responded: 1, failed: 0, notConfigured: 6, unsupported: 0, notCached: 0 });
  assert.ok(out.sources.filter((s) => s.status === 'NOT_CONFIGURED').every((s) => /docs\/platforms/.test(s.message)));
  assert.deepEqual(out.results, []);
});

test('distance is only computed from source-provided coordinates; unknown stays null', () => {
  const connector = { code: 'x', name: 'X', platformCode: 'x', accessType: 'LICENSED_PROVIDER', isDemo: false };
  const loc = { lat: 28.6129, lng: 77.2295 };
  const noNode = externalResult(connector, listing(), { location: loc, now: Date.now() });
  assert.deepEqual(noNode.distance, { km: null, status: 'UNKNOWN' });
  assert.equal(noNode.fulfillmentNode, null);

  const unlocated = externalResult(connector, listing({ fulfillmentNode: { externalNodeId: 'n1', name: null, lat: null, lng: null, verification: 'UNVERIFIED' } }), { location: loc, now: Date.now() });
  assert.deepEqual(unlocated.distance, { km: null, status: 'UNKNOWN' });

  const located = externalResult(
    connector,
    listing({ fulfillmentNode: { externalNodeId: 'n2', name: 'Store', lat: 28.6229, lng: 77.2295, verification: 'SOURCE_PROVIDED' } }),
    { location: loc, now: Date.now() },
  );
  assert.deepEqual(located.distance, { km: 1.1, status: 'SOURCE_PROVIDED' });
});

test('known totals add only known fees; an unknown total stays null', () => {
  const connector = { code: 'x', name: 'X', platformCode: 'x', accessType: 'LICENSED_PROVIDER', isDemo: false };
  const ctx = { location: { lat: 28.6, lng: 77.2 }, now: Date.now() };
  const partial = externalResult(connector, listing(), ctx);
  assert.equal(partial.price.totalKnownCostMinor, 5400 + 2500 + 400);
  assert.equal(partial.price.totalCostCompleteness, 'PARTIAL');
  const unknown = externalResult(connector, listing({ price: { ...listing().price, deliveryFeeMinor: null, handlingFeeMinor: null, totalCostCompleteness: 'UNKNOWN' } }), ctx);
  assert.equal(unknown.price.totalKnownCostMinor, null);
  assert.deepEqual(unknown.product.packSize, { quantity: 1000, unit: 'ml', count: 1 });
  assert.equal(unknown.matchStatus, 'UNMAPPED');
});

test('results order: available first, then price, unknown prices last', async () => {
  const items = [
    listing({ externalListingId: 'oos', availability: 'OUT_OF_STOCK' }),
    listing({ externalListingId: 'cheap', price: { ...listing().price, itemPriceMinor: 5000 } }),
    listing({ externalListingId: 'noprice', availability: 'UNKNOWN', price: null }),
    listing({ externalListingId: 'dear', price: { ...listing().price, itemPriceMinor: 6000 } }),
  ];
  const out = await service({ sources: [stubSource('s', async () => ({ items, queryCell: 'ttnfv2' }))] }).compare(request_({ includeLocalVendors: false }));
  assert.deepEqual(out.results.map((r) => r.listingId), ['cheap', 'dear', 'noprice', 'oos']);
});

test('the requested pack size ranks first, and other sizes are labelled DIFFERENT', async () => {
  const items = [
    listing({ externalListingId: 'half', variantText: '500 ml', price: { ...listing().price, itemPriceMinor: 2700 } }),
    listing({ externalListingId: 'litre', variantText: '1 l' }),
    listing({ externalListingId: 'odd', variantText: 'family pack', price: { ...listing().price, itemPriceMinor: 2000, mrpMinor: null } }),
    listing({ externalListingId: 'ml1000', variantText: '1000 ml', price: { ...listing().price, itemPriceMinor: 5500 } }),
  ];
  const out = await service({ sources: [stubSource('s', async () => ({ items, queryCell: 'ttnfv2' }))] }).compare(
    request_({ query: 'amul toned milk 1 litre', includeLocalVendors: false }),
  );
  assert.deepEqual(out.results.map((r) => [r.listingId, r.sizeMatch]), [
    ['litre', 'EXACT'],
    ['ml1000', 'EXACT'],
    ['odd', 'UNKNOWN'],
    ['half', 'DIFFERENT'],
  ]);
  assert.deepEqual(out.requestedPackSize, { quantity: 1000, unit: 'ml', count: 1 });
  assert.match(out.notices.join(' '), /different pack size/);

  const noSize = await service({ sources: [stubSource('s', async () => ({ items, queryCell: 'ttnfv2' }))] }).compare(request_({ includeLocalVendors: false }));
  assert.ok(noSize.results.every((r) => r.sizeMatch === 'NOT_REQUESTED'));
  assert.equal(noSize.results[0].listingId, 'odd', 'without a size, cheapest first');
});

test('the demo source finds a product when the query includes a size', async () => {
  const demo = new DemoFixtureConnector({ env: {} });
  const out = await createCompareService({ pool: null, redis: memoryRedis(), logger, connectors: registryOf(demo), config, localSource: emptyLocal }).compare(
    request_({ query: 'Amul taaza toned milk 1 litre', includeLocalVendors: false }),
  );
  assert.deepEqual(out.results.map((r) => [r.product.variant, r.sizeMatch]), [
    ['1 l', 'EXACT'],
    ['500 ml', 'DIFFERENT'],
  ]);
});

test('refresh policies: prefer_fresh reuses a recent answer, cache_only never calls, refresh_supported always calls', async () => {
  const redis = memoryRedis();
  const s = stubSource('s', async () => ({ items: [listing()], queryCell: 'ttnfv2' }));
  const svc = service({ sources: [s], redis });
  const onlyCache = await service({ sources: [s], redis: memoryRedis() }).compare(request_({ refreshPolicy: 'cache_only' }));
  assert.equal(onlyCache.sources.find((x) => x.sourceId === 's').status, 'NOT_CACHED');
  assert.equal(s.calls, 0);

  await svc.compare(request_());
  await new Promise((r) => setImmediate(r)); // let the cache write land
  const second = await svc.compare(request_());
  assert.equal(s.calls, 1, 'second prefer_fresh request is served from cache');
  assert.equal(second.sources.find((x) => x.sourceId === 's').fromCache, true);
  assert.equal(second.results.length, 1);

  const cached = await svc.compare(request_({ refreshPolicy: 'cache_only' }));
  assert.equal(cached.sources.find((x) => x.sourceId === 's').status, 'RESPONDED');
  assert.equal(s.calls, 1);

  await svc.compare(request_({ refreshPolicy: 'refresh_supported' }));
  assert.equal(s.calls, 2);

  // The cache key holds the coarse cell, not coordinates.
  assert.ok([...redis.store.keys()].every((k) => k.includes(':ttnfv2:') && !k.includes('28.6')));
});

test('demo fixture results are labelled and never fresh', async () => {
  const demo = new DemoFixtureConnector({ env: {} });
  const out = await createCompareService({ pool: null, redis: memoryRedis(), logger, connectors: registryOf(demo), config, localSource: emptyLocal }).compare(
    request_({ query: 'amul taaza toned milk 1 l', includeLocalVendors: false }),
  );
  assert.ok(out.results.length >= 1);
  for (const r of out.results) {
    assert.equal(r.dataProvenance.isDemo, true);
    assert.equal(r.freshness.status, 'UNVERIFIED');
    assert.equal(r.distance.status, 'UNKNOWN');
  }
  assert.match(out.notices.join(' '), /demo fixture data/);
});

test('local vendor failure is isolated too', async () => {
  const brokenLocal = {
    search: async () => {
      throw new Error('db down');
    },
  };
  const out = await service({ sources: [stubSource('s', async () => ({ items: [listing()], queryCell: 'ttnfv2' }))], local: brokenLocal }).compare(request_());
  assert.equal(out.sources[0].sourceType, 'LOCAL_VENDOR');
  assert.equal(out.sources[0].status, 'FAILED');
  assert.equal(out.results.length, 1);
});

// ---------------------------------------------------------------- HTTP

function makeApp(connectors) {
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  return createApp({ config, logger, pool, redis: memoryRedis(), state: { shuttingDown: false }, connectors });
}

test('POST /discovery/compare validates the request', async () => {
  const app = makeApp();
  const missing = await request(app).post('/api/v1/discovery/compare').send({ query: 'milk' });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.error.code, 'VALIDATION_FAILED');
  const badPlatform = await request(app).post('/api/v1/discovery/compare').send({ query: 'milk', location: LOCATION, platforms: ['myntra'] });
  assert.equal(badPlatform.status, 400);
  assert.equal(badPlatform.body.error.code, 'UNKNOWN_PLATFORM');
  const badPolicy = await request(app).post('/api/v1/discovery/compare').send({ query: 'milk', location: LOCATION, refreshPolicy: 'always' });
  assert.equal(badPolicy.status, 400);
});

test('POST /discovery/compare answers with every source accounted for and no exact coordinates', async () => {
  const res = await request(makeApp()).post('/api/v1/discovery/compare').set('x-request-id', 'req-compare-1').send({ query: 'amul milk 1 litre', location: LOCATION, platforms: ['blinkit', 'zepto'] });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.requestId, 'req-compare-1');
  assert.deepEqual(res.body.location, { cell: 'ttnfv2', radiusKm: 5 });
  assert.deepEqual(res.body.sources.map((s) => [s.sourceId, s.status]), [
    ['localstock', 'RESPONDED'],
    ['blinkit-official', 'NOT_CONFIGURED'],
    ['zepto-official', 'NOT_CONFIGURED'],
  ]);
  assert.doesNotMatch(JSON.stringify(res.body), /28\.6129|77\.2295/);
});

// ---------------------------------------------------------------- helpers

test('query splitting separates the pack size from the search text', () => {
  assert.deepEqual(splitQuery('Amul toned milk 1 litre'), { text: 'Amul toned milk', packSize: { quantity: 1000, unit: 'ml', count: 1 } });
  assert.deepEqual(splitQuery('maggi 6 x 70 g noodles'), { text: 'maggi noodles', packSize: { quantity: 70, unit: 'g', count: 6 } });
  assert.deepEqual(splitQuery('bread'), { text: 'bread', packSize: null });
  assert.deepEqual(splitQuery('7up'), { text: '7up', packSize: null });
});

test('freshness: fresh, stale, expired, and unverified for demo or missing times', () => {
  const now = Date.parse('2026-10-29T12:00:00Z');
  const rule = { freshSeconds: 300, expireSeconds: 3600 };
  assert.equal(fieldFreshness('2026-10-29T11:58:00Z', rule, now), 'FRESH');
  assert.equal(fieldFreshness('2026-10-29T11:30:00Z', rule, now), 'STALE');
  assert.equal(fieldFreshness('2026-10-29T10:00:00Z', rule, now), 'EXPIRED');
  assert.equal(fieldFreshness(null, rule, now), 'UNVERIFIED');

  // Availability (5 min) goes stale before price (15 min).
  const tenMinutesOld = assessFreshness({ sourceType: 'EXTERNAL', collectedAt: '2026-10-29T11:50:00Z' }, { now });
  assert.deepEqual(tenMinutesOld.fields, { price: 'FRESH', availability: 'STALE' });
  assert.equal(tenMinutesOld.status, 'STALE');
  assert.equal(tenMinutesOld.basis, 'COLLECTED_AT');
  assert.equal(tenMinutesOld.ageSeconds, 600);

  const sourceTime = assessFreshness({ sourceType: 'EXTERNAL', sourceObservedAt: '2026-10-29T11:59:00Z', collectedAt: '2026-10-29T12:00:00Z' }, { now });
  assert.equal(sourceTime.basis, 'SOURCE_OBSERVED_AT');
  assert.equal(assessFreshness({ sourceType: 'EXTERNAL', isDemo: true, collectedAt: '2026-10-29T12:00:00Z' }, { now }).status, 'UNVERIFIED');
});
