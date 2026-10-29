import { invalidateCompareCache } from '@localstock/external-data';

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

// A changed external price, availability or serviceability makes cached comparison answers
// of that source in that cell out of date; drop them so the next comparison asks again.
export function createExternalChangeHandler(redis) {
  return async function handleExternalChange(event, { logger }) {
    const { sourceCode, cell } = event.payload ?? {};
    if (!sourceCode || !cell) return;
    const removed = await invalidateCompareCache(redis, sourceCode, cell);
    logger.debug('comparison cache invalidated', { source: sourceCode, entityType: event.payload.entityType, removed });
  };
}

// Invalidate cached search results by bumping the version embedded in every cache key.
export function createSearchProjectionHandler(redis) {
  return async function handleSearchProjection() {
    await redis.incr(SEARCH_VERSION_KEY);
  };
}
