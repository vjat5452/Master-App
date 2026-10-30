// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
// The background collection pipeline against the isolated *_test database, with a stub
// source: demand -> scheduled job -> collector -> observations, changes, outbox, cache.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { ConnectorError, ERROR_CODES, NotConfiguredConnector } from '@localstock/connectors';
import { prepareTestDatabase, testDatabaseUrl } from '@localstock/database/test-support';
import {
  compareCacheKey,
  createCollector,
  createFreshnessPolicy,
  createHealthJob,
  createRefreshScheduler,
  createSourceRegistry,
  readCompareCache,
  recordDemand,
} from '../src/index.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const enabled = process.env.RUN_DB_TESTS === '1' && Boolean(testDatabaseUrl());
const skip = !enabled && 'set RUN_DB_TESTS=1';
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const CELL = 'ttnfv2';
const QUERY = 'zorbo milk';

function memoryRedis() {
  const strings = new Map();
  const zsets = new Map();
  return {
    get: async (k) => strings.get(k) ?? null,
    set: async (k, v) => strings.set(k, v),
    async zincrby(key, by, member) {
      const z = zsets.get(key) ?? new Map();
      z.set(member, (z.get(member) ?? 0) + by);
      zsets.set(key, z);
    },
    expire: async () => 1,
    async zrevrange(key) {
      return [...(zsets.get(key) ?? new Map())].sort((a, b) => b[1] - a[1]).flatMap(([m, s]) => [m, String(s)]);
    },
  };
}

// A configured stub source whose answers the tests control.
const stub = {
  code: 'stub-source',
  name: 'Stub Source',
  platformCode: 'blinkit',
  accessType: 'LICENSED_PROVIDER',
  isDemo: false,
  capabilities: { product_search: 'SUPPORTED', serviceability: 'SUPPORTED' },
  answer: null,
  locations: [],
  validateConfiguration: () => ({ ok: true }),
  async healthCheck() {
    return { health: 'UNKNOWN', circuitState: 'CLOSED' };
  },
  async searchProducts(_query, location) {
    stub.locations.push(location);
    if (stub.answer instanceof Error) throw stub.answer;
    return { items: stub.answer, queryCell: CELL };
  },
  async resolveServiceability() {
    return { status: 'SERVICEABLE', eta: { minMinutes: 10, maxMinutes: 20, provenance: 'stub' }, deliveryFeeMinor: 2500, currency: 'INR', fulfillmentNode: null, sourceObservedAt: null, collectedAt: new Date().toISOString() };
  },
};
const disabled = new NotConfiguredConnector({ code: 'zepto-official', platformCode: 'zepto', name: 'Zepto', accessType: 'OFFICIAL_API', missing: ['access'], reason: 'not configured' });

const listing = (priceMinor, availability = 'IN_STOCK') => ({
  externalListingId: 'zl-1',
  title: 'Zorbo Toned Milk',
  brand: 'Zorbo',
  variantText: '1 l',
  gtin: null,
  imageUrl: null,
  deepLink: null,
  price: { itemPriceMinor: priceMinor, mrpMinor: 6000, currency: 'INR', taxInclusive: null, deliveryFeeMinor: 2500, platformFeeMinor: null, handlingFeeMinor: null, otherFeeMinor: null, totalCostCompleteness: 'PARTIAL' },
  availability,
  eta: null,
  fulfillmentNode: null,
  sourceObservedAt: null,
  collectedAt: new Date().toISOString(),
});

let pool;
let redis;
let scheduler;
let collector;
const published = [];
const connectors = { list: () => [stub, disabled], get: (code) => [stub, disabled].find((c) => c.code === code) };

before(async () => {
  if (!enabled) return;
  pool = await prepareTestDatabase({ max: 5 });
  redis = memoryRedis();
  const sources = createSourceRegistry({ pool });
  collector = createCollector({ pool, redis, connectors, logger: silent, sources });
  scheduler = createRefreshScheduler({
    pool,
    redis,
    connectors,
    sources,
    logger: silent,
    policy: createFreshnessPolicy({ 'stub-source': { minRefreshSeconds: 600 } }),
    publish: async (jobId, priority) => published.push({ jobId, priority }),
  });
});

after(async () => {
  await pool?.end();
});

const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);

