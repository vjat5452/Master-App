// Razorpay payments for LocalStock orders. Every path that learns a payment succeeded (webhook,
// the browser's checkout callback, the sync job) ends in settlePayment with the same event id,
// so an order is confirmed or refunded once however many of them report it.
import { markRefunded, settlePayment } from '@localstock/database';

export const PROVIDER = 'razorpay';
const paidEventId = (razorpayOrderId) => `order.paid:${razorpayOrderId}`;

export function createRazorpayGateway({ pool, client, logger }) {
  async function findPayment(razorpayOrderId) {
    const { rows } = await pool.query(
      `SELECT p.id, p.order_id, p.amount_minor, o.currency FROM payments p JOIN orders o ON o.id = p.order_id
        WHERE p.provider = $1 AND p.provider_payment_id = $2`,
      [PROVIDER, razorpayOrderId],
    );
    return rows[0] ?? null;
  }

  // `order` and `payment` are Razorpay entities: from a verified webhook or fetched from the API.
  async function applyPaidOrder({ order, payment }, payload) {
    const ours = await findPayment(order.id);
    if (!ours) return { outcome: 'UNKNOWN_ORDER' };
    if (order.status !== 'paid' || payment?.status !== 'captured') return { outcome: 'NOT_PAID', orderId: ours.order_id };
    // We set the amount ourselves; a mismatch means something is badly wrong, so nothing is confirmed.
    if (order.amount_paid !== ours.amount_minor || order.currency !== ours.currency || payment.order_id !== order.id) {
      logger.error('razorpay amount mismatch, payment left for manual review', { paymentId: ours.id, razorpayOrderId: order.id });
      return { outcome: 'AMOUNT_MISMATCH', orderId: ours.order_id };
    }
    return settlePayment(pool, {
      provider: PROVIDER,
      eventId: paidEventId(order.id),
      providerPaymentId: order.id,
      status: 'SUCCEEDED',
      chargeId: payment.id,
      payload,
    });
  }

  async function checkOrder(razorpayOrderId, source) {
    const order = await client.fetchOrder(razorpayOrderId);
    if (order.status !== 'paid') return { outcome: 'NOT_PAID' };
    const payments = await client.fetchOrderPayments(razorpayOrderId);
    const payment = payments.find((p) => p.status === 'captured');
    return applyPaidOrder({ order, payment }, { source, razorpayOrderId, razorpayPaymentId: payment?.id ?? null });
  }

  async function refundSucceeded(paymentId, refundId, source) {
    return markRefunded(pool, { paymentId, refundId, source: `payment:${PROVIDER}:${source}` });
  }

  // Sends each pending refund once. A lease (refund_attempted_at) keeps two workers apart, and
  // existing refunds are looked up first, so a retry after a crash never refunds twice.
  async function submitRefunds(limit) {
    const { rows } = await pool.query(
      `UPDATE payments SET refund_attempted_at = now()
        WHERE id IN (SELECT id FROM payments
                      WHERE provider = $1 AND status = 'REFUND_PENDING' AND provider_refund_id IS NULL AND provider_charge_id IS NOT NULL
                        AND (refund_attempted_at IS NULL OR refund_attempted_at < now() - interval '5 minutes')
                      ORDER BY updated_at LIMIT $2 FOR UPDATE SKIP LOCKED)
        RETURNING id, order_id, provider_charge_id`,
      [PROVIDER, limit],
    );
    let sent = 0;
    for (const p of rows) {
      try {
        const existing = (await client.fetchPaymentRefunds(p.provider_charge_id)).find((r) => r.status !== 'failed');
        const refund = existing ?? (await client.refundPayment(p.provider_charge_id, { receipt: p.id, notes: { orderId: p.order_id } }));
        await pool.query('UPDATE payments SET provider_refund_id = $2, last_checked_at = now() WHERE id = $1', [p.id, refund.id]);
        if (refund.status === 'processed') await refundSucceeded(p.id, refund.id, 'sync');
        sent += 1;
      } catch (err) {
        logger.warn('razorpay refund not sent, will retry', { paymentId: p.id, errorCode: err.code ?? 'ERROR' });
      }
    }
    return sent;
  }

  async function confirmRefunds(limit) {
    const { rows } = await pool.query(
      `SELECT id, provider_refund_id FROM payments
        WHERE provider = $1 AND status = 'REFUND_PENDING' AND provider_refund_id IS NOT NULL
          AND (last_checked_at IS NULL OR last_checked_at < now() - interval '1 minute')
        ORDER BY last_checked_at NULLS FIRST LIMIT $2`,
      [PROVIDER, limit],
    );
    for (const p of rows) {
      try {
        await pool.query('UPDATE payments SET last_checked_at = now() WHERE id = $1', [p.id]);
        const refund = await client.fetchRefund(p.provider_refund_id);
        if (refund.status === 'processed') await refundSucceeded(p.id, refund.id, 'sync');
        else if (refund.status === 'failed') {
          logger.error('razorpay refund failed, retrying', { paymentId: p.id });
          await pool.query(`UPDATE payments SET provider_refund_id = NULL, refund_attempted_at = NULL WHERE id = $1 AND provider_refund_id = $2`, [p.id, refund.id]);
        }
      } catch (err) {
        logger.warn('razorpay refund status unavailable', { paymentId: p.id, errorCode: err.code ?? 'ERROR' });
      }
    }
  }

  // Payments the browser and the webhook never reported: checked a minute after Pay was clicked,
  // then at most once a minute, for two days.
  async function checkPendingPayments(limit) {
    const { rows } = await pool.query(
      `SELECT id, provider_payment_id FROM payments
        WHERE provider = $1 AND status = 'PENDING' AND provider_payment_id IS NOT NULL
          AND updated_at < now() - interval '1 minute' AND created_at > now() - interval '2 days'
          AND (last_checked_at IS NULL OR last_checked_at < now() - interval '1 minute')
        ORDER BY last_checked_at NULLS FIRST LIMIT $2`,
      [PROVIDER, limit],
    );
    let settled = 0;
    for (const p of rows) {
      try {
        await pool.query('UPDATE payments SET last_checked_at = now() WHERE id = $1', [p.id]);
        const result = await checkOrder(p.provider_payment_id, 'sync');
        if (['CONFIRMED', 'REFUND_PENDING'].includes(result.outcome)) settled += 1;
      } catch (err) {
        logger.warn('razorpay payment status unavailable', { paymentId: p.id, errorCode: err.code ?? 'ERROR' });
      }
    }
    return settled;
  }

  return {
    findPayment,
    applyPaidOrder,
    checkOrder,

    // Creates the Razorpay order on the first Pay click and reuses it afterwards. Two clicks at
    // once may each create one; only the first stored is ever shown, the other is never paid.
    async ensureOrder({ paymentId, orderId, amountMinor, currency }) {
      const { rows } = await pool.query('SELECT provider_payment_id FROM payments WHERE id = $1', [paymentId]);
      if (rows[0]?.provider_payment_id) return rows[0].provider_payment_id;
      const created = await client.createOrder({ amount: amountMinor, currency, receipt: orderId, notes: { orderId } });
      const { rows: stored } = await pool.query(
        `UPDATE payments SET provider_payment_id = coalesce(provider_payment_id, $2), updated_at = now() WHERE id = $1 RETURNING provider_payment_id`,
        [paymentId, created.id],
      );
      return stored[0].provider_payment_id;
    },

    async refundProcessed(refund) {
      const { rows } = await pool.query('SELECT id FROM payments WHERE provider = $1 AND provider_charge_id = $2', [PROVIDER, refund.payment_id]);
      if (!rows[0]) return { outcome: 'UNKNOWN_PAYMENT' };
      return refundSucceeded(rows[0].id, refund.id, 'webhook');
    },

    async sync({ limit = 20 } = {}) {
      const settled = await checkPendingPayments(limit);
      const refunds = await submitRefunds(limit);
      await confirmRefunds(limit);
      return { settled, refunds };
    },
  };
}
