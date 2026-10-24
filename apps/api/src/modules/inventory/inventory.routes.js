import { Router } from 'express';
import { z } from 'zod';
import { enqueueEvent, recordMovement, withTransaction } from '@localstock/database';
import { authenticate, requireCompanyRole } from '../../middleware/auth.js';
import { writeAudit } from '../../shared/audit.js';
import { conflict, notFound } from '../../shared/errors.js';
import { validate } from '../../shared/validate.js';

const adjustmentBody = z.object({
  warehouseId: z.string().uuid(),
  offerId: z.string().uuid(),
  delta: z.number().int().refine((d) => d !== 0, 'delta must not be zero'),
  reason: z.enum(['RESTOCK', 'CORRECTION', 'DAMAGE', 'RETURN']),
  note: z.string().trim().max(500).optional(),
});
const listQuery = z.object({ warehouseId: z.string().uuid().optional() });

const toInventory = (r) => ({
  id: r.id,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name,
  offerId: r.offer_id,
  sellerSku: r.seller_sku,
  variantName: r.variant_name,
  onHand: r.on_hand,
  reserved: r.reserved,
  available: r.on_hand - r.reserved,
  version: r.version,
  updatedAt: r.updated_at,
});

export function createInventoryRouter({ pool, config }) {
  const router = Router();
  const auth = authenticate(config);

  // Any member (including STAFF) can adjust stock; every adjustment is audited and leaves a movement.
  router.post('/companies/:companyId/inventory/adjustments', auth, requireCompanyRole(pool), validate({ body: adjustmentBody }), async (req, res) => {
    const { warehouseId, offerId, delta, reason, note } = req.valid.body;
    const { companyId } = req.membership;

    const row = await withTransaction(pool, async (client) => {
      const { rows: owned } = await client.query(
        `SELECT (SELECT count(*) FROM warehouses WHERE id = $1 AND company_id = $3) AS warehouses,
                (SELECT count(*) FROM seller_offers WHERE id = $2 AND company_id = $3) AS offers`,
        [warehouseId, offerId, companyId],
      );
      if (!owned[0].warehouses) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found');
      if (!owned[0].offers) throw notFound('OFFER_NOT_FOUND', 'Offer not found');

      await client.query(
        'INSERT INTO warehouse_inventory (warehouse_id, offer_id) VALUES ($1, $2) ON CONFLICT (warehouse_id, offer_id) DO NOTHING',
        [warehouseId, offerId],
      );
      // on_hand may never drop below what is already promised to customers.
      const { rows } = await client.query(
        `UPDATE warehouse_inventory
            SET on_hand = on_hand + $3, version = version + 1, updated_at = now()
          WHERE warehouse_id = $1 AND offer_id = $2 AND on_hand + $3 >= reserved
          RETURNING id, warehouse_id, offer_id, on_hand, reserved, version, updated_at`,
        [warehouseId, offerId, delta],
      );
      if (!rows[0]) throw conflict('ADJUSTMENT_BELOW_RESERVED', 'Adjustment would leave less stock than is currently reserved');
      const inv = rows[0];

      await recordMovement(client, { inventoryId: inv.id, onHandDelta: delta, reason, note: note ?? null, referenceType: 'adjustment', actorUserId: req.user.id });
      await writeAudit(client, { actorUserId: req.user.id, companyId, action: 'inventory.adjusted', entityType: 'warehouse_inventory', entityId: inv.id, after: { delta, reason, note, onHand: inv.on_hand } });
      await enqueueEvent(client, {
        eventType: 'InventoryChanged',
        aggregateType: 'inventory',
        aggregateId: inv.id,
        payload: { inventoryId: inv.id, warehouseId, offerId, onHand: inv.on_hand, reserved: inv.reserved, version: inv.version },
      });
      return inv;
    });

    res.status(201).json(toInventory(row));
  });

  router.get('/companies/:companyId/inventory', auth, requireCompanyRole(pool), validate({ query: listQuery }), async (req, res) => {
    const { warehouseId } = req.valid.query;
    const { rows } = await pool.query(
      `SELECT i.id, i.warehouse_id, w.name AS warehouse_name, i.offer_id, o.seller_sku, v.name AS variant_name,
              i.on_hand, i.reserved, i.version, i.updated_at
         FROM warehouse_inventory i
         JOIN warehouses w ON w.id = i.warehouse_id
         JOIN seller_offers o ON o.id = i.offer_id
         JOIN product_variants v ON v.id = o.variant_id
        WHERE w.company_id = $1 AND ($2::uuid IS NULL OR i.warehouse_id = $2)
        ORDER BY w.name, v.name`,
      [req.membership.companyId, warehouseId ?? null],
    );
    res.json({ items: rows.map(toInventory) });
  });

  return router;
}