test('demand becomes one queued job per source, never duplicated', { skip }, async () => {
  for (let i = 0; i < 3; i++) await recordDemand(redis, { query: 'Zorbo  Milk', cell: CELL });
  const first = await scheduler.tick();
  assert.equal(first.scheduled, 1, 'only the configured source gets a job');
  assert.equal(first.queued, 1);
  assert.equal(published.length, 1);
  assert.equal(published[0].priority, 2);
  const job = await one('SELECT status, job_type, query_cell, search_query FROM external_collection_jobs WHERE id = $1', [published[0].jobId]);
  assert.deepEqual(job, { status: 'QUEUED', job_type: 'SEARCH', query_cell: CELL, search_query: QUERY });

  const second = await scheduler.tick();
  assert.deepEqual(second, { scheduled: 0, queued: 0, recovered: 0 }, 'an open job blocks a duplicate');
});

test('the collector stores listings and observations, refreshes the cache, and is idempotent', { skip }, async () => {
  stub.answer = [listing(5400)];
  const jobId = published[0].jobId;
  const result = await collector.runJob(jobId);
  assert.equal(result.status, 'SUCCEEDED', JSON.stringify(result));
  assert.equal(result.items, 1);
  assert.equal(result.changes, 0, 'a first observation is not a change');

  // Queried at the cell centre, not at anyone's coordinates.
  assert.equal(stub.locations.length, 1);
  assert.ok(Math.abs(stub.locations[0].lat - 28.6129) < 0.01 && Math.abs(stub.locations[0].lng - 77.2295) < 0.01);

  const run = await one(`SELECT status, items_received, items_valid, observations_written, error_code FROM external_collection_runs WHERE job_id = $1`, [jobId]);
  assert.deepEqual(run, { status: 'SUCCEEDED', items_received: 1, items_valid: 1, observations_written: 3, error_code: null });
  const price = await one(`SELECT item_price_minor, query_cell, total_cost_completeness FROM external_price_observations`);
  assert.deepEqual(price, { item_price_minor: 5400, query_cell: CELL, total_cost_completeness: 'PARTIAL' });
  const served = await one(`SELECT status, eta_min_minutes, eta_max_minutes FROM external_serviceability_observations`);
  assert.deepEqual(served, { status: 'SERVICEABLE', eta_min_minutes: 10, eta_max_minutes: 20 });

  const cached = await readCompareCache(redis, compareCacheKey('stub-source', CELL, QUERY));
  assert.equal(cached.items[0].externalListingId, 'zl-1');

  assert.deepEqual(await collector.runJob(jobId), { status: 'SKIPPED' }, 'a redelivered job does nothing');
  assert.equal(stub.locations.length, 1);

  const tick = await scheduler.tick();
  assert.equal(tick.scheduled, 0, 'within the permitted cadence nothing is scheduled again');
});

test('a changed price and availability become change events with outbox events', { skip }, async () => {
  // Pretend the cadence has passed.
  await pool.query(`UPDATE external_collection_jobs SET updated_at = now() - interval '1 hour'`);
  const tick = await scheduler.tick();
  assert.equal(tick.scheduled, 1);
  stub.answer = [listing(5200, 'OUT_OF_STOCK')];
  const result = await collector.runJob(published.at(-1).jobId);
  assert.equal(result.changes, 2);

  const { rows: changes } = await pool.query(`SELECT entity_type, old_value, new_value, query_cell, outbox_event_id FROM external_change_events ORDER BY id`);
  assert.deepEqual(changes.map((c) => c.entity_type), ['PRICE', 'AVAILABILITY']);
  assert.equal(changes[0].old_value.itemPriceMinor, 5400);
  assert.equal(changes[0].new_value.itemPriceMinor, 5200);
  assert.deepEqual(changes[1].new_value, { status: 'OUT_OF_STOCK' });
  assert.ok(changes.every((c) => c.outbox_event_id && c.query_cell === CELL));

  const { rows: outbox } = await pool.query(`SELECT aggregate_type, event_type, payload FROM outbox_events WHERE aggregate_type LIKE 'external_%' ORDER BY created_at`);
  assert.deepEqual(outbox.map((o) => `${o.aggregate_type}.${o.event_type}`), ['external_price.PriceChanged', 'external_availability.AvailabilityChanged']);
  assert.equal(outbox[0].payload.schemaVersion, 1);
  assert.equal(outbox[0].payload.sourceCode, 'stub-source');
  assert.equal(outbox[0].payload.cell, CELL);
});

