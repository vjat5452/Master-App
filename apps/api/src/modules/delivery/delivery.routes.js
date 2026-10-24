import { Router } from 'express';
import { z } from 'zod';
import { authenticate, COMPANY_MANAGERS, requireCompanyRole, requirePlatformAdmin } from '../../middleware/auth.js';
import { validate } from '../../shared/validate.js';

const providerFields = {
  name: z.string().trim().min(1).max(200),
  baseFeeMinor: z.number().int().min(0),
  perKmFeeMinor: z.number().int().min(0),
  speedKmph: z.number().int().positive().max(200),
  pickupMinutes: z.number().int().min(0).max(24 * 60).default(10),
  reliability: z.number().min(0).max(1).default(0.9),
  maxDistanceKm: z.number().positive().max(500),
};
const sellerFleetBody = z.object(providerFields);
const platformProviderBody = z.object({ ...providerFields, type: z.enum(['PLATFORM_FLEET', 'THIRD_PARTY']) });

const COLUMNS = `id, company_id, name, type, base_fee_minor, per_km_fee_minor, speed_kmph,
  pickup_minutes, reliability, max_distance_m, status`;

export const toProvider = (r) => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  type: r.type,
  baseFeeMinor: r.base_fee_minor,
  perKmFeeMinor: r.per_km_fee_minor,
  speedKmph: r.speed_kmph,
  pickupMinutes: r.pickup_minutes,
  reliability: Number(r.reliability),
  maxDistanceMeters: r.max_distance_m,
  status: r.status,
});

async function insertProvider(pool, companyId, type, b) {
  const { rows } = await pool.query(
    `INSERT INTO delivery_providers
       (company_id, name, type, base_fee_minor, per_km_fee_minor, speed_kmph, pickup_minutes, reliability, max_distance_m)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${COLUMNS}`,
    [companyId, b.name, type, b.baseFeeMinor, b.perKmFeeMinor, b.speedKmph, b.pickupMinutes, b.reliability, Math.round(b.maxDistanceKm * 1000)],
  );
  return toProvider(rows[0]);
}

export function createDeliveryRouter({ pool, config }) {
  const router = Router();
  const auth = authenticate(config);

  // A seller registers its own fleet; it can only ever carry that seller's shipments.
  router.post(
    '/companies/:companyId/delivery-providers',
    auth,
    requireCompanyRole(pool, COMPANY_MANAGERS),
    validate({ body: sellerFleetBody }),
    async (req, res) => {
      res.status(201).json(await insertProvider(pool, req.membership.companyId, 'SELLER_FLEET', req.valid.body));
    },
  );

  router.get('/companies/:companyId/delivery-providers', auth, requireCompanyRole(pool), async (req, res) => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM delivery_providers WHERE company_id = $1 ORDER BY name`, [req.membership.companyId]);
    res.json({ items: rows.map(toProvider) });
  });

  router.post('/admin/delivery-providers', auth, requirePlatformAdmin, validate({ body: platformProviderBody }), async (req, res) => {
    const { type, ...fields } = req.valid.body;
    res.status(201).json(await insertProvider(pool, null, type, fields));
  });

  router.get('/delivery/providers', auth, async (_req, res) => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM delivery_providers WHERE company_id IS NULL AND status = 'ACTIVE' ORDER BY name`);
    res.json({ items: rows.map(toProvider) });
  });

  return router;
}
