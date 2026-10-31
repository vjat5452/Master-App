import { randomBytes, randomUUID } from 'node:crypto';
import { allocate } from '@localstock/allocation-engine';
import {
  enqueueEvent,
  InsufficientStockError,
  releaseReservations,
  reserveInventory,
  transitionOrder,
  withTransaction,
} from '@localstock/database';
import { AppError, conflict, notFound } from '../../shared/errors.js';
import { pointSql } from '../../shared/geo.js';
import { VARIANT_IMAGE_SQL } from '../catalog/catalog.routes.js';
import { loadAllocationInput } from '../checkout/allocation-input.js';
import { claimIdempotencyKey, completeIdempotencyKey, releaseIdempotencyKey, requestHash } from './idempotency.js';

const MAX_PLACEMENT_ATTEMPTS = 3;

export async function cancelShipments(client, orderId) {
  await client.query(
    `UPDATE shipments SET status = 'CANCELLED', updated_at = now()
      WHERE order_id = $1 AND status IN ('PENDING', 'INVENTORY_RESERVED')`,
    [orderId],
  );
}

export async function loadOrder(db, orderId, customerId = null) {
  const { rows } = await db.query(
    `SELECT id, customer_id, status, subtotal_minor, delivery_fee_minor, total_minor, currency, created_at, updated_at
       FROM orders WHERE id = $1 AND ($2::uuid IS NULL OR customer_id = $2)`,
    [orderId, customerId],
  );
  const o = rows[0];
  if (!o) return null;

  const [items, shipments, payments, reservations] = await Promise.all([
    db.query(
      `SELECT oi.id, oi.variant_id, v.name AS variant_name, v.brand, ${VARIANT_IMAGE_SQL} AS image_url,
              oi.offer_id, c.name AS seller_name, oi.quantity, oi.unit_price_minor
         FROM order_items oi
         JOIN product_variants v ON v.id = oi.variant_id
         JOIN seller_offers so ON so.id = oi.offer_id
         JOIN companies c ON c.id = so.company_id
        WHERE oi.order_id = $1 ORDER BY v.name`,
      [orderId],
    ),
    db.query(
      `SELECT s.id, s.status, s.warehouse_id, w.name AS warehouse_name, s.delivery_fee_minor, s.eta_minutes,
              p.name AS provider_name, p.type AS provider_type
         FROM shipments s
         JOIN warehouses w ON w.id = s.warehouse_id
         LEFT JOIN delivery_providers p ON p.id = s.delivery_provider_id
        WHERE s.order_id = $1 ORDER BY s.created_at, s.id`,
      [orderId],
    ),
    db.query('SELECT provider, provider_payment_id, amount_minor, status FROM payments WHERE order_id = $1 ORDER BY created_at DESC', [orderId]),
    db.query(`SELECT min(expires_at) AS expires_at FROM inventory_reservations WHERE order_id = $1 AND status = 'ACTIVE'`, [orderId]),
  ]);

  return {
    id: o.id,
    status: o.status,
    currency: o.currency,
    subtotalMinor: o.subtotal_minor,
    deliveryFeeMinor: o.delivery_fee_minor,
    totalMinor: o.total_minor,
    createdAt: o.created_at,
    updatedAt: o.updated_at,
    reservationExpiresAt: reservations.rows[0].expires_at,
    items: items.rows.map((r) => ({
      id: r.id,
      variantId: r.variant_id,
      variantName: r.variant_name,
      brand: r.brand,
      imageUrl: r.image_url ?? null,
      offerId: r.offer_id,
      sellerName: r.seller_name,
      quantity: r.quantity,
      unitPriceMinor: r.unit_price_minor,
    })),
    shipments: shipments.rows.map((r) => ({
      id: r.id,
      status: r.status,
      warehouseId: r.warehouse_id,
      warehouseName: r.warehouse_name,
      deliveryFeeMinor: r.delivery_fee_minor,
      etaMinutes: r.eta_minutes,
      provider: r.provider_name ? { name: r.provider_name, type: r.provider_type } : null,
    })),
    payment: payments.rows[0]
      ? {
          provider: payments.rows[0].provider,
          providerPaymentId: payments.rows[0].provider_payment_id,
          amountMinor: payments.rows[0].amount_minor,
          status: payments.rows[0].status,
        }
      : null,
  };
}

