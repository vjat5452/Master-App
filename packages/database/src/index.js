import pg from 'pg';

// BIGINT columns hold minor-unit money and counts well within Number.MAX_SAFE_INTEGER.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export { migrate, rollback } from './migrate.js';
export { extractPackSize, parsePackSize, packSizeFromAttributes, samePackSize } from './domain/pack-size.js';
export { backfillPackSizes } from './domain/pack-size-backfill.js';
export { normalizeText } from './domain/text.js';
export { reserveInventory, releaseReservations, recordMovement, InsufficientStockError } from './domain/inventory.js';
export { ORDER_TRANSITIONS, transitionOrder, IllegalTransitionError } from './domain/orders.js';
export { enqueueEvent } from './domain/outbox.js';
export { markRefunded, PaymentNotFoundError, settlePayment } from './domain/payments.js';
export { withTransaction } from './transaction.js';

export function createPool(connectionString, options = {}) {
  return new pg.Pool({ connectionString, max: 10, ...options });
}
