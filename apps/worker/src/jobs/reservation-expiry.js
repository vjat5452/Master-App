import { enqueueEvent, releaseReservations, transitionOrder, withTransaction } from '@localstock/database';

/**
 * Release stock held by unpaid orders whose reservations expired.
 * Works one order per transaction and locks the order row first (same lock order as payment
 * confirmation), so if a payment confirms concurrently exactly one of them wins: the conditional
 * ACTIVE -> EXPIRED update finds nothing once the reservations are CONFIRMED.
 * The payment row is left PENDING: if the provider later reports success, the payment handler
 * sees no active reservations and requests a refund.
 */
export function createReservationExpiryJob({ pool, logger, batchSize = 50 }) {
  return async function expireReservations() {
    const { rows } = await pool.query(
      `SELECT DISTINCT order_id FROM inventory_reservations
        WHERE status = 'ACTIVE' AND expires_at <= now()
        LIMIT $1`,
      [batchSize],
    );

    let released = 0;
    for (const { order_id: orderId } of rows) {
      try {
        released += await withTransaction(pool, async (client) => {
          const { rows: orders } = await client.query('SELECT status FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
          const expired = await releaseReservations(client, { orderId, toStatus: 'EXPIRED', onlyExpired: true });
          if (expired.length === 0) return 0;

          if (orders[0].status === 'PENDING_PAYMENT') {
            await transitionOrder(client, { orderId, from: 'PENDING_PAYMENT', to: 'CANCELLED', source: 'reservation-expiry' });
            await client.query(
              `UPDATE shipments SET status = 'CANCELLED', updated_at = now()
                WHERE order_id = $1 AND status IN ('PENDING', 'INVENTORY_RESERVED')`,
              [orderId],
            );
          }
          await enqueueEvent(client, {
            eventType: 'OrderExpired',
            aggregateType: 'order',
            aggregateId: orderId,
            payload: { orderId, releasedReservations: expired.length },
          });
          return expired.length;
        });
      } catch (err) {
        logger.error('failed to expire reservations', { orderId, err });
      }
    }

    if (released > 0) logger.info('expired reservations released', { count: released, orders: rows.length });
    return released;
  };
}
