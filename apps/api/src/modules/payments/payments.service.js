import { enqueueEvent, releaseReservations, transitionOrder, withTransaction } from '@localstock/database';
import { notFound } from '../../shared/errors.js';
import { cancelShipments } from '../orders/orders.service.js';

const setPaymentStatus = (client, paymentId, status) =>
  client.query('UPDATE payments SET status = $2, updated_at = now() WHERE id = $1', [paymentId, status]);

export function createPaymentsService({ pool }) {
  return {
    /**
     * Apply a verified provider event exactly once.
     *  - The provider event id is deduplicated in webhook_events (same transaction as the effects).
     *  - The order row is locked first, the same lock order used by cancellation and expiry,
     *    so confirmation and expiry cannot both win.
     */
    async processEvent({ provider, eventId, providerPaymentId, status, payload }) {
      return withTransaction(pool, async (client) => {
        const { rowCount: fresh } = await client.query(
          `INSERT INTO webhook_events (provider, event_id, payload) VALUES ($1, $2, $3)
           ON CONFLICT (provider, event_id) DO NOTHING`,
          [provider, eventId, JSON.stringify(payload)],
        );
        if (!fresh) return { outcome: 'DUPLICATE_EVENT' };

        const { rows: found } = await client.query('SELECT order_id FROM payments WHERE provider = $1 AND provider_payment_id = $2', [provider, providerPaymentId]);
        if (!found[0]) throw notFound('PAYMENT_NOT_FOUND', 'Unknown payment');
        const orderId = found[0].order_id;

        const { rows: orders } = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
        const { rows: payments } = await client.query(
          'SELECT id, status FROM payments WHERE provider = $1 AND provider_payment_id = $2 FOR UPDATE',
          [provider, providerPaymentId],
        );
        const orderStatus = orders[0].status;
        const payment = payments[0];

        // A different event already settled this payment (e.g. provider sent both FAILED and SUCCEEDED ids).
        if (payment.status !== 'PENDING') return { outcome: 'ALREADY_SETTLED', paymentStatus: payment.status };

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

        const { rows: confirmed } = await client.query(
          `UPDATE inventory_reservations SET status = 'CONFIRMED', updated_at = now()
            WHERE order_id = $1 AND status = 'ACTIVE' RETURNING id`,
          [orderId],
        );
        const { rows: counts } = await client.query('SELECT count(*)::int AS total FROM inventory_reservations WHERE order_id = $1', [orderId]);

        if (orderStatus === 'PENDING_PAYMENT' && confirmed.length > 0 && confirmed.length === counts[0].total) {
          await setPaymentStatus(client, payment.id, 'SUCCEEDED');
          await transitionOrder(client, { orderId, from: orderStatus, to: 'CONFIRMED', source: `payment:${provider}` });
          await enqueueEvent(client, { eventType: 'OrderConfirmed', aggregateType: 'order', aggregateId: orderId, payload: { orderId } });
          return { outcome: 'CONFIRMED', orderId };
        }

        // Paid too late: the reservation expired or the order was cancelled first. Never ship
        // without stock; give back anything partially confirmed and refund.
        if (confirmed.length > 0) {
          await releaseReservations(client, { orderId, fromStatus: 'CONFIRMED', toStatus: 'RELEASED' });
        }
        await setPaymentStatus(client, payment.id, 'REFUND_PENDING');
        if (orderStatus === 'PENDING_PAYMENT') {
          await cancelShipments(client, orderId);
        }
        await transitionOrder(client, { orderId, from: orderStatus, to: 'REFUND_PENDING', source: `payment:${provider}` });
        await enqueueEvent(client, { eventType: 'PaymentRefundRequested', aggregateType: 'order', aggregateId: orderId, payload: { orderId, paymentId: payment.id } });
        return { outcome: 'REFUND_PENDING', orderId };
      });
    },
  };
}
