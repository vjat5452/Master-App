import { Router } from 'express';
import { z } from 'zod';
import { enqueueEvent, withTransaction } from '@localstock/database';
import { authenticate, COMPANY_MANAGERS, requireCompanyRole } from '../../middleware/auth.js';
import { writeAudit } from '../../shared/audit.js';
import { conflict, notFound } from '../../shared/errors.js';
import { idParams, validate } from '../../shared/validate.js';
import { VARIANT_IMAGE_SQL } from '../catalog/catalog.routes.js';

const createBody = z.object({
  variantId: z.string().uuid(),
  sellerSku: z.string().trim().min(1).max(100),
  priceMinor: z.number().int().min(0),
});
const updateBody = z
  .object({ priceMinor: z.number().int().min(0), status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']) })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field');

const COLUMNS = `o.id, o.variant_id, o.seller_sku, o.price_minor, o.status, v.name AS variant_name, v.brand, ${VARIANT_IMAGE_SQL} AS image_url`;
const toOffer = (r) => ({
  id: r.id,
  variantId: r.variant_id,
  variantName: r.variant_name,
  brand: r.brand,
  imageUrl: r.image_url ?? null,
  sellerSku: r.seller_sku,
  priceMinor: r.price_minor,
  status: r.status,
});

async function findOffer(db, offerId, companyId, lock = false) {
  const { rows } = await db.query(
    `SELECT ${COLUMNS} FROM seller_offers o JOIN product_variants v ON v.id = o.variant_id
      WHERE o.id = $1 AND o.company_id = $2 ${lock ? 'FOR UPDATE OF o' : ''}`,
    [offerId, companyId],
  );
  return rows[0];
}

export function createOffersRouter({ pool, config }) {
  const router = Router();
  const auth = authenticate(config);

  router.post(
    '/companies/:companyId/offers',
    auth,
    requireCompanyRole(pool, COMPANY_MANAGERS),
    validate({ body: createBody }),
    async (req, res) => {
      const { variantId, sellerSku, priceMinor } = req.valid.body;
      const { companyId } = req.membership;
      const offer = await withTransaction(pool, async (client) => {
        const { rows: variants } = await client.query('SELECT status FROM product_variants WHERE id = $1', [variantId]);
        if (!variants[0]) throw notFound('VARIANT_NOT_FOUND', 'Product variant not found');
        if (variants[0].status !== 'ACTIVE') throw conflict('VARIANT_NOT_ACTIVE', 'Offers can only be created for active variants');

        const { rows } = await client.query(
          'INSERT INTO seller_offers (company_id, variant_id, seller_sku, price_minor) VALUES ($1, $2, $3, $4) RETURNING id',
          [companyId, variantId, sellerSku, priceMinor],
        );
        const created = await findOffer(client, rows[0].id, companyId);
        await writeAudit(client, { actorUserId: req.user.id, companyId, action: 'offer.created', entityType: 'seller_offer', entityId: created.id, after: created });
        await enqueueEvent(client, { eventType: 'OfferCreated', aggregateType: 'offer', aggregateId: created.id, payload: { offerId: created.id, variantId, companyId, priceMinor } });
        return created;
      });
      res.status(201).json(toOffer(offer));
    },
  );

  router.get('/companies/:companyId/offers', auth, requireCompanyRole(pool), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM seller_offers o JOIN product_variants v ON v.id = o.variant_id
        WHERE o.company_id = $1 ORDER BY v.name`,
      [req.membership.companyId],
    );
    res.json({ items: rows.map(toOffer) });
  });

  router.patch(
    '/companies/:companyId/offers/:offerId',
    auth,
    requireCompanyRole(pool, COMPANY_MANAGERS),
    validate({ params: idParams('companyId', 'offerId'), body: updateBody }),
    async (req, res) => {
      const { offerId } = req.valid.params;
      const { priceMinor, status } = req.valid.body;
      const { companyId } = req.membership;
      const offer = await withTransaction(pool, async (client) => {
        const before = await findOffer(client, offerId, companyId, true);
        if (!before) throw notFound('OFFER_NOT_FOUND', 'Offer not found');
        await client.query(
          `UPDATE seller_offers SET price_minor = COALESCE($2, price_minor), status = COALESCE($3, status), updated_at = now()
            WHERE id = $1`,
          [offerId, priceMinor ?? null, status ?? null],
        );
        const after = await findOffer(client, offerId, companyId);
        await writeAudit(client, { actorUserId: req.user.id, companyId, action: 'offer.updated', entityType: 'seller_offer', entityId: offerId, before, after });
        await enqueueEvent(client, { eventType: 'OfferUpdated', aggregateType: 'offer', aggregateId: offerId, payload: { offerId, priceMinor: after.price_minor, status: after.status } });
        return after;
      });
      res.json(toOffer(offer));
    },
  );

  return router;
}
