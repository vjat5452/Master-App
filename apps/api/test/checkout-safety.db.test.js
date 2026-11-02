// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
// Narrow timing windows: late payments, stale idempotency claims, concurrent token refreshes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';
import { claimIdempotencyKey, completeIdempotencyKey, releaseIdempotencyKey } from '../src/modules/orders/idempotency.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
const STORE = { lat: 28.6129, lng: 77.2295 };
const NEAR = { lat: 28.62, lng: 77.23 };

let api;
let seller;
let customer;
const ctx = {};

const http = () => request(api.app);
const as = (user) => ({ authorization: user.auth });

before(async () => {
  if (!dbTestsEnabled) return;
  api = await createTestApi();
  [seller, customer] = await Promise.all([api.createUser(), api.createUser()]);
  const group = await api.createGroup();
  await api.pool.query(
    `INSERT INTO delivery_providers (name, type, base_fee_minor, per_km_fee_minor, speed_kmph, max_distance_m)
     VALUES ('Test fleet', 'PLATFORM_FLEET', 2000, 500, 25, 20000)`,
  );
  const company = await http().post('/api/v1/companies').set(as(seller)).send({ name: `Quillby ${randomUUID().slice(0, 4)}`, vendorType: 'RETAILER' });
  const warehouse = await http()
    .post(`/api/v1/companies/${company.body.id}/warehouses`)
    .set(as(seller))
    .send({ name: 'Main', address: 'Rajpath', ...STORE, serviceRadiusKm: 5 });
  const variant = await http()
    .post('/api/v1/catalog/variants')
    .set(as(seller))
    .send({ groupId: group.id, brand: 'Quillby', name: 'Quillby Paneer', attributes: { weight: '200 g' } });
  const offer = await http()
    .post(`/api/v1/companies/${company.body.id}/offers`)
    .set(as(seller))
    .send({ variantId: variant.body.variant.id, sellerSku: 'QP-200', priceMinor: 9000 });
  await http()
    .post(`/api/v1/companies/${company.body.id}/inventory/adjustments`)
    .set(as(seller))
    .send({ warehouseId: warehouse.body.id, offerId: offer.body.id, delta: 10, reason: 'RESTOCK' });
  Object.assign(ctx, { variantId: variant.body.variant.id, offerId: offer.body.id });
});

after(async () => {
  await api?.pool.end();
});

const placeOrder = () =>
  http()
    .post('/api/v1/orders')
    .set(as(customer))
    .set('idempotency-key', `safety-${randomUUID()}`)
    .send({ location: NEAR, items: [{ variantId: ctx.variantId, quantity: 1 }] });

const reserved = () => api.one('SELECT reserved FROM warehouse_inventory WHERE offer_id = $1', [ctx.offerId]).then((r) => r.reserved);

test('a payment after the reservation deadline is refunded even before the expiry job runs', { skip }, async () => {
  const order = await placeOrder();
  assert.equal(order.status, 201, JSON.stringify(order.body));
  const heldBefore = await reserved();
  await api.pool.query(`UPDATE inventory_reservations SET expires_at = now() - interval '1 second' WHERE order_id = $1`, [order.body.id]);

  const paid = await http()
    .post(`/api/v1/payments/sandbox/${order.body.payment.providerPaymentId}/simulate`)
    .set(as(customer))
    .send({ status: 'SUCCEEDED' });
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  assert.equal(paid.body.result.outcome, 'REFUND_PENDING');

  const after = await api.one('SELECT status FROM orders WHERE id = $1', [order.body.id]);
  assert.equal(after.status, 'REFUND_PENDING');
  const holds = await api.pool.query('SELECT status FROM inventory_reservations WHERE order_id = $1', [order.body.id]);
  assert.deepEqual(holds.rows.map((r) => r.status), ['EXPIRED']);
  assert.equal(await reserved(), heldBefore - 1, 'the stock goes back');
});

test('a payment inside the deadline still confirms', { skip }, async () => {
  const order = await placeOrder();
  const paid = await http()
    .post(`/api/v1/payments/sandbox/${order.body.payment.providerPaymentId}/simulate`)
    .set(as(customer))
    .send({ status: 'SUCCEEDED' });
  assert.equal(paid.body.result.outcome, 'CONFIRMED');
});

test('a request whose idempotency key was taken over can neither complete nor release it', { skip }, async () => {
  const user = await api.createUser();
  const key = `stale-${randomUUID()}`;
  const ids = { userId: user.id, key, hash: 'h' };

  const first = await claimIdempotencyKey(api.pool, ids);
  assert.equal(first.claimed, true);
  await assert.rejects(claimIdempotencyKey(api.pool, ids), /being processed/);

  await api.pool.query(`UPDATE idempotency_keys SET created_at = now() - interval '10 minutes' WHERE user_id = $1 AND key = $2`, [user.id, key]);
  const second = await claimIdempotencyKey(api.pool, ids);
  assert.equal(second.claimed, true, 'a stale claim can be taken over');

  await releaseIdempotencyKey(api.pool, { userId: user.id, key, claimedAt: first.claimedAt });
  assert.ok(await api.one('SELECT 1 AS ok FROM idempotency_keys WHERE user_id = $1 AND key = $2', [user.id, key]), 'the old holder cannot release it');
  await assert.rejects(
    completeIdempotencyKey(api.pool, { userId: user.id, key, claimedAt: first.claimedAt, status: 201, body: {} }),
    /being processed/,
  );

  await completeIdempotencyKey(api.pool, { userId: user.id, key, claimedAt: second.claimedAt, status: 201, body: { ok: true } });
  const replay = await claimIdempotencyKey(api.pool, ids);
  assert.deepEqual(replay.replay, { status: 201, body: { ok: true } });
});

test('two refreshes of the same token at once do not sign the user out everywhere', { skip }, async () => {
  const email = `refresh-${randomUUID().slice(0, 8)}@test.local`;
  const registered = await http().post('/api/v1/auth/register').send({ name: 'Refresh Tester', email, password: 'a-long-enough-password' });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  const other = await http().post('/api/v1/auth/login').send({ email, password: 'a-long-enough-password' });

  const token = registered.body.refreshToken;
  const [a, b] = await Promise.all([
    http().post('/api/v1/auth/refresh').send({ refreshToken: token }),
    http().post('/api/v1/auth/refresh').send({ refreshToken: token }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 401]);

  const winner = a.status === 200 ? a : b;
  assert.equal((await http().post('/api/v1/auth/refresh').send({ refreshToken: winner.body.refreshToken })).status, 200);
  assert.equal((await http().post('/api/v1/auth/refresh').send({ refreshToken: other.body.refreshToken })).status, 200, 'other sessions survive');
});

test('reusing a token rotated long ago still revokes every session', { skip }, async () => {
  const email = `reuse-${randomUUID().slice(0, 8)}@test.local`;
  const registered = await http().post('/api/v1/auth/register').send({ name: 'Reuse Tester', email, password: 'a-long-enough-password' });
  const old = registered.body.refreshToken;
  const rotated = await http().post('/api/v1/auth/refresh').send({ refreshToken: old });
  assert.equal(rotated.status, 200);
  await api.pool.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute' WHERE token_hash = $1`, [
    createHash('sha256').update(old).digest('hex'),
  ]);

  assert.equal((await http().post('/api/v1/auth/refresh').send({ refreshToken: old })).status, 401);
  assert.equal((await http().post('/api/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken })).status, 401, 'the family is revoked');
});
