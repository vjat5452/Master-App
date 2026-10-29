// Admin review of product matches. Registered on the admin router, so every route here is
// already authenticated and limited to platform admins.
//
//   GET  /admin/product-mapping/review-queue           listings with candidates to decide
//   POST /admin/product-mapping/:mappingId/decision    CONFIRM a candidate, or REJECT any mapping
//   POST /admin/product-mapping/listings/:listingId/manual   link a listing to a chosen product
//   GET  /admin/catalog/variants/review-queue          seller-proposed variants marked PENDING_REVIEW
//
// A confirmation is refused when the listing's and the product's pack sizes are both known
// and differ: no reviewer can map 500 ml to 1 l.
import { z } from 'zod';
import { packSizeFromAttributes, samePackSize, withTransaction } from '@localstock/database';
import { writeAudit } from '../../shared/audit.js';
import { AppError, conflict, notFound } from '../../shared/errors.js';
import { idParams, pagination, validate } from '../../shared/validate.js';

const decisionBody = z.object({ decision: z.enum(['CONFIRM', 'REJECT']), note: z.string().trim().max(500).optional() });
const manualBody = z.object({ variantId: z.string().uuid(), note: z.string().trim().max(500).optional() });
const queueQuery = z.object(pagination);

const ACCEPTED = ['AUTO_CONFIRMED', 'CONFIRMED'];

const packOf = (r, prefix = '') =>
  r[`${prefix}pack_unit`] ? { quantity: Number(r[`${prefix}pack_quantity`]), unit: r[`${prefix}pack_unit`], count: r[`${prefix}pack_count`] } : null;

function assertSameSizeOrUnknown(listingPack, variantPack) {
  if (listingPack && variantPack && !samePackSize(listingPack, variantPack)) {
    throw new AppError(422, 'PACK_SIZE_MISMATCH', 'The listing and the product have different pack sizes, so they cannot be the same product', {
      listing: listingPack,
      product: variantPack,
    });
  }
}

async function lockListing(client, listingId) {
  const { rows } = await client.query(
    `SELECT id, pack_quantity, pack_unit, pack_count FROM external_listings WHERE id = $1 FOR UPDATE`,
    [listingId],
  );
  if (!rows[0]) throw notFound('LISTING_NOT_FOUND', 'External listing not found');
  return rows[0];
}

async function variantPack(client, variantId) {
  const { rows } = await client.query(
    `SELECT id, status, attributes, pack_quantity, pack_unit, pack_count FROM product_variants WHERE id = $1`,
    [variantId],
  );
  if (!rows[0]) throw notFound('VARIANT_NOT_FOUND', 'Product variant not found');
  return { ...rows[0], pack: packOf(rows[0]) ?? packSizeFromAttributes(rows[0].attributes) };
}

// Closes the other open candidates once one is accepted.
async function rejectOtherCandidates(client, listingId, keepMappingId, reviewerId) {
  await client.query(
    `UPDATE external_product_mappings
        SET match_status = 'REJECTED', reviewed_by = $3, reviewed_at = now(), updated_at = now(),
            evidence = evidence || '{"closedBecause": "another candidate was confirmed"}'::jsonb
      WHERE listing_id = $1 AND id <> $2 AND match_status = 'NEEDS_REVIEW'`,
    [listingId, keepMappingId, reviewerId],
  );
}

