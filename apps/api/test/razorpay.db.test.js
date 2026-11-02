// Requires PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
// The Razorpay flow end to end against a fake Razorpay API that keeps its orders in memory.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { createLogger } from '@localstock/logger';
import { createRazorpayGateway } from '@localstock/payments';
import { createTestApi, dbTestsEnabled } from '../test-support/db-app.js';

const skip = !dbTestsEnabled && 'set RUN_DB_TESTS=1';
const KEY_SECRET = 'test-key-secret';
const WEBHOOK_SECRET = 'test-razorpay-webhook-secret';
const STORE = { lat: 28.6129, lng: 77.2295 };
const NEAR = { lat: 28.62, lng: 77.23 };

function fakeRazorpay() {
  const orders = new Map();
  const payments = new Map();
  const refunds = [];
  const counts = { createOrder: 0, refundPayment: 0 };
  return {
    orders,
    refunds,
    counts,
    async createOrder({ amount, currency, receipt }) {
      counts.createOrder += 1;
      const order = { id: `order_${randomUUID().slice(0, 12)}`, amount, amount_paid: 0, currency, receipt, status: 'created' };
      orders.set(order.id, order);
      return order;
    },
    async fetchOrder(id) {
      return orders.get(id);
    },
    async fetchOrderPayments(id) {
      return [...payments.values()].filter((p) => p.order_id === id);
    },
    async refundPayment(paymentId) {
      counts.refundPayment += 1;
      const refund = { id: `rfnd_${randomUUID().slice(0, 12)}`, payment_id: paymentId, status: 'pending' };
      refunds.push(refund);
      return refund;
    },
    async fetchPaymentRefunds(paymentId) {
      return refunds.filter((r) => r.payment_id === paymentId);
    },
    async fetchRefund(id) {
      return refunds.find((r) => r.id === id);
    },
    // What happens at Razorpay when the shopper pays.
    pay(orderId, { amount } = {}) {
      const order = orders.get(orderId);
      const payment = { id: `pay_${randomUUID().slice(0, 12)}`, order_id: orderId, amount: amount ?? order.amount, currency: order.currency, status: 'captured' };
      payments.set(payment.id, payment);
      Object.assign(order, { status: 'paid', amount_paid: payment.amount });
      return payment;
    },
  };
}

let api;
let customer;
let razorpay;
const ctx = {};
const http = () => request(api.app);
const as = (user) => ({ authorization: user.auth });
const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');

before(async () => {
  if (!dbTestsEnabled) return;
  razorpay = fakeRazorpay();
  api = await createTestApi({
    env: { RAZORPAY_KEY_ID: 'rzp_test_fake', RAZORPAY_KEY_SECRET: KEY_SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET },
    razorpayClient: razorpay,
  });
  const seller = await api.createUser();
  customer = await api.createUser();
  const group = await api.createGroup();
  await api.pool.query(
    `INSERT INTO delivery_providers (name, type, base_fee_minor, per_km_fee_minor, speed_kmph, max_distance_m)
     VALUES ('Test fleet', 'PLATFORM_FLEET', 2000, 500, 25, 20000)`,
  );
  const company = await http().post('/api/v1/companies').set(as(seller)).send({ name: `Rupeeling ${randomUUID().slice(0, 4)}`, vendorType: 'RETAILER' });
  const warehouse = await http().post(`/api/v1/companies/${company.body.id}/warehouses`).set(as(seller)).send({ name: 'Main', address: 'Rajpath', ...STORE, serviceRadiusKm: 5 });
  const variant = await http().post('/api/v1/catalog/variants').set(as(seller)).send({ groupId: group.id, brand: 'Rupeeling', name: 'Rupeeling Ghee', attributes: { volume: '500 ml' } });
  const offer = await http().post(`/api/v1/companies/${company.body.id}/offers`).set(as(seller)).send({ variantId: variant.body.variant.id, sellerSku: 'RG-500', priceMinor: 32000 });
  await http()
    .post(`/api/v1/companies/${company.body.id}/inventory/adjustments`)
    .set(as(seller))
    .send({ warehouseId: warehouse.body.id, offerId: offer.body.id, delta: 20, reason: 'RESTOCK' });
  ctx.variantId = variant.body.variant.id;
  ctx.gateway = createRazorpayGateway({ pool: api.pool, client: razorpay, logger: createLogger({ level: 'silent' }) });
});

