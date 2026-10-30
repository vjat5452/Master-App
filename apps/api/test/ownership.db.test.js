// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
// Data ownership: external platform observations and vendor-managed prices/stock never
// overwrite each other.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { withTransaction } from '@localstock/database';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
let api;
let seller;
const ctx = {};

const FIRST_PARTY = `
  SELECT o.id, o.price_minor, o.mrp_minor, o.status, o.updated_at, i.on_hand, i.reserved, i.version
    FROM seller_offers o JOIN warehouse_inventory i ON i.offer_id = o.id ORDER BY o.id`;
const EXTERNAL = `
  SELECT 'price' AS kind, listing_id::text AS id, item_price_minor::text AS value, collected_at FROM external_price_observations
  UNION ALL SELECT 'availability', listing_id::text, status, collected_at FROM external_availability_observations
  UNION ALL SELECT 'mapping', listing_id::text, match_status, updated_at FROM external_product_mappings
  UNION ALL SELECT 'listing', id::text, title, last_seen_at FROM external_listings
  ORDER BY 1, 2, 4`;

before(async () => {
  if (!dbTestsEnabled) return;
  api = await createTestApi();
  seller = await api.createUser();
  const group = await api.createGroup();
  const one = api.one;
  const company = await one(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Owner test ${randomUUID().slice(0, 6)}`]);
  await api.pool.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [company.id, seller.id]);
  const variant = await one(
    `INSERT INTO product_variants (group_id, brand, name, attributes, barcode, normalized_key) VALUES ($1, 'Amul', 'Taaza Toned Milk', '{"volume":"1 l"}', '8901262010016', $2) RETURNING id`,
    [group.id, `amul|taaza|${randomUUID()}`],
  );
  const offer = await one(`INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor, mrp_minor) VALUES ($1, $2, 'AT-1L', 6600, 6800) RETURNING id`, [
    company.id,
    variant.id,
  ]);
  const warehouse = await one(
    `INSERT INTO warehouses (company_id, name, location) VALUES ($1, 'Store', ST_SetSRID(ST_MakePoint(77.2295, 28.6129), 4326)::geography) RETURNING id`,
    [company.id],
  );
  await api.pool.query(`INSERT INTO warehouse_inventory (warehouse_id, offer_id, on_hand) VALUES ($1, $2, 12)`, [warehouse.id, offer.id]);
  Object.assign(ctx, { companyId: company.id, variantId: variant.id, offerId: offer.id });
});

after(async () => {
  await api?.pool.end();
});

// What a collector does with one observation of the same product on another platform.
async function recordExternalObservation(client, { priceMinor }) {
  const platform = await client
    .query(`INSERT INTO external_platforms (code, name) VALUES ('blinkit', 'Blinkit') ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`)
    .then((r) => r.rows[0]);
  const source = await client
    .query(
      `INSERT INTO external_sources (platform_id, code, name, access_type, integration_status) VALUES ($1, 'ownership-test', 'Test', 'OFFICIAL_API', 'SANDBOX')
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [platform.id],
    )
    .then((r) => r.rows[0]);
  const listing = await client
    .query(
      `INSERT INTO external_listings (platform_id, first_source_id, external_listing_id, title, gtin, pack_quantity, pack_unit, pack_count)
       VALUES ($1, $2, 'ext-1', 'Amul Taaza Toned Milk 1 L', '8901262010016', 1000, 'ml', 1)
       ON CONFLICT (platform_id, external_listing_id) DO UPDATE SET last_seen_at = now() RETURNING id`,
      [platform.id, source.id],
    )
    .then((r) => r.rows[0]);
  await client.query(
    `INSERT INTO external_product_mappings (listing_id, variant_id, match_method, match_confidence, match_status, evidence)
     VALUES ($1, $2, 'GTIN', 1, 'AUTO_CONFIRMED', '{"gtin":"8901262010016"}') ON CONFLICT (listing_id, variant_id) DO NOTHING`,
    [listing.id, ctx.variantId],
  );
  await client.query(
    `INSERT INTO external_price_observations (listing_id, source_id, query_cell, item_price_minor, mrp_minor, currency, collected_at)
     VALUES ($1, $2, 'ttnfv2', $3, 6800, 'INR', now())`,
    [listing.id, source.id, priceMinor],
  );
  await client.query(
    `INSERT INTO external_availability_observations (listing_id, source_id, query_cell, status, collected_at) VALUES ($1, $2, 'ttnfv2', 'OUT_OF_STOCK', now())`,
    [listing.id, source.id],
  );
}

test('external observations leave vendor prices and stock untouched', { skip }, async () => {
  const before = (await api.pool.query(FIRST_PARTY)).rows;
  const movements = await api.one('SELECT count(*)::int AS n FROM inventory_movements');

  // A much lower price and "out of stock" for the same GTIN on another platform.
  await withTransaction(api.pool, (client) => recordExternalObservation(client, { priceMinor: 5500 }));

  assert.deepEqual((await api.pool.query(FIRST_PARTY)).rows, before);
  assert.deepEqual(await api.one('SELECT count(*)::int AS n FROM inventory_movements'), movements);
});

test('vendor price and stock changes leave external observations untouched', { skip }, async () => {
  await withTransaction(api.pool, (client) => recordExternalObservation(client, { priceMinor: 6100 }));
  const before = (await api.pool.query(EXTERNAL)).rows;

  const patch = await request(api.app)
    .patch(`/api/v1/companies/${ctx.companyId}/offers/${ctx.offerId}`)
    .set('authorization', seller.auth)
    .send({ priceMinor: 6200 });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const warehouse = await api.one('SELECT warehouse_id FROM warehouse_inventory WHERE offer_id = $1', [ctx.offerId]);
  const adjust = await request(api.app)
    .post(`/api/v1/companies/${ctx.companyId}/inventory/adjustments`)
    .set('authorization', seller.auth)
    .send({ warehouseId: warehouse.warehouse_id, offerId: ctx.offerId, delta: -3, reason: 'DAMAGE' });
  assert.equal(adjust.status, 201, JSON.stringify(adjust.body));

  assert.deepEqual((await api.pool.query(EXTERNAL)).rows, before);
});

test('no database trigger or cascade links external tables to vendor-managed tables', { skip }, async () => {
  const { rows: triggers } = await api.pool.query(
    `SELECT event_object_table AS t FROM information_schema.triggers WHERE event_object_table LIKE 'external_%'`,
  );
  assert.deepEqual(triggers, []);
  // The only first-party table external data may reference is the canonical catalogue.
  const { rows: refs } = await api.pool.query(
    `SELECT DISTINCT ccu.table_name AS referenced
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name LIKE 'external_%' AND ccu.table_name NOT LIKE 'external_%'
      ORDER BY 1`,
  );
  assert.deepEqual(refs.map((r) => r.referenced), ['outbox_events', 'product_variants', 'users']);
});