export function registerMappingReviewRoutes(router, { pool }) {
  router.get('/admin/product-mapping/review-queue', validate({ query: queueQuery }), async (req, res) => {
    const { page, limit } = req.valid.query;
    const { rows: listings } = await pool.query(
      `SELECT l.id, l.external_listing_id, l.title, l.brand, l.variant_text, l.gtin, l.pack_quantity, l.pack_unit, l.pack_count,
              l.last_seen_at, p.code AS platform_code, p.name AS platform_name, p.is_demo,
              min(m.created_at) AS waiting_since
         FROM external_product_mappings m
         JOIN external_listings l ON l.id = m.listing_id
         JOIN external_platforms p ON p.id = l.platform_id
        WHERE m.match_status = 'NEEDS_REVIEW'
        GROUP BY l.id, p.id
        ORDER BY waiting_since, l.id
        LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit],
    );
    const { rows: total } = await pool.query(
      `SELECT count(DISTINCT listing_id)::int AS n FROM external_product_mappings WHERE match_status = 'NEEDS_REVIEW'`,
    );
    const { rows: candidates } = await pool.query(
      `SELECT m.id, m.listing_id, m.match_method, m.match_confidence, m.evidence, m.created_at,
              v.id AS variant_id, v.brand, v.name, v.attributes, v.barcode, v.pack_quantity, v.pack_unit, v.pack_count
         FROM external_product_mappings m JOIN product_variants v ON v.id = m.variant_id
        WHERE m.match_status = 'NEEDS_REVIEW' AND m.listing_id = ANY($1::uuid[])
        ORDER BY m.match_confidence DESC, m.id`,
      [listings.map((l) => l.id)],
    );

    res.json({
      page,
      limit,
      total: total[0].n,
      items: listings.map((l) => ({
        listing: {
          id: l.id,
          platform: { code: l.platform_code, name: l.platform_name, isDemo: l.is_demo },
          externalListingId: l.external_listing_id,
          title: l.title,
          brand: l.brand,
          variant: l.variant_text,
          gtin: l.gtin,
          packSize: packOf(l),
          lastSeenAt: l.last_seen_at,
        },
        waitingSince: l.waiting_since,
        candidates: candidates
          .filter((c) => c.listing_id === l.id)
          .map((c) => ({
            mappingId: c.id,
            method: c.match_method,
            confidence: Number(c.match_confidence),
            evidence: c.evidence,
            variant: { id: c.variant_id, brand: c.brand, name: c.name, attributes: c.attributes, barcode: c.barcode, packSize: packOf(c) ?? packSizeFromAttributes(c.attributes) },
          })),
      })),
    });
  });

  router.post(
    '/admin/product-mapping/:mappingId/decision',
    validate({ params: idParams('mappingId'), body: decisionBody }),
    async (req, res) => {
      const { mappingId } = req.valid.params;
      const { decision, note } = req.valid.body;
      const result = await withTransaction(pool, async (client) => {
        const { rows } = await client.query('SELECT id, listing_id FROM external_product_mappings WHERE id = $1', [mappingId]);
        if (!rows[0]) throw notFound('MAPPING_NOT_FOUND', 'Mapping not found');
        // Lock the listing first so two reviewers cannot confirm different candidates.
        const listing = await lockListing(client, rows[0].listing_id);
        const { rows: locked } = await client.query(
          'SELECT id, listing_id, variant_id, match_status, match_method FROM external_product_mappings WHERE id = $1 FOR UPDATE',
          [mappingId],
        );
        const mapping = locked[0];

        let nextStatus;
        if (decision === 'CONFIRM') {
          if (mapping.match_status !== 'NEEDS_REVIEW') throw conflict('MAPPING_ALREADY_DECIDED', `This mapping is already ${mapping.match_status}`);
          const { rows: accepted } = await client.query(
            `SELECT id FROM external_product_mappings WHERE listing_id = $1 AND match_status = ANY($2::text[])`,
            [mapping.listing_id, ACCEPTED],
          );
          if (accepted[0]) throw conflict('LISTING_ALREADY_MAPPED', 'This listing is already linked to a product; reject that mapping first', { mappingId: accepted[0].id });
          const variant = await variantPack(client, mapping.variant_id);
          assertSameSizeOrUnknown(packOf(listing), variant.pack);
          nextStatus = 'CONFIRMED';
        } else {
          // Rejecting also unlinks an accepted mapping that turned out to be wrong.
          if (mapping.match_status === 'REJECTED') throw conflict('MAPPING_ALREADY_DECIDED', 'This mapping is already REJECTED');
          nextStatus = 'REJECTED';
        }

        await client.query(
          `UPDATE external_product_mappings
              SET match_status = $2, reviewed_by = $3, reviewed_at = now(), updated_at = now(),
                  evidence = evidence || jsonb_build_object('reviewNote', $4::text)
            WHERE id = $1`,
          [mappingId, nextStatus, req.user.id, note ?? null],
        );
        if (nextStatus === 'CONFIRMED') await rejectOtherCandidates(client, mapping.listing_id, mappingId, req.user.id);
        await writeAudit(client, {
          actorUserId: req.user.id,
          action: `product_mapping.${decision === 'CONFIRM' ? 'confirmed' : 'rejected'}`,
          entityType: 'external_product_mapping',
          entityId: mappingId,
          before: { status: mapping.match_status },
          after: { status: nextStatus, variantId: mapping.variant_id, note: note ?? null },
          sourceOfChange: 'ADMIN',
        });
        return { mappingId, listingId: mapping.listing_id, variantId: mapping.variant_id, status: nextStatus };
      });
      res.json(result);
    },
  );

  router.post(
    '/admin/product-mapping/listings/:listingId/manual',
    validate({ params: idParams('listingId'), body: manualBody }),
    async (req, res) => {
      const { listingId } = req.valid.params;
      const { variantId, note } = req.valid.body;
      const result = await withTransaction(pool, async (client) => {
        const listing = await lockListing(client, listingId);
        const variant = await variantPack(client, variantId);
        if (variant.status !== 'ACTIVE') throw conflict('VARIANT_NOT_ACTIVE', 'Only active products can be linked');
        const { rows: accepted } = await client.query(
          `SELECT id FROM external_product_mappings WHERE listing_id = $1 AND match_status = ANY($2::text[])`,
          [listingId, ACCEPTED],
        );
        if (accepted[0]) throw conflict('LISTING_ALREADY_MAPPED', 'This listing is already linked to a product; reject that mapping first', { mappingId: accepted[0].id });
        assertSameSizeOrUnknown(packOf(listing), variant.pack);

        const { rows } = await client.query(
          `INSERT INTO external_product_mappings (listing_id, variant_id, match_method, match_confidence, match_status, evidence, reviewed_by, reviewed_at)
           VALUES ($1, $2, 'MANUAL', 1, 'CONFIRMED', jsonb_build_object('reviewNote', $3::text), $4, now())
           ON CONFLICT (listing_id, variant_id) DO UPDATE SET
             match_method = 'MANUAL', match_confidence = 1, match_status = 'CONFIRMED', reviewed_by = $4, reviewed_at = now(),
             updated_at = now(), evidence = external_product_mappings.evidence || jsonb_build_object('reviewNote', $3::text)
           RETURNING id`,
          [listingId, variantId, note ?? null, req.user.id],
        );
        await rejectOtherCandidates(client, listingId, rows[0].id, req.user.id);
        await writeAudit(client, {
          actorUserId: req.user.id,
          action: 'product_mapping.manual',
          entityType: 'external_product_mapping',
          entityId: rows[0].id,
          after: { listingId, variantId, note: note ?? null },
          sourceOfChange: 'ADMIN',
        });
        return { mappingId: rows[0].id, listingId, variantId, status: 'CONFIRMED' };
      });
      res.status(201).json(result);
    },
  );

  router.get('/admin/catalog/variants/review-queue', validate({ query: queueQuery }), async (req, res) => {
    const { page, limit } = req.valid.query;
    const { rows } = await pool.query(
      `SELECT v.id, v.brand, v.name, v.attributes, v.barcode, v.created_at, g.name AS group_name, count(*) OVER ()::int AS total
         FROM product_variants v JOIN product_groups g ON g.id = v.group_id
        WHERE v.status = 'PENDING_REVIEW'
        ORDER BY v.created_at, v.id
        LIMIT $1 OFFSET $2`,
      [limit, (page - 1) * limit],
    );
    res.json({
      page,
      limit,
      total: rows[0]?.total ?? 0,
      items: rows.map((r) => ({ id: r.id, brand: r.brand, name: r.name, group: r.group_name, attributes: r.attributes, barcode: r.barcode, createdAt: r.created_at })),
    });
  });
}
