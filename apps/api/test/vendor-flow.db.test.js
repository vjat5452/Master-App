// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
// The traditional vendor flow end to end over HTTP, against the isolated *_test database.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
const STORE = { lat: 28.6129, lng: 77.2295 }; // India Gate
const NEAR = { lat: 28.62, lng: 77.23 }; // ~1 km away
const FAR = { lat: 28.75, lng: 77.1 }; // ~20 km away, outside the 5 km service radius

let api;
let seller;
let admin;
let customer;
const ctx = {};

const gtin = () => String(Math.floor(Math.random() * 1e12)).padStart(12, '0') + '7';

before(async () => {
  if (!dbTestsEnabled) return;
  api = await createTestApi();
  [seller, admin, customer] = await Promise.all([api.createUser(), api.createUser('ADMIN'), api.createUser()]);
  ctx.group = await api.createGroup();
  await api.pool.query(
    `INSERT INTO delivery_providers (name, type, base_fee_minor, per_km_fee_minor, speed_kmph, max_distance_m)
     VALUES ('Test fleet', 'PLATFORM_FLEET', 2000, 500, 25, 20000)`,
  );
});

after(async () => {
  await api?.pool.end();
});

const http = () => request(api.app);
const as = (user) => ({ authorization: user.auth });

async function search(q, at) {
  api.redis.flush();
  const res = await http().get('/api/v1/catalog/search').query({ q, lat: at.lat, lng: at.lng, radiusKm: 10 });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.items.find((i) => i.variantId === ctx.variant.id);
}

test('vendor sets up a company, a store with contact and hours, a product and an offer with MRP', { skip }, async () => {
  const company = await http()
    .post('/api/v1/companies')
    .set(as(seller))
    .send({ name: `Zorblat Stores ${randomUUID().slice(0, 4)}`, vendorType: 'RETAILER', contactPhone: '+91 98100 12345' });
  assert.equal(company.status, 201, JSON.stringify(company.body));
  assert.equal(company.body.vendorType, 'RETAILER');
  ctx.companyId = company.body.id;

  const hours = { mon: [['08:00', '22:00']], sun: [] };
  const warehouse = await http()
    .post(`/api/v1/companies/${ctx.companyId}/warehouses`)
    .set(as(seller))
    .send({ name: 'Main store', address: 'Rajpath', ...STORE, serviceRadiusKm: 5, contactPhone: '011 2345 6789', openingHours: hours });
  assert.equal(warehouse.status, 201, JSON.stringify(warehouse.body));
  assert.deepEqual(warehouse.body.openingHours, hours);
  ctx.warehouseId = warehouse.body.id;

  const badHours = await http()
    .patch(`/api/v1/companies/${ctx.companyId}/warehouses/${ctx.warehouseId}`)
    .set(as(seller))
    .send({ openingHours: { mon: [['22:00', '08:00']] } });
  assert.equal(badHours.status, 400);

  const variant = await http()
    .post('/api/v1/catalog/variants')
    .set(as(seller))
    .send({ groupId: ctx.group.id, brand: 'Zorblat', name: 'Zorblat Toned Milk', attributes: { volume: '1 l' }, barcode: gtin() });
  assert.equal(variant.status, 201, JSON.stringify(variant.body));
  assert.deepEqual(variant.body.variant.packSize, { quantity: 1000, unit: 'ml', count: 1 });
  ctx.variant = variant.body.variant;

  const aboveMrp = await http()
    .post(`/api/v1/companies/${ctx.companyId}/offers`)
    .set(as(seller))
    .send({ variantId: ctx.variant.id, sellerSku: 'ZM-1L', priceMinor: 7000, mrpMinor: 6800 });
  assert.equal(aboveMrp.status, 400);

  const offer = await http()
    .post(`/api/v1/companies/${ctx.companyId}/offers`)
    .set(as(seller))
    .send({ variantId: ctx.variant.id, sellerSku: 'ZM-1L', priceMinor: 6600, mrpMinor: 6800 });
  assert.equal(offer.status, 201, JSON.stringify(offer.body));
  assert.equal(offer.body.mrpMinor, 6800);
  ctx.offerId = offer.body.id;

  const priceAboveMrp = await http().patch(`/api/v1/companies/${ctx.companyId}/offers/${ctx.offerId}`).set(as(seller)).send({ priceMinor: 6900 });
  assert.equal(priceAboveMrp.status, 422);
  assert.equal(priceAboveMrp.body.error.code, 'MRP_BELOW_PRICE');

  const clearMrp = await http().patch(`/api/v1/companies/${ctx.companyId}/offers/${ctx.offerId}`).set(as(seller)).send({ mrpMinor: null, priceMinor: 6500 });
  assert.equal(clearMrp.status, 200);
  assert.equal(clearMrp.body.mrpMinor, null);
  assert.equal(clearMrp.body.priceMinor, 6500);
});