after(async () => {
  await api?.pool.end();
});

async function placeOrder() {
  const res = await http()
    .post('/api/v1/orders')
    .set(as(customer))
    .set('idempotency-key', `rzp-${randomUUID()}`)
    .send({ location: NEAR, items: [{ variantId: ctx.variantId, quantity: 1 }] });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}

const startPayment = (orderId, user = customer) => http().post(`/api/v1/orders/${orderId}/payment/razorpay`).set(as(user));
const orderStatus = (orderId) => api.one('SELECT status FROM orders WHERE id = $1', [orderId]).then((r) => r.status);
const payment = (orderId) => api.one('SELECT status, provider_payment_id, provider_charge_id, provider_refund_id FROM payments WHERE order_id = $1', [orderId]);

function webhook(body) {
  const raw = JSON.stringify(body);
  return http()
    .post('/api/v1/payments/webhooks/razorpay')
    .set('content-type', 'application/json')
    .set('x-razorpay-signature', sign(WEBHOOK_SECRET, raw))
    .set('x-razorpay-event-id', `evt_${randomUUID()}`)
    .send(raw);
}

const paidEvent = (rzpOrderId, payment) => ({
  event: 'order.paid',
  payload: { order: { entity: razorpay.orders.get(rzpOrderId) }, payment: { entity: { ...payment, email: 'shopper@example.com', contact: '+919999999999' } } },
});

test('a new order waits for a Razorpay payment, created once on the first Pay click', { skip }, async () => {
  const order = await placeOrder();
  assert.equal(order.payment.provider, 'razorpay');
  assert.equal(order.payment.providerPaymentId, null);

  const first = await startPayment(order.id);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.keyId, 'rzp_test_fake');
  assert.equal(first.body.amountMinor, order.totalMinor);
  assert.ok(first.body.timeoutSeconds > 0 && first.body.timeoutSeconds < 600);
  assert.equal(razorpay.orders.get(first.body.razorpayOrderId).amount, order.totalMinor);

  const second = await startPayment(order.id);
  assert.equal(second.body.razorpayOrderId, first.body.razorpayOrderId);
  assert.equal(razorpay.counts.createOrder, 1);

  const stranger = await api.createUser();
  assert.equal((await startPayment(order.id, stranger)).status, 404);
});

test('the checkout callback confirms only with a valid signature and a paid Razorpay order', { skip }, async () => {
  const order = await placeOrder();
  const { razorpayOrderId } = (await startPayment(order.id)).body;
  const verify = (body) => http().post(`/api/v1/orders/${order.id}/payment/razorpay/verify`).set(as(customer)).send(body);

  const forged = await verify({ razorpayOrderId, razorpayPaymentId: 'pay_forged', razorpaySignature: 'f'.repeat(64) });
  assert.equal(forged.status, 400, JSON.stringify(forged.body));
  assert.equal(forged.body.error.code, 'INVALID_SIGNATURE');

  // Correctly signed, but Razorpay does not report the order as paid yet.
  const early = await verify({ razorpayOrderId, razorpayPaymentId: 'pay_x', razorpaySignature: sign(KEY_SECRET, `${razorpayOrderId}|pay_x`) });
  assert.equal(early.body.outcome, 'PROCESSING');
  assert.equal(await orderStatus(order.id), 'PENDING_PAYMENT');

  const paid = razorpay.pay(razorpayOrderId);
  const ok = await verify({ razorpayOrderId, razorpayPaymentId: paid.id, razorpaySignature: sign(KEY_SECRET, `${razorpayOrderId}|${paid.id}`) });
  assert.equal(ok.body.outcome, 'CONFIRMED');
  assert.equal(await orderStatus(order.id), 'CONFIRMED');
  assert.equal((await payment(order.id)).provider_charge_id, paid.id);

  // The webhook arriving afterwards changes nothing.
  const late = await webhook(paidEvent(razorpayOrderId, paid));
  assert.equal(late.status, 200);
  assert.equal(late.body.outcome, 'DUPLICATE_EVENT');
});

