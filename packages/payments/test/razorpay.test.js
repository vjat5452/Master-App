import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRazorpayClient, RazorpayError, razorpaySettings, verifyCheckoutSignature, verifyWebhookSignature } from '../src/index.js';

const sign = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');

test('checkout signatures cover the order and payment ids', () => {
  const signature = sign('key-secret', 'order_A|pay_B');
  assert.equal(verifyCheckoutSignature({ orderId: 'order_A', paymentId: 'pay_B', signature }, 'key-secret'), true);
  assert.equal(verifyCheckoutSignature({ orderId: 'order_A', paymentId: 'pay_C', signature }, 'key-secret'), false);
  assert.equal(verifyCheckoutSignature({ orderId: 'order_A', paymentId: 'pay_B', signature }, 'other-secret'), false);
  assert.equal(verifyCheckoutSignature({ orderId: 'order_A', paymentId: 'pay_B', signature: undefined }, 'key-secret'), false);
});

test('webhook signatures cover the exact raw body', () => {
  const body = Buffer.from('{"event":"order.paid"}');
  assert.equal(verifyWebhookSignature(body, sign('hook', body), 'hook'), true);
  assert.equal(verifyWebhookSignature(Buffer.from('{"event": "order.paid"}'), sign('hook', body), 'hook'), false);
  assert.equal(verifyWebhookSignature(body, '', 'hook'), false);
});

test('only test keys are accepted, and both keys are needed', () => {
  assert.equal(razorpaySettings({}), null);
  assert.deepEqual(razorpaySettings({ RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 's' }), { keyId: 'rzp_test_abc', keySecret: 's', webhookSecret: null });
  assert.throws(() => razorpaySettings({ RAZORPAY_KEY_ID: 'rzp_live_abc', RAZORPAY_KEY_SECRET: 's' }), /test keys/);
  assert.throws(() => razorpaySettings({ RAZORPAY_KEY_ID: 'rzp_test_abc' }), /together/);
});

test('the client authenticates with the key pair and reports only Razorpay error codes', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/orders')) return new Response(JSON.stringify({ id: 'order_1', status: 'created' }), { status: 200 });
    return new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'The id provided does not exist' } }), { status: 400 });
  };
  const client = createRazorpayClient({ keyId: 'rzp_test_k', keySecret: 'secret', fetchImpl });

  const order = await client.createOrder({ amount: 12345, currency: 'INR', receipt: 'r1', notes: { orderId: 'o1' } });
  assert.equal(order.id, 'order_1');
  assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from('rzp_test_k:secret').toString('base64')}`);
  assert.deepEqual(JSON.parse(calls[0].init.body), { amount: 12345, currency: 'INR', receipt: 'r1', notes: { orderId: 'o1' } });

  await assert.rejects(client.fetchOrder('order_missing'), (err) => err instanceof RazorpayError && err.code === 'BAD_REQUEST_ERROR' && !err.message.includes('secret'));
  assert.ok(calls[1].url.endsWith('/orders/order_missing'));
});
