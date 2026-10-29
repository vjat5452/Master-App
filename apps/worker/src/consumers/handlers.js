const SEARCH_VERSION_KEY = 'search:version';

const CUSTOMER_TEMPLATES = {
  OrderCreated: 'order-received',
  OrderConfirmed: 'order-confirmed',
  OrderCancelled: 'order-cancelled',
  OrderExpired: 'order-expired',
  OrderPaymentFailed: 'payment-failed',
  PaymentRefundRequested: 'refund-initiated',
};

// Notifications are simulated: log what would be sent. Swap in an email/SMS provider here;
// the provider gets the address, the log only gets the customer id.
export async function handleNotification(event, { client, logger }) {
  const template = CUSTOMER_TEMPLATES[event.type];
  if (!template) return;
  const { rows } = await client.query('SELECT customer_id FROM orders WHERE id = $1', [event.aggregateId]);
  if (!rows[0]) return;
  logger.info('notification sent (simulated)', { customerId: rows[0].customer_id, template, orderId: event.aggregateId });
}

// Invalidate cached search results by bumping the version embedded in every cache key.
export function createSearchProjectionHandler(redis) {
  return async function handleSearchProjection() {
    await redis.incr(SEARCH_VERSION_KEY);
  };
}
