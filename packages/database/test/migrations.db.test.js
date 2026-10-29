// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
// Uses a separate *_test database (see ../test-support/isolated-database.js), never the dev data.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { backfillPackSizes, migrate, rollback } from '../src/index.js';
import { prepareTestDatabase, testDatabaseUrl } from '../test-support/isolated-database.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const enabled = process.env.RUN_DB_TESTS === '1' && Boolean(testDatabaseUrl());

const EXTERNAL_TABLES = [
  'external_platforms',
  'external_sources',
  'external_fulfillment_nodes',
  'external_listings',
  'external_product_mappings',
  'external_collection_jobs',
  'external_collection_runs',
  'external_source_health',
  'external_serviceability_observations',
  'external_price_observations',
  'external_availability_observations',
  'external_offer_observations',
  'external_change_events',
];

let pool;

const tables = async () =>
  new Set((await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`)).rows.map((r) => r.tablename));
const columns = async (table) =>
  new Set(
    (await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])).rows.map(
      (r) => r.column_name,
    ),
  );
const applied = async () => (await pool.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name);

async function rejects(sql, params, constraint) {
  await assert.rejects(pool.query(sql, params), (err) => {
    assert.equal(err.code, '23514', `expected a CHECK violation, got ${err.code}: ${err.message}`);
    if (constraint) assert.match(err.constraint ?? '', constraint);
    return true;
  });
}

async function createVariant(attributes) {
  const tag = randomUUID().slice(0, 8);
  const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
  const category = await one(`INSERT INTO categories (name, slug) VALUES ('c', $1) RETURNING id`, [`c-${tag}`]);
  const group = await one(`INSERT INTO product_groups (category_id, name) VALUES ($1, 'g') RETURNING id`, [category.id]);
  return one(
    `INSERT INTO product_variants (group_id, name, attributes, normalized_key) VALUES ($1, 'v', $2, $3) RETURNING id`,
    [group.id, JSON.stringify(attributes), `key-${tag}`],
  );
}

before(async () => {
  if (enabled) pool = await prepareTestDatabase({ max: 4 });
});

after(async () => {
  if (pool) {
    // Leave the test database fully migrated for the other DB tests.
    await migrate(pool);
    await pool.end();
  }
});

test('migrations roll back and re-apply cleanly', { skip: !enabled && 'set RUN_DB_TESTS=1' }, async () => {
  assert.deepEqual((await applied()).slice(0, 4), ['001_init.sql', '002_external_platforms.sql', '003_vendor_extensions.sql', '004_collection_jobs.sql']);

  assert.deepEqual(await rollback(pool, { steps: 3 }), ['004_collection_jobs.sql', '003_vendor_extensions.sql', '002_external_platforms.sql']);
  const afterDown = await tables();
  for (const t of EXTERNAL_TABLES) assert.equal(afterDown.has(t), false, `${t} should be dropped`);
  assert.equal((await columns('seller_offers')).has('mrp_minor'), false);
  assert.equal((await columns('product_variants')).has('pack_quantity'), false);
  assert.equal((await columns('audit_logs')).has('source_of_change'), false);
  assert.deepEqual(await applied(), ['001_init.sql']);

  assert.deepEqual(await migrate(pool), ['002_external_platforms.sql', '003_vendor_extensions.sql', '004_collection_jobs.sql']);
  const afterUp = await tables();
  for (const t of EXTERNAL_TABLES) assert.equal(afterUp.has(t), true, `${t} should exist`);
  assert.equal((await columns('seller_offers')).has('mrp_minor'), true);
  const { rows } = await pool.query('SELECT code FROM external_platforms ORDER BY code');
  assert.deepEqual(rows.map((r) => r.code), ['bigbasket', 'blinkit', 'instamart', 'zepto']);
});

test('the initial migration cannot be rolled back', { skip: !enabled && 'set RUN_DB_TESTS=1' }, async () => {
  await rollback(pool, { steps: 3 });
  try {
    await assert.rejects(rollback(pool, { steps: 1 }), /001_init\.sql has no 001_init\.down\.sql/);
    assert.deepEqual(await applied(), ['001_init.sql']);
  } finally {
    await migrate(pool);
  }
});

test('schema rules for external data hold', { skip: !enabled && 'set RUN_DB_TESTS=1' }, async () => {
  const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
  // prepareTestDatabase empties every table, reference rows included.
  const platform = await one(
    `INSERT INTO external_platforms (code, name) VALUES ('blinkit', 'Blinkit')
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const source = await one(
    `INSERT INTO external_sources (platform_id, code, name, access_type) VALUES ($1, $2, 'Test source', 'OFFICIAL_API') RETURNING id`,
    [platform.id, `test-${randomUUID().slice(0, 8)}`],
  );
  const listing = await one(
    `INSERT INTO external_listings (platform_id, first_source_id, external_listing_id, title) VALUES ($1, $2, 'L1', 'Milk 1 l') RETURNING id`,
    [platform.id, source.id],
  );
  const variant = await createVariant({ volume: '1 l' });

  // Fuzzy similarity may only propose a mapping.
  await rejects(
    `INSERT INTO external_product_mappings (listing_id, variant_id, match_method, match_confidence, match_status)
     VALUES ($1, $2, 'FUZZY_CANDIDATE', 0.9, 'AUTO_CONFIRMED')`,
    [listing.id, variant.id],
  );
  // A reviewer confirmation needs a reviewer.
  await rejects(
    `INSERT INTO external_product_mappings (listing_id, variant_id, match_method, match_confidence, match_status)
     VALUES ($1, $2, 'MANUAL', 1, 'CONFIRMED')`,
    [listing.id, variant.id],
  );
  // Coordinates only with a source-provided or verified node.
  await rejects(
    `INSERT INTO external_fulfillment_nodes (platform_id, source_id, external_node_id, location)
     VALUES ($1, $2, 'N1', ST_SetSRID(ST_MakePoint(77.2, 28.6), 4326)::geography)`,
    [platform.id, source.id],
  );
  // Observations keep only a coarse cell, never a precise one.
  await rejects(
    `INSERT INTO external_price_observations (listing_id, source_id, query_cell, item_price_minor, currency, collected_at)
     VALUES ($1, $2, 'ttnfv2uq', 6800, 'INR', now())`,
    [listing.id, source.id],
  );
  await pool.query(
    `INSERT INTO external_price_observations (listing_id, source_id, query_cell, item_price_minor, currency, collected_at)
     VALUES ($1, $2, 'ttnfv2', 6800, 'INR', now())`,
    [listing.id, source.id],
  );
  await rejects(
    `INSERT INTO external_collection_runs (source_id, status, completed_at, error_code) VALUES ($1, 'FAILED', now(), 'BLOCKED')`,
    [source.id],
  );
});