test('stock makes the offer findable inside the service area only', { skip }, async () => {
  assert.equal((await search('Zorblat', NEAR))?.offers.length ?? 0, 0, 'no stock yet, so no offer');

  const adjust = await http()
    .post(`/api/v1/companies/${ctx.companyId}/inventory/adjustments`)
    .set(as(seller))
    .send({ warehouseId: ctx.warehouseId, offerId: ctx.offerId, delta: 10, reason: 'RESTOCK' });
  assert.equal(adjust.status, 201, JSON.stringify(adjust.body));

  const near = await search('Zorblat', NEAR);
  assert.equal(near.offers.length, 1);
  assert.equal(near.offers[0].priceMinor, 6500);
  assert.equal(near.offers[0].availableUnits, 10);
  assert.ok(near.offers[0].distanceMeters > 0 && near.offers[0].distanceMeters < 2000);

  const far = await search('Zorblat', FAR);
  assert.equal(far.offers.length, 0);
});

test('an order reserves the stock', { skip }, async () => {
  const res = await http()
    .post('/api/v1/orders')
    .set(as(customer))
    .set('idempotency-key', `vendor-flow-${randomUUID()}`)
    .send({ location: NEAR, items: [{ variantId: ctx.variant.id, quantity: 2 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const inv = await api.one('SELECT on_hand, reserved FROM warehouse_inventory WHERE warehouse_id = $1 AND offer_id = $2', [ctx.warehouseId, ctx.offerId]);
  assert.deepEqual(inv, { on_hand: 10, reserved: 2 });
});

test('CSV import: dry run writes nothing, errors write nothing, a valid file applies atomically', { skip }, async () => {
  const second = await http()
    .post('/api/v1/catalog/variants')
    .set(as(seller))
    .send({ groupId: ctx.group.id, brand: 'Zorblat', name: 'Zorblat Curd', attributes: { weight: '400 g' }, barcode: gtin() });
  assert.equal(second.status, 201);
  const curd = second.body.variant;
  const url = `/api/v1/companies/${ctx.companyId}/catalogue-imports`;
  const post = (csv, dryRun) => http().post(url).query({ dryRun }).set(as(seller)).set('content-type', 'text/csv').send(csv);
  const snapshot = async () =>
    (await api.pool.query(
      `SELECT o.seller_sku, o.price_minor, o.mrp_minor, i.on_hand FROM seller_offers o
         LEFT JOIN warehouse_inventory i ON i.offer_id = o.id WHERE o.company_id = $1 ORDER BY o.seller_sku`,
      [ctx.companyId],
    )).rows;

  const csv = [
    'sku,variant_id,price,mrp,warehouse,quantity',
    `ZM-1L,${ctx.variant.id},64,68,main store,25`,
    `ZC-400,${curd.id},45.50,50,Main store,8`,
  ].join('\n');

  const start = await snapshot();
  const dry = await post(csv, true);
  assert.equal(dry.status, 200, JSON.stringify(dry.body));
  assert.equal(dry.body.valid, true);
  assert.deepEqual(dry.body.summary, { rows: 2, offersCreated: 1, offersUpdated: 1, offersUnchanged: 0, stockChanged: 2, stockUnchanged: 0 });
  assert.deepEqual(dry.body.rows[0].stock, { warehouseId: ctx.warehouseId, warehouse: 'Main store', from: 10, to: 25, action: 'SET' });
  assert.deepEqual(await snapshot(), start, 'dry run must not write');

  // Quantity below what is reserved for the order, plus a product that does not exist.
  const invalid = await post(`sku,variant_id,price,warehouse,quantity\nZM-1L,${ctx.variant.id},64,Main store,1\nX,${randomUUID()},10,,\n`, false);
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, 'IMPORT_INVALID');
  assert.deepEqual(invalid.body.error.details.errors.map((e) => [e.line, e.column]), [
    [2, 'quantity'],
    [3, 'variant_id'],
  ]);
  assert.deepEqual(await snapshot(), start, 'an invalid file must not write anything');

  const applied = await post(csv, false);
  assert.equal(applied.status, 201, JSON.stringify(applied.body));
  assert.deepEqual(await snapshot(), [
    { seller_sku: 'ZC-400', price_minor: 4550, mrp_minor: 5000, on_hand: 8 },
    { seller_sku: 'ZM-1L', price_minor: 6400, mrp_minor: 6800, on_hand: 25 },
  ]);
  const inv = await api.one('SELECT reserved FROM warehouse_inventory WHERE offer_id = $1', [ctx.offerId]);
  assert.equal(inv.reserved, 2, 'reservations are untouched');

  const audits = await api.pool.query(
    `SELECT action, count(*)::int AS n FROM audit_logs WHERE company_id = $1 AND source_of_change = 'CSV_IMPORT' GROUP BY action ORDER BY action`,
    [ctx.companyId],
  );
  assert.deepEqual(audits.rows, [
    { action: 'inventory.imported', n: 2 },
    { action: 'offer.created', n: 1 },
    { action: 'offer.updated', n: 1 },
  ]);
  const movements = await api.one(`SELECT count(*)::int AS n FROM inventory_movements WHERE note = 'CSV import'`);
  assert.equal(movements.n, 2);

  const again = await post(csv, true);
  assert.equal(again.body.summary.offersUnchanged, 2);
  assert.equal(again.body.summary.stockUnchanged, 2);

  const staff = await api.createUser();
  await api.pool.query(`INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, 'STAFF')`, [ctx.companyId, staff.id]);
  const forbidden = await http().post(url).set(as(staff)).set('content-type', 'text/csv').send(csv);
  assert.equal(forbidden.status, 403);
});

test('the comparison API returns local sellers with verified distance, only inside the service area', { skip }, async () => {
  const compare = (at) =>
    http()
      .post('/api/v1/discovery/compare')
      .send({ query: 'Zorblat toned milk 1 litre', location: { latitude: at.lat, longitude: at.lng }, radiusKm: 10, platforms: ['blinkit'] });

  const near = await compare(NEAR);
  assert.equal(near.status, 200, JSON.stringify(near.body));
  const local = near.body.results.filter((r) => r.sourceType === 'LOCAL_VENDOR');
  const offer = local.find((r) => r.listingId === ctx.offerId);
  assert.ok(offer, JSON.stringify(local));
  assert.equal(offer.canonicalProductId, ctx.variant.id);
  assert.equal(offer.price.itemPriceMinor, 6400);
  assert.equal(offer.price.mrpMinor, 6800);
  assert.equal(offer.availableUnits, 23, '25 on hand minus 2 reserved');
  assert.equal(offer.distance.status, 'VERIFIED');
  assert.ok(offer.distance.km > 0 && offer.distance.km < 2);
  assert.equal(offer.fulfillmentNode.id, ctx.warehouseId);
  assert.equal(offer.orderCapability, 'LOCALSTOCK_CHECKOUT');
  assert.deepEqual(offer.product.packSize, { quantity: 1000, unit: 'ml', count: 1 });
  assert.equal(near.body.sources.find((s) => s.sourceId === 'blinkit-official').status, 'NOT_CONFIGURED');

  const far = await compare(FAR);
  assert.equal(far.body.results.length, 0);
});

test('admin suspends and restores a vendor and a store, audited', { skip }, async () => {
  const denied = await http().patch(`/api/v1/admin/companies/${ctx.companyId}/status`).set(as(seller)).send({ status: 'SUSPENDED' });
  assert.equal(denied.status, 403);

  const suspended = await http()
    .patch(`/api/v1/admin/companies/${ctx.companyId}/status`)
    .set(as(admin))
    .send({ status: 'SUSPENDED', reason: 'KYC pending' });
  assert.equal(suspended.status, 200, JSON.stringify(suspended.body));
  assert.equal(suspended.body.status, 'SUSPENDED');
  assert.equal((await search('Zorblat', NEAR)).offers.length, 0, 'suspended vendors leave search');
  assert.equal((await http().get(`/api/v1/companies/${ctx.companyId}/offers`).set(as(seller))).status, 404);

  const listed = await http().get('/api/v1/admin/companies').query({ status: 'SUSPENDED' }).set(as(admin));
  assert.ok(listed.body.items.some((c) => c.id === ctx.companyId));

  await http().patch(`/api/v1/admin/companies/${ctx.companyId}/status`).set(as(admin)).send({ status: 'ACTIVE' });
  assert.equal((await search('Zorblat', NEAR)).offers.length, 1);

  const inactive = await http().patch(`/api/v1/admin/warehouses/${ctx.warehouseId}/status`).set(as(admin)).send({ status: 'INACTIVE' });
  assert.equal(inactive.status, 200);
  assert.equal((await search('Zorblat', NEAR)).offers.length, 0, 'inactive stores leave search');
  await http().patch(`/api/v1/admin/warehouses/${ctx.warehouseId}/status`).set(as(admin)).send({ status: 'ACTIVE' });

  const audits = await api.pool.query(
    `SELECT action, actor_user_id FROM audit_logs WHERE source_of_change = 'ADMIN' AND company_id = $1 ORDER BY created_at`,
    [ctx.companyId],
  );
  assert.deepEqual(audits.rows.map((r) => r.action), ['company.status_changed', 'company.status_changed', 'warehouse.status_changed', 'warehouse.status_changed']);
  assert.ok(audits.rows.every((r) => r.actor_user_id === admin.id));
  const events = await api.pool.query(
    `SELECT event_type FROM outbox_events WHERE aggregate_type IN ('company', 'warehouse') AND aggregate_id IN ($1, $2)`,
    [ctx.companyId, ctx.warehouseId],
  );
  assert.equal(events.rows.length, 4);
});
