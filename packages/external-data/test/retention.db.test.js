// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { prepareTestDatabase, testDatabaseUrl } from '@localstock/database/test-support';
import { createRetentionJob } from '../src/index.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const enabled = process.env.RUN_DB_TESTS === '1' && Boolean(testDatabaseUrl());
const skip = !enabled && 'set RUN_DB_TESTS=1';
const silent = { debug() {}, info() {}, warn() {}, error() {} };

let pool;
const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
const count = async (table) => (await one(`SELECT count(*)::int AS n FROM ${table}`)).n;

before(async () => {
  if (!enabled) return;
  pool = await prepareTestDatabase({ max: 3 });
});
after(async () => {
  await pool?.end();
});

test('old external data and processed events are deleted; recent, open and referenced rows stay', { skip }, async () => {
  const platform = await one(`INSERT INTO external_platforms (code, name) VALUES ('ret-platform', 'Ret') RETURNING id`);
  const source = await one(`INSERT INTO external_sources (platform_id, code, name, access_type) VALUES ($1, 'ret-source', 'Ret', 'LICENSED_PROVIDER') RETURNING id`, [platform.id]);
  const listing = await one(`INSERT INTO external_listings (platform_id, first_source_id, external_listing_id, title) VALUES ($1, $2, 'r1', 'Milk') RETURNING id`, [platform.id, source.id]);

  const job = (age, status) =>
    one(
      `INSERT INTO external_collection_jobs (source_id, job_type, query_cell, search_query, dedup_key, status, updated_at)
       VALUES ($1, 'SEARCH', 'ttnfv2', 'milk', gen_random_uuid()::text, $2, now() - make_interval(days => $3)) RETURNING id`,
      [source.id, status, age],
    );
  const run = (jobId, age) =>
    one(
      `INSERT INTO external_collection_runs (source_id, job_id, status, started_at, completed_at)
       VALUES ($1, $2, 'SUCCEEDED', now() - make_interval(days => $3), now() - make_interval(days => $3)) RETURNING id`,
      [source.id, jobId, age],
    );
  const price = (runId, age) =>
    pool.query(
      `INSERT INTO external_price_observations (listing_id, source_id, run_id, item_price_minor, currency, collected_at)
       VALUES ($1, $2, $3, 5000, 'INR', now() - make_interval(days => $4))`,
      [listing.id, source.id, runId, age],
    );

  const oldJob = await job(120, 'SUCCEEDED');
  const oldRun = await run(oldJob.id, 120);
  await price(oldRun.id, 120);
  const newJob = await job(1, 'SUCCEEDED');
  const newRun = await run(newJob.id, 1);
  await price(newRun.id, 1);
  await job(120, 'PENDING'); // open jobs are never deleted

  // A recent observation tied to an old run keeps the run (and its job) alive.
  const mixedJob = await job(120, 'FAILED');
  const mixedRun = await run(mixedJob.id, 120);
  await price(mixedRun.id, 2);

  const oldOutbox = await one(`INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload, created_at, published_at)
    VALUES ('PriceChanged', 'external_price', gen_random_uuid(), '{}', now() - interval '60 days', now() - interval '60 days') RETURNING id`);
  await pool.query(`INSERT INTO external_change_events (entity_type, source_id, listing_id, new_value, detected_at, outbox_event_id)
    VALUES ('PRICE', $1, $2, '{}', now() - interval '120 days', $3)`, [source.id, listing.id, oldOutbox.id]);
  const keptOutbox = await one(`INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload, created_at, published_at)
    VALUES ('PriceChanged', 'external_price', gen_random_uuid(), '{}', now() - interval '60 days', now() - interval '60 days') RETURNING id`);
  await pool.query(`INSERT INTO external_change_events (entity_type, source_id, listing_id, new_value, detected_at, outbox_event_id)
    VALUES ('PRICE', $1, $2, '{}', now() - interval '10 days', $3)`, [source.id, listing.id, keptOutbox.id]);
  await pool.query(`INSERT INTO outbox_events (event_type, aggregate_type, aggregate_id, payload, created_at)
    VALUES ('OrderCreated', 'order', gen_random_uuid(), '{}', now() - interval '60 days')`); // unpublished: kept
  await pool.query(`INSERT INTO inbox_events (consumer, message_id, processed_at) VALUES ('c', gen_random_uuid(), now() - interval '40 days'), ('c', gen_random_uuid(), now())`);

  const deleted = await createRetentionJob({ pool, logger: silent, externalDays: 90, eventDays: 30, batch: 1 })();

  assert.deepEqual(deleted, {
    external_change_events: 1,
    external_price_observations: 1,
    external_collection_runs: 1,
    external_collection_jobs: 1,
    outbox_events: 1,
    inbox_events: 1,
  });
  assert.equal(await count('external_price_observations'), 2);
  assert.equal(await count('external_collection_runs'), 2, 'the new run and the old run still referenced');
  assert.equal(await count('external_collection_jobs'), 3, 'new, open and still-referenced jobs');
  assert.equal(await count('external_change_events'), 1);
  assert.equal((await one('SELECT count(*)::int AS n FROM outbox_events WHERE id = $1', [keptOutbox.id])).n, 1, 'outbox rows still referenced are kept');
  assert.equal((await one('SELECT count(*)::int AS n FROM outbox_events WHERE published_at IS NULL')).n, 1);
  assert.equal(await count('inbox_events'), 1);
  assert.equal(await count('external_listings'), 1, 'listings are kept');

  assert.deepEqual(await createRetentionJob({ pool, logger: silent, externalDays: 90, eventDays: 30 })(), {}, 'a second run finds nothing');
});
