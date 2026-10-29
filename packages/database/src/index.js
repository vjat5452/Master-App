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

export function createPool(connectionString, options = {}) {
  return new pg.Pool({ connectionString, max: 10, ...options });
}

// Deadlock and serialization failures are safe to retry as a whole transaction.
const RETRYABLE_CODES = new Set(['40001', '40P01']);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withTransaction(pool, fn, { retries = 3 } = {}) {
  for (let attempt = 0; ; attempt++) {
    const client = await pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        broken = true;
      });
      if (RETRYABLE_CODES.has(err.code) && attempt < retries) {
        await sleep(20 * 2 ** attempt + Math.random() * 20);
        continue;
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }
}
