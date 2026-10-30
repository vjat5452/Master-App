// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
// Matching external listings to LocalStock products through the comparison API, and the
// admin review flow, against the isolated *_test database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
const LOCATION = { latitude: 28.6129, longitude: 77.2295 };
const tag = randomUUID().slice(0, 6);
const GTIN_1L = `89${String(Date.now()).slice(-10)}1`;

let api;
let admin;
const variants = {};

const listing = (id, title, variantText, overrides = {}) => ({
  externalListingId: `${tag}-${id}`,
  title,
  brand: 'Zorbo',
  variantText,
  gtin: null,
  imageUrl: null,
  deepLink: null,
  price: { itemPriceMinor: 5000, mrpMinor: 5500, currency: 'INR', taxInclusive: null, deliveryFeeMinor: null, platformFeeMinor: null, handlingFeeMinor: null, otherFeeMinor: null, totalCostCompleteness: 'UNKNOWN' },
  availability: 'IN_STOCK',
  eta: null,
  fulfillmentNode: null,
  sourceObservedAt: null,
  collectedAt: new Date().toISOString(),
  ...overrides,
});

const LISTINGS = [
  listing('gtin', 'Totally Different Title', '1 l', { gtin: GTIN_1L }),
  listing('brand', 'Zorbo Taaza Toned Milk', '500 ml'),
  listing('multipack', 'Zorbo Masti Spiced Buttermilk', '6 x 200 ml'),
  listing('review', 'Zorbo Taaza Homogenised Toned Milk', '1 l'),
  listing('flavour', 'Zorbo Kool Kesar', '180 ml'),
];

const source = {
  code: `test-source-${tag}`,
  name: 'Test Licensed Source',
  platformCode: 'blinkit',
  accessType: 'LICENSED_PROVIDER',
  isDemo: false,
  capabilities: { product_search: 'SUPPORTED', price: 'SUPPORTED' },
  validateConfiguration: () => ({ ok: true }),
  searchProducts: async () => ({ items: LISTINGS, queryCell: 'ttnfv2' }),
};

