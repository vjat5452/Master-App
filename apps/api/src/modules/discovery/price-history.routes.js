// Daily lowest price per source, from confirmed listings only. Days without an observation are
// null: nothing is interpolated.
import { Router } from 'express';
import { z } from 'zod';
import { locationCell, PLATFORMS, platformSearchLinks } from '@localstock/connectors';
import { notFound } from '../../shared/errors.js';
import { validate } from '../../shared/validate.js';

const params = z.object({ variantId: z.string().uuid() });
const historyQuery = z
  .object({
    days: z.coerce.number().int().min(1).max(365).default(30),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((q) => (q.lat == null) === (q.lng == null), 'lat and lng must be provided together');

const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

async function loadVariant(pool, variantId) {
  const { rows } = await pool.query(
    `SELECT v.id, v.brand, v.name, v.attributes, v.pack_quantity, v.pack_unit, v.pack_count FROM product_variants v WHERE v.id = $1`,
    [variantId],
  );
  if (!rows[0]) throw notFound('VARIANT_NOT_FOUND', 'Product variant not found');
  return rows[0];
}

export function createPriceHistoryRouter({ pool }) {
  const router = Router();

  router.get('/catalog/variants/:variantId/price-history', validate({ params, query: historyQuery }), async (req, res) => {
    const { variantId } = req.valid.params;
    const { days, lat, lng } = req.valid.query;
    const cell = lat != null ? locationCell({ lat, lng }) : null;

    const [, { rows: local }, { rows: allDays }, { rows: external }] = await Promise.all([
      loadVariant(pool, variantId),
      pool.query(
        `WITH days AS (
           SELECT generate_series(date_trunc('day', now()) - make_interval(days => $2 - 1), date_trunc('day', now()), interval '1 day') AS d
         )
         SELECT days.d, min(h.price_minor) FILTER (WHERE h.status = 'ACTIVE') AS price_minor
           FROM days
           CROSS JOIN seller_offers o
           JOIN companies c ON c.id = o.company_id AND c.status = 'ACTIVE'
           LEFT JOIN LATERAL (
             SELECT price_minor, status FROM seller_offer_price_history
              WHERE offer_id = o.id AND valid_from < days.d + interval '1 day'
              ORDER BY valid_from DESC LIMIT 1
           ) h ON true
          WHERE o.variant_id = $1
          GROUP BY days.d ORDER BY days.d`,
        [variantId, days],
      ),
      pool.query(
        `SELECT generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1), date_trunc('day', now()), interval '1 day') AS d`,
        [days],
      ),
      pool.query(
        `SELECT p.code, p.name, p.is_demo, date_trunc('day', po.collected_at) AS d, min(po.item_price_minor) AS price_minor
           FROM external_product_mappings m
           JOIN external_listings l ON l.id = m.listing_id
           JOIN external_platforms p ON p.id = l.platform_id
           JOIN external_price_observations po ON po.listing_id = l.id
          WHERE m.variant_id = $1 AND m.match_status IN ('AUTO_CONFIRMED', 'CONFIRMED')
            AND po.collected_at >= date_trunc('day', now()) - make_interval(days => $2 - 1)
            AND ($3::text IS NULL OR po.query_cell = $3)
          GROUP BY p.code, p.name, p.is_demo, d ORDER BY p.code, d`,
        [variantId, days, cell],
      ),
    ]);

    const dates = allDays.map((r) => day(r.d));
    const localBy = new Map(local.map((r) => [day(r.d), r.price_minor]));
    const series = [];
    if (local.some((r) => r.price_minor !== null)) {
      series.push({
        key: 'localstock',
        label: 'LocalStock sellers (lowest listed price)',
        kind: 'LOCAL',
        isDemo: false,
        points: dates.map((date) => ({ date, priceMinor: localBy.get(date) ?? null })),
      });
    }
    const platforms = new Map();
    for (const r of external) {
      if (!platforms.has(r.code)) platforms.set(r.code, { key: r.code, label: r.name, kind: 'EXTERNAL', isDemo: r.is_demo, values: new Map() });
      platforms.get(r.code).values.set(day(r.d), r.price_minor);
    }
    for (const p of platforms.values()) {
      series.push({ key: p.key, label: p.label, kind: p.kind, isDemo: p.isDemo, points: dates.map((date) => ({ date, priceMinor: p.values.get(date) ?? null })) });
    }

    const all = series.flatMap((s) => s.points.filter((pt) => pt.priceMinor !== null).map((pt) => ({ ...pt, source: s.label })));
    const pick = (cmp) => all.reduce((best, pt) => (best === null || cmp(pt.priceMinor, best.priceMinor) ? pt : best), null);
    res.json({
      variantId,
      days,
      location: cell ? { cell } : null,
      dates,
      series,
      summary: all.length ? { lowest: pick((a, b) => a < b), highest: pick((a, b) => a > b) } : null,
      notes: [
        'LocalStock prices are the lowest active listed price among sellers on each day, before delivery fees.',
        'Other platforms appear only for authorized sources and for listings confirmed as this product; days without an observation are left empty.',
      ],
    });
  });

  router.get('/catalog/variants/:variantId/platform-links', validate({ params }), async (req, res) => {
    const { variantId } = req.valid.params;
    const [v, { rows: listed }] = await Promise.all([
      loadVariant(pool, variantId),
      // Authorized listing links from connected sources, for listings confirmed as this product.
      pool.query(
        `SELECT DISTINCT ON (p.code) p.code, l.deep_link
           FROM external_product_mappings m
           JOIN external_listings l ON l.id = m.listing_id
           JOIN external_platforms p ON p.id = l.platform_id
          WHERE m.variant_id = $1 AND m.match_status IN ('AUTO_CONFIRMED', 'CONFIRMED') AND l.deep_link IS NOT NULL
          ORDER BY p.code, l.last_seen_at DESC`,
        [variantId],
      ),
    ]);
    const size = Object.values(v.attributes ?? {}).find((a) => typeof a === 'string') ?? '';
    const query = [v.brand, v.name, size].filter(Boolean).join(' ');
    const listing = new Map(listed.map((r) => [r.code, r.deep_link]));
    res.json({
      query,
      links: platformSearchLinks(query).map((l) => ({
        ...l,
        kind: listing.has(l.platformCode) ? 'LISTING' : 'SEARCH',
        url: listing.get(l.platformCode) ?? l.url,
      })),
      note: `Links open each platform's own page in your browser. LocalStock does not collect data from ${PLATFORMS.length} platforms without authorized access.`,
    });
  });

  return router;
}