test('webhooks: signature checked, order.paid confirms, unknown orders acknowledged, no contact details stored', { skip }, async () => {
  const order = await placeOrder();
  const { razorpayOrderId } = (await startPayment(order.id)).body;
  const paid = razorpay.pay(razorpayOrderId);

  const unsigned = await http().post('/api/v1/payments/webhooks/razorpay').set('x-razorpay-signature', 'nope').send(paidEvent(razorpayOrderId, paid));
  assert.equal(unsigned.status, 401);
  assert.equal(await orderStatus(order.id), 'PENDING_PAYMENT');

  const res = await webhook(paidEvent(razorpayOrderId, paid));
  assert.equal(res.body.outcome, 'CONFIRMED');
  assert.equal(await orderStatus(order.id), 'CONFIRMED');
  const stored = await api.one(`SELECT payload::text AS p FROM webhook_events WHERE provider = 'razorpay' AND event_id = $1`, [`order.paid:${razorpayOrderId}`]);
  assert.ok(!stored.p.includes('shopper@example.com') && !stored.p.includes('9999999999'));

  const other = await webhook({ event: 'order.paid', payload: { order: { entity: { id: 'order_from_another_app', status: 'paid' } } } });
  assert.equal(other.status, 200);
  assert.equal(other.body.outcome, 'UNKNOWN_ORDER');
  assert.equal((await webhook({ event: 'payment.authorized', payload: {} })).body.outcome, 'IGNORED');
});

test('a paid amount that does not match the order confirms nothing', { skip }, async () => {
  const order = await placeOrder();
  const { razorpayOrderId } = (await startPayment(order.id)).body;
  const paid = razorpay.pay(razorpayOrderId, { amount: 100 });
  const res = await webhook(paidEvent(razorpayOrderId, paid));
  assert.equal(res.body.outcome, 'AMOUNT_MISMATCH');
  assert.equal(await orderStatus(order.id), 'PENDING_PAYMENT');
});

test('the sync job confirms a payment that no webhook or callback reported', { skip }, async () => {
  const order = await placeOrder();
  const { razorpayOrderId } = (await startPayment(order.id)).body;
  razorpay.pay(razorpayOrderId);
  assert.equal((await ctx.gateway.sync()).settled, 0, 'too recent: the webhook gets a minute first');
  await api.pool.query(`UPDATE payments SET updated_at = now() - interval '2 minutes' WHERE order_id = $1`, [order.id]);
  await ctx.gateway.sync();
  assert.equal(await orderStatus(order.id), 'CONFIRMED');
});

test('a late payment is refunded through Razorpay exactly once', { skip }, async () => {
  const order = await placeOrder();
  const { razorpayOrderId } = (await startPayment(order.id)).body;
  await api.pool.query(`UPDATE inventory_reservations SET expires_at = now() - interval '1 second' WHERE order_id = $1`, [order.id]);
  const paid = razorpay.pay(razorpayOrderId);

  assert.equal((await webhook(paidEvent(razorpayOrderId, paid))).body.outcome, 'REFUND_PENDING');
  assert.equal(await orderStatus(order.id), 'REFUND_PENDING');

  await ctx.gateway.sync();
  // Even if the lease runs out and the job tries again, the existing refund is reused.
  await api.pool.query(`UPDATE payments SET provider_refund_id = NULL, refund_attempted_at = NULL WHERE order_id = $1`, [order.id]);
  await ctx.gateway.sync();
  const refunds = razorpay.refunds.filter((r) => r.payment_id === paid.id);
  assert.equal(refunds.length, 1);
  assert.equal((await payment(order.id)).provider_refund_id, refunds[0].id);

  refunds[0].status = 'processed';
  const res = await webhook({ event: 'refund.processed', payload: { refund: { entity: refunds[0] } } });
  assert.equal(res.body.outcome, 'REFUNDED');
  assert.equal(await orderStatus(order.id), 'REFUNDED');
  assert.equal((await payment(order.id)).status, 'REFUNDED');
  assert.equal((await webhook({ event: 'refund.processed', payload: { refund: { entity: refunds[0] } } })).body.outcome, 'ALREADY_SETTLED');
});

test('an order whose stock is about to be released cannot start a payment', { skip }, async () => {
  const order = await placeOrder();
  await api.pool.query(`UPDATE inventory_reservations SET expires_at = now() + interval '20 seconds' WHERE order_id = $1`, [order.id]);
  const res = await startPayment(order.id);
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'RESERVATION_EXPIRING');
});
