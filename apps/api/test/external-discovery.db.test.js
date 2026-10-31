// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
const LOCATION = { latitude: 28.6129, longitude: 77.2295 };
const tag = randomUUID().slice(0, 6);
const GTIN = `89${String(Date.now()).slice(-10)}3`;

const listing = (id, title, variantText, extra = {}) => ({
  externalListingId: `${tag}-${id}`,
  title,
  brand: 'Zingo',
  variantText,
  gtin: null,
  imageUrl: null,
  deepLink: null,
  price: { itemPriceMinor: 1400, mrpMinor: 1500, currency: 'INR', taxInclusive: null, deliveryFeeMinor: null, platformFeeMinor: null, handlingFeeMinor: null, otherFeeMinor: null, totalCostCompleteness: 'UNKNOWN' },
  availability: 'IN_STOCK',
  eta: null,
  fulfillmentNode: null,
  sourceObservedAt: null,
  collectedAt: new Date().toISOString(),
  ...extra,
});

const stub = (code, platformCode, items) => ({
  code,
  name: `Test source ${platformCode}`,
  platformCode,
  accessType: 'LICENSED_PROVIDER',
  isDemo: false,
  capabilities: { product_search: 'SUPPORTED' },
  validateConfiguration: () => ({ ok: true }),
  searchProducts: async () => {
    if (items instanceof Error) throw items;
    return { items, queryCell: 'ttnfv2' };
  },
});

// Same 70 g product on both platforms (different titles), a multipack and a bigger pack on
// one, and the same GTIN under two different titles.
const sourceA = stub(`test-a-${tag}`, 'blinkit', [
  listing('a70', 'Zingo Masala Noodles', '70 g'),
  listing('a4x70', 'Zingo Masala Noodles', '4 x 70 g'),
  listing('agtin', 'Zingo Chilli Noodles Cup', '45 g', { gtin: GTIN }),
]);
const sourceB = stub(`test-b-${tag}`, 'zepto', [
  listing('b70', 'Zingo Masala Noodles Pouch', '70 g', { price: { ...listing().price, itemPriceMinor: 1350 } }),
  listing('b140', 'Zingo Masala Noodles', '140 g'),
  listing('bgtin', 'Chilli Cup Noodles by Zingo', '45 g', { gtin: GTIN }),
]);
const down = stub(`test-c-${tag}`, 'instamart', new Error('upstream unavailable'));

let api;
let admin;
let seller;

before(async () => {
  if (!dbTestsEnabled) return;
  api = await createTestApi({ connectors: { list: () => [sourceA, sourceB, down] } });
  admin = await api.createUser('ADMIN');
  seller = await api.createUser();
});

after(async () => {
  await api?.pool.end();
});

