import { withTransaction } from '../transaction.js';
import { releaseReservations } from './inventory.js';
import { transitionOrder } from './orders.js';
import { enqueueEvent } from './outbox.js';

export class PaymentNotFoundError extends Error {
  constructor() {
    super('Unknown payment');
    this.name = 'PaymentNotFoundError';
  }
}

const cancelShipments = (client, orderId) =>
  client.query(
    `UPDATE shipments SET status = 'CANCELLED', updated_at = now()
      WHERE order_id = $1 AND status IN ('PENDING', 'INVENTORY_RESERVED')`,
    [orderId],
  );

const setPaymentStatus = (client, paymentId, status, chargeId = null) =>
  client.query(
    'UPDATE payments SET status = $2, provider_charge_id = coalesce($3, provider_charge_id), updated_at = now() WHERE id = $1',
    [paymentId, status, chargeId],
  );

// Applies one provider outcome to a payment. Event ids are deduplicated in the same transaction,
// and the order row is locked first, as in cancellation and expiry, so confirmation and expiry
// cannot both win. `chargeId` is the provider's id for the captured payment, needed to refund it.
export function settlePayment(pool, { provider, eventId, providerPaymentId, status, chargeId = null, payload }) {
  return withTransaction(pool, async (client) => {
    const { rowCount: fresh } = await client.query(
      `INSERT INTO webhook_events (provider, event_id, payload) VALUES ($1, $2, $3)
       ON CONFLICT (provider, event_id) DO NOTHING`,
      [provider, eventId, JSON.stringify(payload)],
    );
    if (!fresh) return { outcome: 'DUPLICATE_EVENT' };

    const { rows: found } = await client.query('SELECT order_id FROM payments WHERE provider = $1 AND provider_payment_id = $2', [provider, providerPaymentId]);
    if (!found[0]) throw new PaymentNotFoundError();
    const orderId = found[0].order_id;

    const { rows: orders } = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const { rows: payments } = await client.query(
      'SELECT id, status FROM payments WHERE provider = $1 AND provider_payment_id = $2 FOR UPDATE',
      [provider, providerPaymentId],
    );
    const orderStatus = orders[0].status;
    const payment = payments[0];

    // A different event already settled this payment (e.g. provider sent both FAILED and SUCCEEDED ids).
    if (payment.status !== 'PENDING') return { outcome: 'ALREADY_SETTLED', paymentStatus: payment.status, orderId };

    if (status === 'FAILED') {
      await setPaymentStatus(client, payment.id, 'FAILED');
      if (orderStatus === 'PENDING_PAYMENT') {
        await releaseReservations(client, { orderId, toStatus: 'RELEASED' });
        await transitionOrder(client, { orderId, from: orderStatus, to: 'PAYMENT_FAILED', source: `payment:${provider}` });
        await cancelShipments(client, orderId);
        await enqueueEvent(client, { eventType: 'OrderPaymentFailed', aggregateType: 'order', aggregateId: orderId, payload: { orderId } });
      }
      return { outcome: 'PAYMENT_FAILED', orderId };
    }

    // Holds past their deadline count as expired even if the expiry job has not run yet.
    const expired = await releaseReservations(client, { orderId, toStatus: 'EXPIRED', onlyExpired: true });
    if (expired.length > 0) {
      await enqueueEvent(client, {
        eventType: 'OrderExpired',
        aggregateType: 'order',
        aggregateId: orderId,
        payload: { orderId, releasedReservations: expired.length },
      });
    }

    const { rows: confirmed } = await client.query(
      `UPDATE inventory_reservations SET status = 'CONFIRMED', updated_at = now()
        WHERE order_id = $1 AND status = 'ACTIVE' AND expires_at > now() RETURNING id`,
      [orderId],
    );
    const { rows: counts } = await client.query('SELECT count(*)::int AS total FROM inventory_reservations WHERE order_id = $1', [orderId]);

    if (orderStatus === 'PENDING_PAYMENT' && confirmed.length > 0 && confirmed.length === counts[0].total) {
      await setPaymentStatus(client, payment.id, 'SUCCEEDED', chargeId);
      await transitionOrder(client, { orderId, from: orderStatus, to: 'CONFIRMED', source: `payment:${provider}` });
      await enqueueEvent(client, { eventType: 'OrderConfirmed', aggregateType: 'order', aggregateId: orderId, payload: { orderId } });
      return { outcome: 'CONFIRMED', orderId };
    }

    // Paid too late: the reservation expired or the order was cancelled first. Never ship
    // without stock; give back anything partially confirmed and refund.
    if (confirmed.length > 0) {
      await releaseReservations(client, { orderId, fromStatus: 'CONFIRMED', toStatus: 'RELEASED' });
    }
    await setPaymentStatus(client, payment.id, 'REFUND_PENDING', chargeId);
    if (orderStatus === 'PENDING_PAYMENT') {
      await cancelShipments(client, orderId);
    }
    await transitionOrder(client, { orderId, from: orderStatus, to: 'REFUND_PENDING', source: `payment:${provider}` });
    await enqueueEvent(client, { eventType: 'PaymentRefundRequested', aggregateType: 'order', aggregateId: orderId, payload: { orderId, paymentId: payment.id } });
    return { outcome: 'REFUND_PENDING', orderId };
  });
}

// The provider confirmed the refund: payment and order both end as REFUNDED, once.
export function markRefunded(pool, { paymentId, refundId, source }) {
  return withTransaction(pool, async (client) => {
    const { rows } = await client.query(
      `SELECT p.order_id, o.status AS order_status FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.id = $1 FOR UPDATE OF o`,
      [paymentId],
    );
    if (!rows[0]) throw new PaymentNotFoundError();
    const { rowCount } = await client.query(
      `UPDATE payments SET status = 'REFUNDED', provider_refund_id = coalesce(provider_refund_id, $2), updated_at = now()
        WHERE id = $1 AND status = 'REFUND_PENDING'`,
      [paymentId, refundId],
    );
    if (rowCount === 0) return { outcome: 'ALREADY_SETTLED' };
    const orderId = rows[0].order_id;
    if (rows[0].order_status === 'REFUND_PENDING') {
      await transitionOrder(client, { orderId, from: 'REFUND_PENDING', to: 'REFUNDED', source });
    }
    await enqueueEvent(client, { eventType: 'PaymentRefunded', aggregateType: 'order', aggregateId: orderId, payload: { orderId, paymentId } });
    return { outcome: 'REFUNDED', orderId };
  });
}