test('failures are recorded; retryable ones are rescheduled with backoff, others fail', { skip }, async () => {
  await pool.query(`UPDATE external_collection_jobs SET updated_at = now() - interval '1 hour'`);
  await scheduler.tick();
  const jobId = published.at(-1).jobId;
  stub.answer = new ConnectorError(ERROR_CODES.UPSTREAM_ERROR, 'provider error (503)');
  assert.deepEqual(await collector.runJob(jobId), { status: 'FAILED', source: 'stub-source', errorCode: 'UPSTREAM_ERROR', willRetry: true });
  const retrying = await one(`SELECT status, attempts, last_error_code, scheduled_for > now() AS later FROM external_collection_jobs WHERE id = $1`, [jobId]);
  assert.deepEqual(retrying, { status: 'PENDING', attempts: 1, last_error_code: 'UPSTREAM_ERROR', later: true });
  const run = await one(`SELECT status, error_code, error_message FROM external_collection_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT 1`, [jobId]);
  assert.deepEqual(run, { status: 'FAILED', error_code: 'UPSTREAM_ERROR', error_message: 'provider error (503)' });
  const failedEvent = await one(`SELECT payload FROM outbox_events WHERE event_type = 'CollectionFailed' AND aggregate_id = $1`, [jobId]);
  assert.equal(failedEvent.payload.willRetry, true);

  await pool.query(`UPDATE external_collection_jobs SET status = 'QUEUED' WHERE id = $1`, [jobId]);
  stub.answer = new ConnectorError(ERROR_CODES.INVALID_RESPONSE, 'response failed validation');
  assert.deepEqual(await collector.runJob(jobId), { status: 'FAILED', source: 'stub-source', errorCode: 'INVALID_RESPONSE', willRetry: false });
  assert.equal((await one('SELECT status FROM external_collection_jobs WHERE id = $1', [jobId])).status, 'FAILED');
});

test('a job for a source that is no longer configured fails without calling anything', { skip }, async () => {
  const { sourceId } = await createSourceRegistry({ pool }).ensure(disabled);
  const job = await one(
    `INSERT INTO external_collection_jobs (source_id, job_type, query_cell, search_query, dedup_key, status) VALUES ($1, 'SEARCH', $2, 'x', 'manual-1', 'QUEUED') RETURNING id`,
    [sourceId, CELL],
  );
  const calls = stub.locations.length;
  assert.deepEqual(await collector.runJob(job.id), { status: 'FAILED', source: 'zepto-official', errorCode: 'SOURCE_NOT_CONFIGURED', willRetry: false });
  assert.equal(stub.locations.length, calls);
});

test('stuck RUNNING jobs are handed back to the queue', { skip }, async () => {
  const stuck = await one(
    `INSERT INTO external_collection_jobs (source_id, job_type, query_cell, search_query, dedup_key, status, updated_at)
     SELECT id, 'SEARCH', $1, 'stuck', 'stuck-1', 'RUNNING', now() - interval '1 hour' FROM external_sources WHERE code = 'stub-source' RETURNING id`,
    [CELL],
  );
  const tick = await scheduler.tick();
  assert.equal(tick.recovered, 1);
  assert.equal((await one('SELECT status FROM external_collection_jobs WHERE id = $1', [stuck.id])).status, 'QUEUED');
});

test('health is recorded per source; unconfigured sources stay RESEARCH_REQUIRED', { skip }, async () => {
  const check = createHealthJob({ pool, connectors, logger: silent });
  const results = await check();
  assert.deepEqual(Object.fromEntries(results.map((r) => [r.source, r.health])), { 'stub-source': 'DEGRADED', 'zepto-official': 'NOT_CONFIGURED' });

  const rows = (await pool.query(
    `SELECT s.code, s.integration_status, h.health, h.error_rate FROM external_source_health h JOIN external_sources s ON s.id = h.source_id ORDER BY s.code`,
  )).rows;
  assert.deepEqual(rows.map((r) => [r.code, r.integration_status, r.health]), [
    ['stub-source', 'SANDBOX', 'DEGRADED'],
    ['zepto-official', 'RESEARCH_REQUIRED', 'NOT_CONFIGURED'],
  ]);
  assert.ok(Number(rows[0].error_rate) >= 0.5);

  // Recover: successful runs push the error rate down -> a HealthChanged event.
  await pool.query(`UPDATE external_collection_runs SET status = 'SUCCEEDED', error_code = NULL WHERE status = 'FAILED'`);
  await check();
  const change = await one(`SELECT old_value, new_value FROM external_change_events WHERE entity_type = 'SOURCE_HEALTH'`);
  assert.deepEqual(change, { old_value: { health: 'DEGRADED' }, new_value: { health: 'HEALTHY' } });
  const event = await one(`SELECT 1 AS ok FROM outbox_events WHERE aggregate_type = 'external_source' AND event_type = 'HealthChanged'`);
  assert.equal(event.ok, 1);
});

test('collection never touches seller prices or stock', { skip }, async () => {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE entity_type IN ('seller_offer', 'warehouse_inventory')`);
  assert.equal(rows[0].n, 0);
  const offers = await one('SELECT count(*)::int AS n FROM seller_offers');
  assert.equal(offers.n, 0);
});