const http = () => request(api.app);
const compare = async (query) => {
  const res = await http().post('/api/v1/discovery/compare').send({ query, location: LOCATION, refreshPolicy: 'refresh_supported' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
};
const byListing = (body) => Object.fromEntries(body.results.map((r) => [r.listingId.replace(`${tag}-`, ''), r]));

test('scenario B: a product no LocalStock seller lists is still found, once, from both platforms', { skip }, async () => {
  const body = await compare('zingo noodles');
  const r = byListing(body);
  assert.equal(r.a70.matchStatus, 'MATCHED');
  assert.equal(r.b70.canonicalProductId, r.a70.canonicalProductId, 'the same 70 g product from two platforms is one product');
  assert.equal(r.bgtin.canonicalProductId, r.agtin.canonicalProductId, 'same GTIN, different titles: one product');

  // A failing platform does not stop the others.
  assert.equal(body.sources.find((s) => s.sourceId === down.code).status, 'FAILED');

  const product = await http().get(`/api/v1/catalog/variants/${r.a70.canonicalProductId}`);
  assert.equal(product.status, 200);
  assert.equal(product.body.origin, 'EXTERNAL');
  assert.equal(product.body.status, 'PENDING_REVIEW');
  assert.deepEqual(product.body.packSize, { quantity: 70, unit: 'g', count: 1 });

  const search = await http().get('/api/v1/catalog/search?q=zingo masala&lat=28.6129&lng=77.2295');
  const found = search.body.items.find((i) => i.variantId === r.a70.canonicalProductId);
  assert.ok(found, 'shown in search');
  assert.equal(found.origin, 'EXTERNAL');
  assert.deepEqual(found.offers, [], 'no LocalStock offer is invented');

  const { rows } = await api.pool.query(`SELECT count(*)::int AS n FROM seller_offers`);
  assert.equal(rows[0].n, 0, 'no seller listing or stock was created');

  // Running the comparison again creates nothing new.
  const before = await api.one(`SELECT count(*)::int AS n FROM product_variants WHERE origin = 'EXTERNAL'`);
  await compare('zingo noodles');
  assert.deepEqual(await api.one(`SELECT count(*)::int AS n FROM product_variants WHERE origin = 'EXTERNAL'`), before);
});

test('scenario D: different pack sizes stay different products', { skip }, async () => {
  const r = byListing(await compare('zingo noodles'));
  const ids = new Set([r.a70.canonicalProductId, r.a4x70.canonicalProductId, r.b140.canonicalProductId]);
  assert.equal(ids.size, 3, '70 g, 4 x 70 g and 140 g are three products');
  const multipack = await api.one('SELECT pack_quantity, pack_count FROM product_variants WHERE id = $1', [r.a4x70.canonicalProductId]);
  assert.deepEqual(multipack, { pack_quantity: '70.000', pack_count: 4 });
});

test('a discovered product cannot be sold until an admin classifies and approves it', { skip }, async () => {
  const r = byListing(await compare('zingo noodles'));
  const productId = r.a70.canonicalProductId;
  const company = await api.one(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`Zingo seller ${tag}`]);
  await api.pool.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'OWNER')`, [company.id, seller.id]);
  const offer = () => http().post(`/api/v1/companies/${company.id}/offers`).set('authorization', seller.auth).send({ variantId: productId, sellerSku: `Z-${tag}`, priceMinor: 1400 });

  assert.equal((await offer()).status, 409, 'not sellable while awaiting review');

  const queue = await http().get('/api/v1/admin/catalog/variants/review-queue?origin=EXTERNAL').set('authorization', admin.auth);
  const item = queue.body.items.find((v) => v.id === productId);
  assert.ok(item);
  assert.equal(item.discoveredOn.platform, 'blinkit');

  const approveEarly = await http().patch(`/api/v1/catalog/variants/${productId}/status`).set('authorization', admin.auth).send({ status: 'ACTIVE' });
  assert.equal(approveEarly.status, 422);
  assert.equal(approveEarly.body.error.code, 'GROUP_REQUIRED');

  const group = await api.createGroup();
  const enrich = await http().patch(`/api/v1/catalog/variants/${productId}`).set('authorization', admin.auth).send({ groupId: group.id, name: 'Masala Noodles', attributes: { weight: '70 g' } });
  assert.equal(enrich.status, 200, JSON.stringify(enrich.body));
  assert.equal(enrich.body.groupId, group.id);
  assert.deepEqual(enrich.body.packSize, { quantity: 70, unit: 'g', count: 1 });
  const audit = await api.one(`SELECT source_of_change FROM audit_logs WHERE entity_id = $1 AND action = 'variant.edited'`, [productId]);
  assert.equal(audit.source_of_change, 'ADMIN');

  const approved = await http().patch(`/api/v1/catalog/variants/${productId}/status`).set('authorization', admin.auth).send({ status: 'ACTIVE' });
  assert.equal(approved.status, 200);
  assert.equal((await offer()).status, 201, 'sellers can list it once approved');

  // Both platform listings stay linked to it.
  const again = byListing(await compare('zingo noodles'));
  assert.equal(again.b70.canonicalProductId, productId);
});
