// Inventory invariants live here so the API and the worker change stock the same way.
// Invariant: 0 <= reserved <= on_hand, enforced both by these conditional updates and by table CHECKs.

export class InsufficientStockError extends Error {
  constructor(shortfalls) {
    super('Insufficient stock for one or more inventory rows');
    this.name = 'InsufficientStockError';
    this.domainCode = 'INSUFFICIENT_STOCK';
    this.details = { shortfalls };
  }
}

function sumByInventory(rows) {
  const totals = new Map();
  for (const { inventoryId, quantity } of rows) {
    totals.set(inventoryId, (totals.get(inventoryId) ?? 0) + quantity);
  }
  return totals;
}

// Lock in deterministic id order so concurrent multi-row transactions cannot deadlock each other.
async function lockInventoryRows(client, ids) {
  await client.query('SELECT id FROM warehouse_inventory WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [ids]);
}

export async function recordMovement(
  client,
  { inventoryId, onHandDelta = 0, reservedDelta = 0, reason, note = null, referenceType = null, referenceId = null, actorUserId = null },
) {
  await client.query(
    `INSERT INTO inventory_movements
       (inventory_id, on_hand_delta, reserved_delta, reason, note, reference_type, reference_id, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [inventoryId, onHandDelta, reservedDelta, reason, note, referenceType, referenceId, actorUserId],
  );
}

/**
 * Reserve stock on several inventory rows atomically. Must run inside a transaction.
 * Throws InsufficientStockError (listing every short row) if any row cannot be reserved;
 * the caller's transaction must then roll back.
 */
export async function reserveInventory(client, rows, { referenceType = null, referenceId = null } = {}) {
  const totals = sumByInventory(rows);
  await lockInventoryRows(client, [...totals.keys()]);

  const shortfalls = [];
  for (const [inventoryId, quantity] of totals) {
    const { rowCount } = await client.query(
      `UPDATE warehouse_inventory
          SET reserved = reserved + $1, version = version + 1, updated_at = now()
        WHERE id = $2 AND on_hand - reserved >= $1`,
      [quantity, inventoryId],
    );
    if (rowCount === 0) shortfalls.push({ inventoryId, requested: quantity });
  }
  if (shortfalls.length > 0) throw new InsufficientStockError(shortfalls);

  for (const [inventoryId, quantity] of totals) {
    await recordMovement(client, { inventoryId, reservedDelta: quantity, reason: 'RESERVATION', referenceType, referenceId });
  }
}

/**
 * Move an order's reservations from `fromStatus` to `toStatus` and give the stock back.
 * The conditional status update means each reservation is released at most once, even when
 * expiry, cancellation and payment callbacks race. Returns the reservations that were released.
 */
export async function releaseReservations(
  client,
  { orderId, fromStatus = 'ACTIVE', toStatus, onlyExpired = false, actorUserId = null },
) {
  const { rows } = await client.query(
    `UPDATE inventory_reservations
        SET status = $3, updated_at = now()
      WHERE order_id = $1 AND status = $2 ${onlyExpired ? 'AND expires_at <= now()' : ''}
      RETURNING id, inventory_id, quantity`,
    [orderId, fromStatus, toStatus],
  );
  if (rows.length === 0) return [];

  const totals = sumByInventory(rows.map((r) => ({ inventoryId: r.inventory_id, quantity: r.quantity })));
  await lockInventoryRows(client, [...totals.keys()]);

  const reason = toStatus === 'EXPIRED' ? 'EXPIRY' : 'RELEASE';
  for (const [inventoryId, quantity] of totals) {
    await client.query(
      `UPDATE warehouse_inventory
          SET reserved = reserved - $1, version = version + 1, updated_at = now()
        WHERE id = $2`,
      [quantity, inventoryId],
    );
    await recordMovement(client, {
      inventoryId,
      reservedDelta: -quantity,
      reason,
      referenceType: 'order',
      referenceId: orderId,
      actorUserId,
    });
  }
  return rows;
}
