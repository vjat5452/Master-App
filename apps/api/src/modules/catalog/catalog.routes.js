import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '@localstock/database';
import { authenticate, requirePlatformAdmin } from '../../middleware/auth.js';
import { writeAudit } from '../../shared/audit.js';
import { conflict, notFound } from '../../shared/errors.js';
import { idParams, validate } from '../../shared/validate.js';
import { hasDistinguishingAttribute, variantKey } from './product-matching.js';

const categoryBody = z.object({
  name: z.string().trim().min(1).max(100),
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{1,100}$/),
  parentId: z.string().uuid().optional(),
});
const groupBody = z.object({
  categoryId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});
const variantBody = z.object({
  groupId: z.string().uuid(),
  brand: z.string().trim().max(100).optional(),
  name: z.string().trim().min(1).max(200),
  attributes: z.record(z.string(), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
  barcode: z.string().trim().regex(/^\d{8,14}$/, 'Barcode must be a GTIN (8-14 digits)').optional(),
});
const variantStatusBody = z.object({ status: z.enum(['ACTIVE', 'ARCHIVED']) });

// First image of a variant (alias `v`), or null.
export const VARIANT_IMAGE_SQL = '(SELECT pi.image_url FROM product_images pi WHERE pi.variant_id = v.id ORDER BY pi.image_url LIMIT 1)';

const VARIANT_COLUMNS = `v.id, v.group_id, v.brand, v.name, v.attributes, v.barcode, v.status, g.name AS group_name, ${VARIANT_IMAGE_SQL} AS image_url`;

export const toVariant = (r) => ({
  id: r.id,
  groupId: r.group_id,
  groupName: r.group_name,
  brand: r.brand,
  name: r.name,
  attributes: r.attributes,
  barcode: r.barcode,
  status: r.status,
  imageUrl: r.image_url ?? null,
});

async function findVariant(db, where, params) {
  const { rows } = await db.query(
    `SELECT ${VARIANT_COLUMNS}, v.normalized_key FROM product_variants v JOIN product_groups g ON g.id = v.group_id WHERE ${where}`,
    params,
  );
  return rows[0];
}

export function createCatalogRouter({ pool, config }) {
  const router = Router();
  const auth = authenticate(config);

  router.get('/catalog/categories', async (_req, res) => {
    const { rows } = await pool.query('SELECT id, parent_id AS "parentId", name, slug FROM categories ORDER BY name');
    res.json({ items: rows });
  });

  router.post('/catalog/categories', auth, requirePlatformAdmin, validate({ body: categoryBody }), async (req, res) => {
    const { name, slug, parentId } = req.valid.body;
    const { rows } = await pool.query(
      'INSERT INTO categories (name, slug, parent_id) VALUES ($1, $2, $3) RETURNING id, parent_id AS "parentId", name, slug',
      [name, slug, parentId ?? null],
    );
    res.status(201).json(rows[0]);
  });

  router.get('/catalog/groups/:groupId', validate({ params: idParams('groupId') }), async (req, res) => {
    const { groupId } = req.valid.params;
    const { rows } = await pool.query('SELECT id, category_id AS "categoryId", name, description FROM product_groups WHERE id = $1', [groupId]);
    if (!rows[0]) throw notFound('GROUP_NOT_FOUND', 'Product group not found');
    const { rows: variants } = await pool.query(
      `SELECT ${VARIANT_COLUMNS} FROM product_variants v JOIN product_groups g ON g.id = v.group_id
        WHERE v.group_id = $1 AND v.status = 'ACTIVE' ORDER BY v.name`,
      [groupId],
    );
    res.json({ ...rows[0], variants: variants.map(toVariant) });
  });

  router.post('/catalog/groups', auth, requirePlatformAdmin, validate({ body: groupBody }), async (req, res) => {
    const { categoryId, name, description } = req.valid.body;
    const { rows } = await pool.query(
      'INSERT INTO product_groups (category_id, name, description) VALUES ($1, $2, $3) RETURNING id, category_id AS "categoryId", name, description',
      [categoryId, name, description ?? null],
    );
    res.status(201).json(rows[0]);
  });

  router.get('/catalog/variants/:variantId', validate({ params: idParams('variantId') }), async (req, res) => {
    const variant = await findVariant(pool, 'v.id = $1', [req.valid.params.variantId]);
    if (!variant) throw notFound('VARIANT_NOT_FOUND', 'Product variant not found');
    res.json(toVariant(variant));
  });

  // Sellers propose variants. Matching rules decide whether this is an existing item,
  // a conflict that needs a human, a probable duplicate to review, or a new item.
  router.post('/catalog/variants', auth, validate({ body: variantBody }), async (req, res) => {
    const input = req.valid.body;
    const key = variantKey(input);

    const result = await withTransaction(pool, async (client) => {
      const { rowCount } = await client.query('SELECT 1 FROM product_groups WHERE id = $1', [input.groupId]);
      if (!rowCount) throw notFound('GROUP_NOT_FOUND', 'Product group not found');

      if (input.barcode) {
        const byBarcode = await findVariant(client, 'v.barcode = $1', [input.barcode]);
        if (byBarcode) return { created: false, match: 'BARCODE', variant: byBarcode };
      }

      const byKey = await findVariant(client, 'v.normalized_key = $1', [key]);
      if (byKey) {
        if (byKey.barcode && input.barcode && byKey.barcode !== input.barcode) {
          throw conflict('VARIANT_CONFLICT', 'An identical variant exists with a different barcode; manual review required', { variantId: byKey.id });
        }
        return { created: false, match: 'NORMALIZED_ATTRIBUTES', variant: byKey };
      }

      const { rows: similar } = await client.query(
        `SELECT id, name, brand, attributes, similarity(name, $2) AS score
           FROM product_variants
          WHERE group_id = $1 AND lower(coalesce(brand, '')) = lower(coalesce($3, ''))
            AND similarity(name, $2) >= 0.6 AND status <> 'ARCHIVED'
          ORDER BY score DESC LIMIT 5`,
        [input.groupId, input.name, input.brand ?? null],
      );
      const possibleDuplicates = similar
        .filter((s) => !hasDistinguishingAttribute(s.attributes, input.attributes))
        .map((s) => ({ id: s.id, name: s.name, brand: s.brand, score: Number(Number(s.score).toFixed(3)) }));
      const status = possibleDuplicates.length > 0 ? 'PENDING_REVIEW' : 'ACTIVE';

      const { rows } = await client.query(
        `INSERT INTO product_variants (group_id, brand, name, attributes, barcode, normalized_key, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [input.groupId, input.brand ?? null, input.name, JSON.stringify(input.attributes), input.barcode ?? null, key, status],
      );
      await writeAudit(client, { actorUserId: req.user.id, action: 'variant.created', entityType: 'product_variant', entityId: rows[0].id, after: { ...input, status } });
      const variant = await findVariant(client, 'v.id = $1', [rows[0].id]);
      return { created: true, match: null, variant, possibleDuplicates };
    });

    res.status(result.created ? 201 : 200).json({ ...result, variant: toVariant(result.variant) });
  });

  router.patch(
    '/catalog/variants/:variantId/status',
    auth,
    requirePlatformAdmin,
    validate({ params: idParams('variantId'), body: variantStatusBody }),
    async (req, res) => {
      const { rows } = await pool.query('UPDATE product_variants SET status = $2 WHERE id = $1 RETURNING id', [req.valid.params.variantId, req.valid.body.status]);
      if (!rows[0]) throw notFound('VARIANT_NOT_FOUND', 'Product variant not found');
      res.json(toVariant(await findVariant(pool, 'v.id = $1', [rows[0].id])));
    },
  );

  return router;
}