export function createOrdersService({ pool, config }) {
  // One transaction, including the outbox event and the idempotency response.
  async function persistOrder(client, { userId, input, plan, idempotency }) {
    const orderId = randomUUID();
    const lines = plan.shipments.flatMap((s) => s.lines);

    await reserveInventory(
      client,
      lines.map((l) => ({ inventoryId: l.inventoryId, quantity: l.quantity })),
      { referenceType: 'order', referenceId: orderId },
    );

    // Charge the price in force now, not the price seen when the plan was computed.
    const offerIds = [...new Set(lines.map((l) => l.offerId))];
    const { rows: offerRows } = await client.query(
      `SELECT id, price_minor FROM seller_offers WHERE id = ANY($1::uuid[]) AND status = 'ACTIVE' FOR SHARE`,
      [offerIds],
    );
    if (offerRows.length !== offerIds.length) throw conflict('OFFER_UNAVAILABLE', 'An offer in the cart is no longer available');
    const price = new Map(offerRows.map((r) => [r.id, r.price_minor]));

    const items = new Map();
    for (const l of lines) {
      const item = items.get(l.offerId) ?? { variantId: l.variantId, offerId: l.offerId, quantity: 0 };
      item.quantity += l.quantity;
      items.set(l.offerId, item);
    }
    const subtotal = [...items.values()].reduce((sum, it) => sum + it.quantity * price.get(it.offerId), 0);
    const deliveryFee = plan.deliveryFeeMinor;
    const total = subtotal + deliveryFee;

    await client.query(
      `INSERT INTO orders (id, customer_id, status, subtotal_minor, delivery_fee_minor, total_minor, delivery_location)
       VALUES ($1, $2, 'PENDING_PAYMENT', $3, $4, $5, ${pointSql('$6', '$7')})`,
      [orderId, userId, subtotal, deliveryFee, total, input.location.lat, input.location.lng],
    );
    await client.query(
      `INSERT INTO order_status_history (order_id, from_status, to_status, source, actor_user_id)
       VALUES ($1, NULL, 'PENDING_PAYMENT', 'checkout', $2)`,
      [orderId, userId],
    );

    const itemIds = new Map();
    for (const it of items.values()) {
      const { rows } = await client.query(
        `INSERT INTO order_items (order_id, variant_id, offer_id, quantity, unit_price_minor)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [orderId, it.variantId, it.offerId, it.quantity, price.get(it.offerId)],
      );
      itemIds.set(it.offerId, rows[0].id);
    }

    const { rows: expiry } = await client.query('SELECT now() + make_interval(secs => $1::int) AS expires_at', [config.RESERVATION_TTL_SECONDS]);
    for (const s of plan.shipments) {
      const { rows } = await client.query(
        `INSERT INTO shipments (order_id, warehouse_id, status, delivery_provider_id, delivery_fee_minor, eta_minutes)
         VALUES ($1, $2, 'INVENTORY_RESERVED', $3, $4, $5) RETURNING id`,
        [orderId, s.warehouseId, s.delivery.providerId, s.delivery.feeMinor, s.delivery.etaMinutes],
      );
      for (const l of s.lines) {
        await client.query(
          'INSERT INTO fulfillment_allocations (shipment_id, order_item_id, inventory_id, quantity) VALUES ($1, $2, $3, $4)',
          [rows[0].id, itemIds.get(l.offerId), l.inventoryId, l.quantity],
        );
        await client.query(
          `INSERT INTO inventory_reservations (order_id, inventory_id, quantity, status, expires_at)
           VALUES ($1, $2, $3, 'ACTIVE', $4)`,
          [orderId, l.inventoryId, l.quantity, expiry[0].expires_at],
        );
      }
    }

    // Sandbox payment intent: no external call, so it can be recorded here. A real provider's
    // API must be called after this transaction commits, never while it holds locks.
    await client.query(
      `INSERT INTO payments (order_id, provider, provider_payment_id, amount_minor, status)
       VALUES ($1, 'sandbox', $2, $3, 'PENDING')`,
      [orderId, `sbx_${randomBytes(12).toString('hex')}`, total],
    );

    await enqueueEvent(client, {
      eventType: 'OrderCreated',
      aggregateType: 'order',
      aggregateId: orderId,
      payload: { orderId, customerId: userId, totalMinor: total, shipmentCount: plan.shipmentCount },
    });

    const body = await loadOrder(client, orderId);
    await completeIdempotencyKey(client, { ...idempotency, status: 201, body });
    return body;
  }

  async function placeOrder(userId, input, idempotency) {
    for (let attempt = 1; ; attempt++) {
      // Allocation reads a snapshot; reserveInventory re-checks every row under lock.
      const data = await loadAllocationInput(pool, input, { maxCandidateRadiusKm: config.MAX_CANDIDATE_RADIUS_KM });
      const result = allocate({ items: input.items, ...data, preferences: input.preferences });
      if (result.status !== 'OK') {
        throw conflict('ITEMS_UNAVAILABLE', 'The cart cannot be fulfilled to this location', {
          reason: result.reason,
          shortages: result.shortages,
        });
      }
      try {
        return await withTransaction(pool, (client) => persistOrder(client, { userId, input, plan: result.best, idempotency }));
      } catch (err) {
        if (!(err instanceof InsufficientStockError)) throw err;
        if (attempt >= MAX_PLACEMENT_ATTEMPTS) {
          throw conflict('STOCK_CHANGED', 'Stock changed while placing the order; please request a new quote');
        }
      }
    }
  }

  return {
    async createOrder(userId, key, input) {
      const idempotency = { userId, key };
      const claim = await claimIdempotencyKey(pool, { ...idempotency, hash: requestHash(input) });
      if (claim.replay) return { ...claim.replay, replayed: true };
      try {
        return { status: 201, body: await placeOrder(userId, input, idempotency), replayed: false };
      } catch (err) {
        await releaseIdempotencyKey(pool, idempotency).catch(() => {});
        throw err;
      }
    },

    async getOrder(userId, orderId) {
      const order = await loadOrder(pool, orderId, userId);
      if (!order) throw notFound('ORDER_NOT_FOUND', 'Order not found');
      return order;
    },

    async listOrders(userId) {
      const { rows } = await pool.query(
        `SELECT id, status, total_minor AS "totalMinor", created_at AS "createdAt"
           FROM orders WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 50`,
        [userId],
      );
      return { items: rows };
    },

    async cancelOrder(userId, orderId) {
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query('SELECT status FROM orders WHERE id = $1 AND customer_id = $2 FOR UPDATE', [orderId, userId]);
        if (!rows[0]) throw notFound('ORDER_NOT_FOUND', 'Order not found');
        if (rows[0].status !== 'PENDING_PAYMENT') {
          throw new AppError(409, 'ORDER_NOT_CANCELLABLE', `An order in status ${rows[0].status} cannot be cancelled by the customer`);
        }
        await releaseReservations(client, { orderId, toStatus: 'RELEASED', actorUserId: userId });
        await transitionOrder(client, { orderId, from: 'PENDING_PAYMENT', to: 'CANCELLED', source: 'customer', actorUserId: userId });
        await cancelShipments(client, orderId);
        await enqueueEvent(client, { eventType: 'OrderCancelled', aggregateType: 'order', aggregateId: orderId, payload: { orderId, reason: 'customer' } });
        return loadOrder(client, orderId);
      });
    },
  };
}
