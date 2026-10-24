import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '@localstock/database';
import { authenticate, COMPANY_MANAGERS, requireCompanyRole } from '../../middleware/auth.js';
import { writeAudit } from '../../shared/audit.js';
import { notFound } from '../../shared/errors.js';
import { pointSql } from '../../shared/geo.js';
import { idParams, validate } from '../../shared/validate.js';

const createBody = z.object({
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(500).optional(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  serviceRadiusKm: z.number().positive().max(100).default(10),
});
const updateBody = z
  .object({
    name: z.string().trim().min(1).max(200),
    serviceRadiusKm: z.number().positive().max(100),
    status: z.enum(['ACTIVE', 'INACTIVE']),
  })
  .partial()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field');

const COLUMNS = `id, name, address, status, service_radius_m,
  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng`;

const toWarehouse = (r) => ({
  id: r.id,
  name: r.name,
  address: r.address,
  status: r.status,
  lat: r.lat,
  lng: r.lng,
  serviceRadiusKm: r.service_radius_m / 1000,
});

export function createWarehousesRouter({ pool, config }) {
  const router = Router();
  const auth = authenticate(config);

  router.post(
    '/companies/:companyId/warehouses',
    auth,
    requireCompanyRole(pool, COMPANY_MANAGERS),
    validate({ body: createBody }),
    async (req, res) => {
      const { name, address, lat, lng, serviceRadiusKm } = req.valid.body;
      const { companyId } = req.membership;
      const warehouse = await withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `INSERT INTO warehouses (company_id, name, address, location, service_radius_m)
           VALUES ($1, $2, $3, ${pointSql('$4', '$5')}, $6)
           RETURNING ${COLUMNS}`,
          [companyId, name, address ?? null, lat, lng, Math.round(serviceRadiusKm * 1000)],
        );
        await writeAudit(client, { actorUserId: req.user.id, companyId, action: 'warehouse.created', entityType: 'warehouse', entityId: rows[0].id, after: rows[0] });
        return rows[0];
      });
      res.status(201).json(toWarehouse(warehouse));
    },
  );

  router.get('/companies/:companyId/warehouses', auth, requireCompanyRole(pool), async (req, res) => {
    const { rows } = await pool.query(`SELECT ${COLUMNS} FROM warehouses WHERE company_id = $1 ORDER BY name`, [req.membership.companyId]);
    res.json({ items: rows.map(toWarehouse) });
  });

  router.patch(
    '/companies/:companyId/warehouses/:warehouseId',
    auth,
    requireCompanyRole(pool, COMPANY_MANAGERS),
    validate({ params: idParams('companyId', 'warehouseId'), body: updateBody }),
    async (req, res) => {
      const { warehouseId } = req.valid.params;
      const { name, serviceRadiusKm, status } = req.valid.body;
      const { companyId } = req.membership;
      const warehouse = await withTransaction(pool, async (client) => {
        const { rows: before } = await client.query(
          `SELECT ${COLUMNS} FROM warehouses WHERE id = $1 AND company_id = $2 FOR UPDATE`,
          [warehouseId, companyId],
        );
        if (!before[0]) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found');
        const { rows } = await client.query(
          `UPDATE warehouses
              SET name = COALESCE($2, name),
                  service_radius_m = COALESCE($3, service_radius_m),
                  status = COALESCE($4, status)
            WHERE id = $1
            RETURNING ${COLUMNS}`,
          [warehouseId, name ?? null, serviceRadiusKm ? Math.round(serviceRadiusKm * 1000) : null, status ?? null],
        );
        await writeAudit(client, { actorUserId: req.user.id, companyId, action: 'warehouse.updated', entityType: 'warehouse', entityId: warehouseId, before: before[0], after: rows[0] });
        return rows[0];
      });
      res.json(toWarehouse(warehouse));
    },
  );

  return router;
}
