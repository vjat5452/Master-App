import { Router } from 'express';
import { z } from 'zod';
import { enqueueEvent, withTransaction } from '@localstock/database';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth.js';
import { writeAudit } from '../../shared/audit.js';
import { notFound } from '../../shared/errors.js';
import { idParams, validate } from '../../shared/validate.js';
import { registerMappingReviewRoutes } from './mapping-review.routes.js';

// Platform admins approve (ACTIVE) or disable vendors and stores. A suspended company drops
// out of search and checkout, and its members lose access to its seller routes; an inactive
// warehouse drops out of search and allocation. Existing orders and reservations are not
// touched. Every change is audited with source_of_change = ADMIN and emits an event so the
// search cache is invalidated.

const listQuery = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']).optional() });
const companyStatusBody = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']), reason: z.string().trim().max(500).optional() });
const warehouseStatusBody = z.object({ status: z.enum(['ACTIVE', 'INACTIVE']), reason: z.string().trim().max(500).optional() });

const toCompany = (r) => ({
  id: r.id,
  name: r.name,
  status: r.status,
  vendorType: r.vendor_type,
  contactPhone: r.contact_phone,
  registrationNumber: r.registration_number,
  createdAt: r.created_at,
  warehouses: r.warehouses,
  activeOffers: r.active_offers,
});

const COMPANY_SQL = `
  SELECT c.id, c.name, c.status, c.vendor_type, c.contact_phone, c.registration_number, c.created_at,
         (SELECT count(*)::int FROM warehouses w WHERE w.company_id = c.id) AS warehouses,
         (SELECT count(*)::int FROM seller_offers o WHERE o.company_id = c.id AND o.status = 'ACTIVE') AS active_offers
    FROM companies c`;

const WAREHOUSE_COLUMNS = `id, company_id, name, address, status, service_radius_m, contact_phone,
  ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng`;
const toWarehouse = (r) => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  address: r.address,
  status: r.status,
  lat: r.lat,
  lng: r.lng,
  serviceRadiusKm: r.service_radius_m / 1000,
  contactPhone: r.contact_phone ?? null,
});

export function createAdminRouter({ pool, config }) {
  const router = Router();
  router.use('/admin', authenticate(config), requirePlatformAdmin);

  router.get('/admin/companies', validate({ query: listQuery }), async (req, res) => {
    const { status } = req.valid.query;
    const { rows } = await pool.query(`${COMPANY_SQL} WHERE ($1::text IS NULL OR c.status = $1) ORDER BY c.name`, [status ?? null]);
    res.json({ items: rows.map(toCompany) });
  });

  router.patch(
    '/admin/companies/:companyId/status',
    validate({ params: idParams('companyId'), body: companyStatusBody }),
    async (req, res) => {
      const { companyId } = req.valid.params;
      const { status, reason } = req.valid.body;
      const company = await withTransaction(pool, async (client) => {
        const { rows: before } = await client.query('SELECT id, status FROM companies WHERE id = $1 FOR UPDATE', [companyId]);
        if (!before[0]) throw notFound('COMPANY_NOT_FOUND', 'Company not found');
        if (before[0].status !== status) {
          await client.query('UPDATE companies SET status = $2 WHERE id = $1', [companyId, status]);
          await writeAudit(client, {
            actorUserId: req.user.id,
            companyId,
            action: 'company.status_changed',
            entityType: 'company',
            entityId: companyId,
            before: { status: before[0].status },
            after: { status, reason: reason ?? null },
            sourceOfChange: 'ADMIN',
          });
          await enqueueEvent(client, {
            eventType: 'CompanyStatusChanged',
            aggregateType: 'company',
            aggregateId: companyId,
            payload: { schemaVersion: 1, companyId, from: before[0].status, to: status },
          });
        }
        const { rows } = await client.query(`${COMPANY_SQL} WHERE c.id = $1`, [companyId]);
        return rows[0];
      });
      res.json(toCompany(company));
    },
  );

  router.get('/admin/companies/:companyId/warehouses', validate({ params: idParams('companyId') }), async (req, res) => {
    const { rows } = await pool.query(`SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE company_id = $1 ORDER BY name`, [req.valid.params.companyId]);
    res.json({ items: rows.map(toWarehouse) });
  });

  router.patch(
    '/admin/warehouses/:warehouseId/status',
    validate({ params: idParams('warehouseId'), body: warehouseStatusBody }),
    async (req, res) => {
      const { warehouseId } = req.valid.params;
      const { status, reason } = req.valid.body;
      const warehouse = await withTransaction(pool, async (client) => {
        const { rows: before } = await client.query(`SELECT ${WAREHOUSE_COLUMNS} FROM warehouses WHERE id = $1 FOR UPDATE`, [warehouseId]);
        if (!before[0]) throw notFound('WAREHOUSE_NOT_FOUND', 'Warehouse not found');
        if (before[0].status === status) return before[0];
        const { rows } = await client.query(`UPDATE warehouses SET status = $2 WHERE id = $1 RETURNING ${WAREHOUSE_COLUMNS}`, [warehouseId, status]);
        await writeAudit(client, {
          actorUserId: req.user.id,
          companyId: before[0].company_id,
          action: 'warehouse.status_changed',
          entityType: 'warehouse',
          entityId: warehouseId,
          before: { status: before[0].status },
          after: { status, reason: reason ?? null },
          sourceOfChange: 'ADMIN',
        });
        await enqueueEvent(client, {
          eventType: 'WarehouseStatusChanged',
          aggregateType: 'warehouse',
          aggregateId: warehouseId,
          payload: { schemaVersion: 1, warehouseId, companyId: before[0].company_id, from: before[0].status, to: status },
        });
        return rows[0];
      });
      res.json(toWarehouse(warehouse));
    },
  );

  registerMappingReviewRoutes(router, { pool });

  return router;
}
