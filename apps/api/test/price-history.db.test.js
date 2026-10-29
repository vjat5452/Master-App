// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
// Price graph data and platform links for a product.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
let api;
let seller;
const ctx = {};

before(async () => {
  if (!dbTestsEnabled) return;
  api = await createTestApi();
  seller = await api.createUser();
  const group = await api.createGroup();
  const one = api.one;
  const company = await one(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`History ${randomUUID().slice(0, 6)}`]);
  await api.pool.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [company.id, seller.id]);
  const variant = await one(
    `INSERT INTO product_variants (group_id, brand, name, attributes, normalized_key) VALUES ($1, 'Maggi', 'Masala Noodles', '{"weight":"70 g"}', $2) RETURNING id`,
    [group.id, `maggi|${randomUUID()}`],
  );
  // Created 3 days ago at 1500; the trigger records the insert.
  const offer = await one(`INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor, created_at) VALUES ($1, $2, 'MG-70', 1500, now()) RETURNING id`, [company.id, variant.id]);
  await api.pool.query(`UPDATE seller_offer_price_history SET valid_from = now() - interval '3 days' WHERE offer_id = $1`, [offer.id]);
  Object.assign(ctx, { companyId: company.id, variantId: variant.id, offerId: offer.id });
});

after(async () => {
  await api?.pool.end();
});

const http = () => request(api.app);

test('every price change is recorded and the graph shows the lowest active price per day', { skip }, async () => {
  const patch = await http().patch(`/api/v1/companies/${ctx.companyId}/offers/${ctx.offerId}`).set('authorization', seller.auth).send({ priceMinor: 1400 });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  const { rows } = await api.pool.query('SELECT price_minor FROM seller_offer_price_history WHERE offer_id = $1 ORDER BY valid_from', [ctx.offerId]);
  assert.deepEqual(rows.map((r) => r.price_minor), [1500, 1400]);

  const res = await http().get(`/api/v1/catalog/variants/${ctx.variantId}/price-history?days=5`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.dates.length, 5);
  const local = res.body.series.find((s) => s.key === 'localstock');
  assert.deepEqual(local.points.map((p) => p.priceMinor), [null, 1500, 1500, 1500, 1400], 'nothing before the offer existed; today the new price');
  assert.equal(res.body.summary.lowest.priceMinor, 1400);
  assert.equal(res.body.summary.highest.priceMinor, 1500);

  // A paused offer drops out of the graph.
  await http().patch(`/api/v1/companies/${ctx.companyId}/offers/${ctx.offerId}`).set('authorization', seller.auth).send({ status: 'PAUSED' });
  const paused = await http().get(`/api/v1/catalog/variants/${ctx.variantId}/price-history?days=1`);
  assert.equal(paused.body.series.length, 0);
  await http().patch(`/api/v1/companies/${ctx.companyId}/offers/${ctx.offerId}`).set('authorization', seller.auth).send({ status: 'ACTIVE' });
});

test('other platforms appear only for confirmed listings, per location cell, without filling gaps', { skip }, async () => {
  const one = api.one;
  const platform = await one(`INSERT INTO external_platforms (code, name, is_demo) VALUES ('hist-demo', 'History Demo', true) RETURNING id`);
  const source = await one(`INSERT INTO external_sources (platform_id, code, name, access_type) VALUES ($1, 'hist-demo-src', 'History Demo', 'DEMO_FIXTURE') RETURNING id`, [platform.id]);
  const listing = await one(`INSERT INTO external_listings (platform_id, first_source_id, external_listing_id, title) VALUES ($1, $2, 'h1', 'Maggi 70 g') RETURNING id`, [platform.id, source.id]);
  const unconfirmed = await one(`INSERT INTO external_listings (platform_id, first_source_id, external_listing_id, title) VALUES ($1, $2, 'h2', 'Maggi?') RETURNING id`, [platform.id, source.id]);
  await api.pool.query(
    `INSERT INTO external_product_mappings (listing_id, variant_id, match_method, match_confidence, match_status) VALUES ($1, $3, 'GTIN', 1, 'AUTO_CONFIRMED'), ($2, $3, 'FUZZY_CANDIDATE', 0.5, 'NEEDS_REVIEW')`,
    [listing.id, unconfirmed.id, ctx.variantId],
  );
  const obs = (listingId, cell, price, ago) =>
    api.pool.query(
      `INSERT INTO external_price_observations (listing_id, source_id, query_cell, item_price_minor, currency, collected_at) VALUES ($1, $2, $3, $4, 'INR', now() - make_interval(days => $5))`,
      [listingId, source.id, cell, price, ago],
    );
  await obs(listing.id, 'ttnfv2', 1450, 2);
  await obs(listing.id, 'ttnfv2', 1350, 0);
  await obs(listing.id, 'te7ud2', 1200, 0); // another city
  await obs(unconfirmed.id, 'ttnfv2', 100, 0); // not confirmed as this product

  const res = await http().get(`/api/v1/catalog/variants/${ctx.variantId}/price-history?days=3&lat=28.6129&lng=77.2295`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.location, { cell: 'ttnfv2' });
  const demo = res.body.series.find((s) => s.key === 'hist-demo');
  assert.equal(demo.isDemo, true);
  assert.deepEqual(demo.points.map((p) => p.priceMinor), [1450, null, 1350]);

  const everywhere = await http().get(`/api/v1/catalog/variants/${ctx.variantId}/price-history?days=1`);
  assert.equal(everywhere.body.series.find((s) => s.key === 'hist-demo').points[0].priceMinor, 1200, 'without a location, the lowest anywhere');
});

test('platform links open each platform search page for this product', { skip }, async () => {
  const res = await http().get(`/api/v1/catalog/variants/${ctx.variantId}/platform-links`);
  assert.equal(res.status, 200);
  assert.equal(res.body.query, 'Maggi Masala Noodles 70 g');
  assert.deepEqual(res.body.links.map((l) => l.platformCode), ['blinkit', 'zepto', 'instamart', 'bigbasket', 'amazon', 'flipkart']);
  assert.ok(res.body.links.every((l) => l.kind === 'SEARCH'));
  assert.equal(res.body.links.find((l) => l.platformCode === 'flipkart').url, 'https://www.flipkart.com/search?q=Maggi%20Masala%20Noodles%2070%20g');

  const missing = await http().get(`/api/v1/catalog/variants/${randomUUID()}/platform-links`);
  assert.equal(missing.status, 404);
});
