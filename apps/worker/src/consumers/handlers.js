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

// Simulated delivery; logs the customer id only, never contact details.
export async function handleNotification(event, { client, logger }) {
  const template = CUSTOMER_TEMPLATES[event.type];
  if (!template) return;
  const { rows } = await client.query('SELECT customer_id FROM orders WHERE id = $1', [event.aggregateId]);
  if (!rows[0]) return;
  logger.info('notification sent (simulated)', { customerId: rows[0].customer_id, template, orderId: event.aggregateId });
}

// Drop cached comparisons for this source and cell so the next request refetches.
export function createExternalChangeHandler(redis) {
  return async function handleExternalChange(event, { logger }) {
    const { sourceCode, cell } = event.payload ?? {};
    if (!sourceCode || !cell) return;
    const removed = await invalidateCompareCache(redis, sourceCode, cell);
    logger.debug('comparison cache invalidated', { source: sourceCode, entityType: event.payload.entityType, removed });
  };
}

// Bumping the version embedded in every search cache key invalidates them all.
export function createSearchProjectionHandler(redis) {
  return async function handleSearchProjection() {
    await redis.incr(SEARCH_VERSION_KEY);
  };
}
