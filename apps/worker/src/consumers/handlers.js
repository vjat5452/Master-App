const SEARCH_VERSION_KEY = 'search:version';

const CUSTOMER_TEMPLATES = {
  OrderCreated: 'order-received',
  OrderConfirmed: 'order-confirmed',
  OrderCancelled: 'order-cancelled',
  OrderExpired: 'order-expired',
  OrderPaymentFailed: 'payment-failed',
  PaymentRefundRequested: 'refund-initiated',
};

// Notifications are simulated: log what would be sent. Swap in an email/SMS provider here.
export async function handleNotification(event, { client, logger }) {
  const template = CUSTOMER_TEMPLATES[event.type];
  if (!template) return;
  const { rows } = await client.query(
    'SELECT u.email FROM orders o JOIN users u ON u.id = o.customer_id WHERE o.id = $1',
    [event.aggregateId],
  );
  if (!rows[0]) return;
  logger.info('notification sent (simulated)', { to: rows[0].email, template, orderId: event.aggregateId });
}

// Invalidate cached search results by bumping the version embedded in every cache key.
export function createSearchProjectionHandler(redis) {
  return async function handleSearchProjection() {
    await redis.incr(SEARCH_VERSION_KEY);
  };
}