test('first-party extensions: MRP and pack size', { skip: !enabled && 'set RUN_DB_TESTS=1' }, async () => {
  const tag = randomUUID().slice(0, 8);
  const one = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
  const company = await one(`INSERT INTO companies (name) VALUES ($1) RETURNING id, vendor_type`, [`co-${tag}`]);
  assert.equal(company.vendor_type, 'RETAILER');
  const variant = await createVariant({ weight: '1 kg' });
  const unparsable = await createVariant({ weight: 'family size' });

  await rejects(
    `INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor, mrp_minor) VALUES ($1, $2, 'sku', 5000, 4000)`,
    [company.id, variant.id],
    /seller_offers_mrp_check/,
  );
  await pool.query(
    `INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor, mrp_minor) VALUES ($1, $2, 'sku', 4000, 5000)`,
    [company.id, variant.id],
  );

  // Partial pack sizes are rejected.
  await rejects(`UPDATE product_variants SET pack_quantity = 5 WHERE id = $1`, [variant.id], /pack_complete/);

  const result = await backfillPackSizes(pool);
  assert.ok(result.parsed >= 1);
  const parsed = await one('SELECT pack_quantity, pack_unit, pack_count FROM product_variants WHERE id = $1', [variant.id]);
  assert.deepEqual(parsed, { pack_quantity: '1000.000', pack_unit: 'g', pack_count: 1 });
  const unknown = await one('SELECT pack_quantity, pack_unit, pack_count FROM product_variants WHERE id = $1', [unparsable.id]);
  assert.deepEqual(unknown, { pack_quantity: null, pack_unit: null, pack_count: null });

  // Idempotent: a second run has nothing new to parse.
  assert.equal((await backfillPackSizes(pool)).parsed, 0);
});
