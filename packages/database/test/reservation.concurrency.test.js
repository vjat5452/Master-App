// Requires a migrated PostgreSQL. Run with: RUN_DB_TESTS=1 npm run test:db
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { createPool, withTransaction, migrate, reserveInventory, releaseReservations } from '../src/index.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const enabled = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);

let pool;

async function createFixture(onHand) {
  const tag = randomUUID().slice(0, 8);
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows[0]);
  const user = await q(`INSERT INTO users (name, email, password_hash) VALUES ('t', $1, 'x') RETURNING id`, [`t-${tag}@test.local`]);
  const company = await q(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, [`co-${tag}`]);
  const category = await q(`INSERT INTO categories (name, slug) VALUES ('c', $1) RETURNING id`, [`c-${tag}`]);
  const group = await q(`INSERT INTO product_groups (category_id, name) VALUES ($1, 'g') RETURNING id`, [category.id]);
  const variant = await q(
    `INSERT INTO product_variants (group_id, name, normalized_key) VALUES ($1, 'v', $2) RETURNING id`,
    [group.id, `key-${tag}`],
  );
  const offer = await q(
    `INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor) VALUES ($1, $2, 'sku', 100) RETURNING id`,
    [company.id, variant.id],
  );
  const warehouse = await q(
    `INSERT INTO warehouses (company_id, name, location) VALUES ($1, 'w', ST_SetSRID(ST_MakePoint(77.2, 28.6), 4326)::geography) RETURNING id`,
    [company.id],
  );
  const inventory = await q(
    `INSERT INTO warehouse_inventory (warehouse_id, offer_id, on_hand) VALUES ($1, $2, $3) RETURNING id`,
    [warehouse.id, offer.id, onHand],
  );
  return { userId: user.id, inventoryId: inventory.id };
}

async function createPendingOrder(client, customerId) {
  const { rows } = await client.query(
    `INSERT INTO orders (customer_id, status, subtotal_minor, total_minor, delivery_location)
     VALUES ($1, 'PENDING_PAYMENT', 100, 100, ST_SetSRID(ST_MakePoint(77.2, 28.6), 4326)::geography) RETURNING id`,
    [customerId],
  );
  return rows[0].id;
}

const inventoryRow = (id) =>
  pool.query('SELECT on_hand, reserved FROM warehouse_inventory WHERE id = $1', [id]).then((r) => r.rows[0]);

before(async () => {
  if (!enabled) return;
  pool = createPool(process.env.DATABASE_URL, { max: 20 });
  await migrate(pool);
});

after(async () => {
  await pool?.end();
});

test('100 concurrent requests for 1 unit against 5 in stock: exactly 5 succeed', { skip: !enabled }, async () => {
  const { userId, inventoryId } = await createFixture(5);

  const attempts = Array.from({ length: 100 }, () =>
    withTransaction(pool, async (client) => {
      const orderId = await createPendingOrder(client, userId);
      await reserveInventory(client, [{ inventoryId, quantity: 1 }], { referenceType: 'order', referenceId: orderId });
      await client.query(
        `INSERT INTO inventory_reservations (order_id, inventory_id, quantity, status, expires_at)
         VALUES ($1, $2, 1, 'ACTIVE', now() + interval '10 minutes')`,
        [orderId, inventoryId],
      );
    }),
  );
  const results = await Promise.allSettled(attempts);

  const succeeded = results.filter((r) => r.status === 'fulfilled').length;
  const failedForStock = results.filter((r) => r.status === 'rejected' && r.reason.domainCode === 'INSUFFICIENT_STOCK').length;
  assert.equal(succeeded, 5);
  assert.equal(failedForStock, 95);
  assert.deepEqual(await inventoryRow(inventoryId), { on_hand: 5, reserved: 5 });
});

test('a reservation is released exactly once when release attempts race', { skip: !enabled }, async () => {
  const { userId, inventoryId } = await createFixture(3);
  const orderId = await withTransaction(pool, async (client) => {
    const id = await createPendingOrder(client, userId);
    await reserveInventory(client, [{ inventoryId, quantity: 2 }]);
    await client.query(
      `INSERT INTO inventory_reservations (order_id, inventory_id, quantity, status, expires_at)
       VALUES ($1, $2, 2, 'ACTIVE', now() - interval '1 second')`,
      [id, inventoryId],
    );
    return id;
  });

  const releases = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      withTransaction(pool, (client) =>
        releaseReservations(client, { orderId, toStatus: i % 2 ? 'EXPIRED' : 'RELEASED', onlyExpired: i % 2 === 1 }),
      ),
    ),
  );

  assert.equal(releases.filter((rows) => rows.length > 0).length, 1);
  assert.deepEqual(await inventoryRow(inventoryId), { on_hand: 3, reserved: 0 });
});
