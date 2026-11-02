// Razorpay REST client (https://razorpay.com/docs/api/). Amounts are in paise, like amount_minor.
// Errors carry Razorpay's code and description only, never the request, keys or customer data.
import { createHmac, timingSafeEqual } from 'node:crypto';

const BASE_URL = 'https://api.razorpay.com/v1';

export class RazorpayError extends Error {
  constructor(status, code, description) {
    super(`Razorpay ${status} ${code}: ${description}`);
    this.name = 'RazorpayError';
    this.status = status;
    this.code = code;
  }
}

const hmac = (secret, data) => createHmac('sha256', secret).update(data).digest('hex');

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}

// Signature the checkout returns to the browser after a successful payment.
export const verifyCheckoutSignature = ({ orderId, paymentId, signature }, keySecret) =>
  safeEqual(hmac(keySecret, `${orderId}|${paymentId}`), signature);

// X-Razorpay-Signature on webhooks: HMAC of the raw request body with the webhook secret.
export const verifyWebhookSignature = (rawBody, signature, webhookSecret) => safeEqual(hmac(webhookSecret, rawBody), signature);

export function createRazorpayClient({ keyId, keySecret, fetchImpl = fetch, timeoutMs = 10_000 }) {
  const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;

  async function call(method, path, body) {
    const res = await fetchImpl(`${BASE_URL}${path}`, {
      method,
      headers: { authorization: auth, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new RazorpayError(res.status, data.error?.code ?? 'UNKNOWN', data.error?.description ?? 'request failed');
    return data;
  }

  return {
    keyId,
    createOrder: ({ amount, currency, receipt, notes }) => call('POST', '/orders', { amount, currency, receipt, notes }),
    fetchOrder: (orderId) => call('GET', `/orders/${encodeURIComponent(orderId)}`),
    fetchOrderPayments: (orderId) => call('GET', `/orders/${encodeURIComponent(orderId)}/payments`).then((r) => r.items ?? []),
    refundPayment: (paymentId, { receipt, notes }) => call('POST', `/payments/${encodeURIComponent(paymentId)}/refund`, { speed: 'normal', receipt, notes }),
    fetchPaymentRefunds: (paymentId) => call('GET', `/payments/${encodeURIComponent(paymentId)}/refunds`).then((r) => r.items ?? []),
    fetchRefund: (refundId) => call('GET', `/refunds/${encodeURIComponent(refundId)}`),
  };
}
