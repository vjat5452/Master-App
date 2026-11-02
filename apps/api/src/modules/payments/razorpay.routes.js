// Razorpay test-mode checkout. Registered only when RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set.
import { Router } from 'express';
import { z } from 'zod';
import { createRazorpayClient, createRazorpayGateway, RazorpayError, verifyCheckoutSignature, verifyWebhookSignature } from '@localstock/payments';
import { authenticate } from '../../middleware/auth.js';
import { rateLimit } from '../../middleware/rate-limit.js';
import { AppError, conflict, notFound } from '../../shared/errors.js';
import { idParams, validate } from '../../shared/validate.js';

// Below this, the shopper cannot realistically finish paying before the stock is released.
const MIN_SECONDS_TO_PAY = 60;

const verifyBody = z.object({
  razorpayOrderId: z.string().min(1).max(64),
  razorpayPaymentId: z.string().min(1).max(64),
  razorpaySignature: z.string().min(1).max(256),
});

const providerDown = () => new AppError(502, 'PAYMENT_PROVIDER_UNAVAILABLE', 'The payment provider could not be reached; please try again');

export function createRazorpayRouter({ pool, redis, config, logger, razorpayClient }) {
  const router = Router();
  const settings = config.razorpay;
  const gateway = createRazorpayGateway({
    pool,
    client: razorpayClient ?? createRazorpayClient(settings),
    logger: logger.child({ component: 'razorpay' }),
  });
  const auth = authenticate(config);
  const params = validate({ params: idParams('orderId') });

  async function loadOwnPayment(orderId, customerId) {
    const { rows } = await pool.query(
      `SELECT o.status, o.total_minor, o.currency, p.id AS payment_id, p.provider, p.provider_payment_id,
              (SELECT min(expires_at) FROM inventory_reservations r WHERE r.order_id = o.id AND r.status = 'ACTIVE') AS expires_at
         FROM orders o JOIN payments p ON p.order_id = o.id
        WHERE o.id = $1 AND o.customer_id = $2
        ORDER BY p.created_at DESC LIMIT 1`,
      [orderId, customerId],
    );
    if (!rows[0]) throw notFound('ORDER_NOT_FOUND', 'Order not found');
    if (rows[0].provider !== 'razorpay') throw conflict('NOT_A_GATEWAY_PAYMENT', 'This order is paid through the sandbox');
    return rows[0];
  }

  // Creates (once) the Razorpay order and returns what the browser needs to open the checkout.
  router.post('/orders/:orderId/payment/razorpay', auth, params, async (req, res) => {
    const { orderId } = req.valid.params;
    const order = await loadOwnPayment(orderId, req.user.id);
    if (order.status !== 'PENDING_PAYMENT') throw conflict('ORDER_NOT_PAYABLE', 'This order is no longer awaiting payment', { status: order.status });
    const secondsLeft = order.expires_at ? Math.floor((new Date(order.expires_at) - Date.now()) / 1000) : 0;
    if (secondsLeft < MIN_SECONDS_TO_PAY) throw conflict('RESERVATION_EXPIRING', 'The reserved stock is about to be released; please place the order again');

    let razorpayOrderId;
    try {
      razorpayOrderId = await gateway.ensureOrder({ paymentId: order.payment_id, orderId, amountMinor: order.total_minor, currency: order.currency });
    } catch (err) {
      if (err instanceof RazorpayError || err.name === 'TimeoutError') {
        logger.warn('razorpay order not created', { orderId, errorCode: err.code ?? err.name });
        throw providerDown();
      }
      throw err;
    }
    res.json({
      keyId: settings.keyId,
      razorpayOrderId,
      amountMinor: order.total_minor,
      currency: order.currency,
      // The checkout closes itself before the reservation runs out.
      timeoutSeconds: secondsLeft - 30,
      testMode: true,
    });
  });

  // The checkout's success callback. The signature proves Razorpay issued it; the order is then
  // re-read from Razorpay, so the browser can never confirm an order by itself.
  router.post('/orders/:orderId/payment/razorpay/verify', auth, validate({ params: idParams('orderId'), body: verifyBody }), async (req, res) => {
    const { orderId } = req.valid.params;
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.valid.body;
    const order = await loadOwnPayment(orderId, req.user.id);
    if (order.provider_payment_id !== razorpayOrderId) throw notFound('PAYMENT_NOT_FOUND', 'Unknown payment');
    if (!verifyCheckoutSignature({ orderId: razorpayOrderId, paymentId: razorpayPaymentId, signature: razorpaySignature }, settings.keySecret)) {
      throw new AppError(400, 'INVALID_SIGNATURE', 'Payment signature verification failed');
    }
    try {
      const result = await gateway.checkOrder(razorpayOrderId, 'checkout');
      res.json({ outcome: result.outcome === 'NOT_PAID' ? 'PROCESSING' : result.outcome });
    } catch (err) {
      if (err instanceof RazorpayError || err.name === 'TimeoutError') {
        // The webhook or the sync job will finish it.
        logger.warn('razorpay status unavailable after checkout', { orderId, errorCode: err.code ?? err.name });
        return res.json({ outcome: 'PROCESSING' });
      }
      throw err;
    }
  });

  // Razorpay webhooks: order.paid and refund.processed change state; everything else is
  // acknowledged. Unknown orders get 200 too, or Razorpay would retry and then disable the hook.
  if (settings.webhookSecret) {
    router.post(
      '/payments/webhooks/razorpay',
      rateLimit(redis, logger,{ keyPrefix: 'webhook', limit: 600, windowSeconds: 60 }),
      async (req, res) => {
        if (!verifyWebhookSignature(req.rawBody ?? Buffer.alloc(0), req.get('x-razorpay-signature'), settings.webhookSecret)) {
          throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
        }
        const { event, payload } = req.body ?? {};
        // Stored as the event record: ids only, never the customer's contact details.
        const summary = { event, razorpayEventId: req.get('x-razorpay-event-id') ?? null };
        let result = { outcome: 'IGNORED' };
        if (event === 'order.paid' && payload?.order?.entity) {
          const order = payload.order.entity;
          const payment = payload.payment?.entity;
          result = await gateway.applyPaidOrder({ order, payment }, { ...summary, razorpayOrderId: order.id, razorpayPaymentId: payment?.id ?? null });
        } else if (event === 'refund.processed' && payload?.refund?.entity) {
          result = await gateway.refundProcessed(payload.refund.entity);
        }
        res.json(result);
      },
    );
  }

  return router;
}