before(async () => {
  if (!dbTestsEnabled) return;
  api = await createTestApi({ connectors: { list: () => [source] } });
  admin = await api.createUser('ADMIN');
  const group = await api.createGroup();
  const add = async (key, name, attributes, barcode = null, status = 'ACTIVE') => {
    const size = Object.values(attributes)[0];
    const [q, u] = size.includes('ml') ? [Number(size.split(' ')[0]), 'ml'] : size === '1 l' ? [1000, 'ml'] : [null, null];
    variants[key] = await api.one(
      `INSERT INTO product_variants (group_id, brand, name, attributes, barcode, normalized_key, status, pack_quantity, pack_unit, pack_count)
       VALUES ($1, 'Zorbo', $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [group.id, name, JSON.stringify(attributes), barcode, `${tag}|${key}`, status, q, u, q ? 1 : null],
    );
  };
  await add('milk1l', 'Taaza Toned Milk', { volume: '1 l' }, GTIN_1L);
  await add('milk500', 'Taaza Toned Milk', { volume: '500 ml' });
  await add('buttermilk', 'Masti Spiced Buttermilk', { volume: '200 ml' });
  await add('elaichi', 'Kool Elaichi', { volume: '180 ml' });
  await add('pending', 'Taaza Lite Milk', { volume: '1 l' }, null, 'PENDING_REVIEW');
});

after(async () => {
  await api?.pool.end();
});

const http = () => request(api.app);
const compare = async () => {
  const res = await http().post('/api/v1/discovery/compare').send({ query: 'zorbo milk', location: LOCATION, includeLocalVendors: false, refreshPolicy: 'refresh_supported' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return Object.fromEntries(res.body.results.map((r) => [r.listingId.replace(`${tag}-`, ''), r]));
};
const asAdmin = (req) => req.set('authorization', admin.auth);

test('listings are matched by GTIN, by brand + size + name, or left for review or unmapped', { skip }, async () => {
  const r = await compare();
  assert.equal(r.gtin.matchStatus, 'MATCHED');
  assert.equal(r.gtin.canonicalProductId, variants.milk1l.id);
  assert.deepEqual(r.gtin.match, { status: 'AUTO_CONFIRMED', method: 'GTIN', confidence: 1 });

  assert.equal(r.brand.matchStatus, 'MATCHED');
  assert.equal(r.brand.canonicalProductId, variants.milk500.id, '500 ml goes to the 500 ml product, not the 1 l one');
  assert.equal(r.brand.match.method, 'BRAND_ATTRIBUTES');

  // No catalogue product fits these, so each becomes a product of its own, never merged
  // into the wrong one.
  assert.equal(r.multipack.match.method, 'NEW_CANONICAL');
  assert.notEqual(r.multipack.canonicalProductId, variants.buttermilk.id, 'a 6-pack is not the single bottle');
  assert.equal(r.flavour.match.method, 'NEW_CANONICAL');
  assert.notEqual(r.flavour.canonicalProductId, variants.elaichi.id, 'Kesar is not Elaichi');
  const created = await api.one('SELECT origin, status, group_id, pack_quantity, pack_count FROM product_variants WHERE id = $1', [r.multipack.canonicalProductId]);
  assert.deepEqual(created, { origin: 'EXTERNAL', status: 'PENDING_REVIEW', group_id: null, pack_quantity: '200.000', pack_count: 6 });

  assert.equal(r.review.matchStatus, 'NEEDS_REVIEW');
  assert.equal(r.review.canonicalProductId, null, 'a candidate is not presented as the product');

  const src = await api.one('SELECT integration_status, access_type FROM external_sources WHERE code = $1', [source.code]);
  assert.deepEqual(src, { integration_status: 'SANDBOX', access_type: 'LICENSED_PROVIDER' });
  const stored = await api.one('SELECT pack_quantity, pack_unit, pack_count FROM external_listings WHERE external_listing_id = $1', [`${tag}-multipack`]);
  assert.deepEqual(stored, { pack_quantity: '200.000', pack_unit: 'ml', pack_count: 6 });
});

test('decisions are stored once and reused', { skip }, async () => {
  const before = await api.one('SELECT count(*)::int AS n FROM external_product_mappings');
  await compare();
  const afterwards = await api.one('SELECT count(*)::int AS n FROM external_product_mappings');
  assert.equal(afterwards.n, before.n);
});

test('the review queue lists open candidates; admins confirm one', { skip }, async () => {
  const seller = await api.createUser();
  const denied = await http().get('/api/v1/admin/product-mapping/review-queue').set('authorization', seller.auth);
  assert.equal(denied.status, 403);

  const queue = await asAdmin(http().get('/api/v1/admin/product-mapping/review-queue'));
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  const item = queue.body.items.find((i) => i.listing.externalListingId === `${tag}-review`);
  assert.ok(item, JSON.stringify(queue.body));
  assert.deepEqual(item.listing.packSize, { quantity: 1000, unit: 'ml', count: 1 });
  const candidate = item.candidates.find((c) => c.variant.id === variants.milk1l.id);
  assert.ok(candidate);
  assert.equal(candidate.method, 'ATTRIBUTES');

  const confirmed = await asAdmin(http().post(`/api/v1/admin/product-mapping/${candidate.mappingId}/decision`)).send({ decision: 'CONFIRM', note: 'same product, longer name' });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.status, 'CONFIRMED');

  const again = await asAdmin(http().post(`/api/v1/admin/product-mapping/${candidate.mappingId}/decision`)).send({ decision: 'CONFIRM' });
  assert.equal(again.status, 409);

  const r = await compare();
  assert.equal(r.review.matchStatus, 'MATCHED');
  assert.equal(r.review.canonicalProductId, variants.milk1l.id);
  assert.equal(r.review.match.status, 'CONFIRMED');

  const queueAfter = await asAdmin(http().get('/api/v1/admin/product-mapping/review-queue'));
  assert.equal(queueAfter.body.items.some((i) => i.listing.externalListingId === `${tag}-review`), false);

  const audit = await api.one(`SELECT actor_user_id, source_of_change FROM audit_logs WHERE entity_id = $1 AND action = 'product_mapping.confirmed'`, [candidate.mappingId]);
  assert.deepEqual(audit, { actor_user_id: admin.id, source_of_change: 'ADMIN' });
});

test('no one can link listings of different pack sizes', { skip }, async () => {
  const multipack = await api.one('SELECT id FROM external_listings WHERE external_listing_id = $1', [`${tag}-multipack`]);
  const res = await asAdmin(http().post(`/api/v1/admin/product-mapping/listings/${multipack.id}/manual`)).send({ variantId: variants.buttermilk.id });
  assert.equal(res.status, 422);
  assert.equal(res.body.error.code, 'PACK_SIZE_MISMATCH');
});

test('a manual link works when sizes agree; rejecting an automatic match unlinks it', { skip }, async () => {
  const flavour = await api.one('SELECT id FROM external_listings WHERE external_listing_id = $1', [`${tag}-flavour`]);
  // The reviewer knows better (e.g. the listing title is wrong): sizes agree, so it is
  // allowed, after unlinking the product created from the listing.
  const created = await api.one(`SELECT id FROM external_product_mappings WHERE listing_id = $1 AND match_method = 'NEW_CANONICAL'`, [flavour.id]);
  const blocked = await asAdmin(http().post(`/api/v1/admin/product-mapping/listings/${flavour.id}/manual`)).send({ variantId: variants.elaichi.id });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'LISTING_ALREADY_MAPPED');
  await asAdmin(http().post(`/api/v1/admin/product-mapping/${created.id}/decision`)).send({ decision: 'REJECT' });
  const manual = await asAdmin(http().post(`/api/v1/admin/product-mapping/listings/${flavour.id}/manual`)).send({ variantId: variants.elaichi.id, note: 'title typo on source' });
  assert.equal(manual.status, 201, JSON.stringify(manual.body));
  assert.equal((await compare()).flavour.matchStatus, 'MATCHED');

  const auto = await api.one(
    `SELECT m.id FROM external_product_mappings m JOIN external_listings l ON l.id = m.listing_id WHERE l.external_listing_id = $1 AND m.match_status = 'AUTO_CONFIRMED'`,
    [`${tag}-gtin`],
  );
  const rejected = await asAdmin(http().post(`/api/v1/admin/product-mapping/${auto.id}/decision`)).send({ decision: 'REJECT', note: 'source reused a barcode' });
  assert.equal(rejected.status, 200);
  const r = await compare();
  assert.notEqual(r.gtin.canonicalProductId, variants.milk1l.id, 'a rejected product is not proposed again');
});

test('seller-proposed variants awaiting review are listed for admins', { skip }, async () => {
  const res = await asAdmin(http().get('/api/v1/admin/catalog/variants/review-queue'));
  assert.equal(res.status, 200);
  assert.ok(res.body.items.some((v) => v.id === variants.pending.id));
});
