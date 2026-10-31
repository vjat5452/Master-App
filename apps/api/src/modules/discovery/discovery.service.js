import { createHash } from 'node:crypto';
import { SEARCH_VERSION_KEY } from '../../infrastructure/cache.js';
import { estimateDeliveryMinutes, pointSql } from '../../shared/geo.js';
import { VARIANT_IMAGE_SQL } from '../catalog/catalog.routes.js';

const CACHE_TTL_SECONDS = 30;

// Offers with sellable stock for the given variants. With a location, only warehouses whose
// service area covers the customer (and inside the requested radius) count.
async function findOffers(pool, { variantIds, lat, lng, radiusMeters }) {
  if (variantIds.length === 0) return [];
  const located = lat != null && lng != null;
  const { rows } = await pool.query(
    `SELECT o.id AS offer_id, o.variant_id, o.price_minor, c.name AS seller_name,
            sum(i.on_hand - i.reserved)::int AS available_units,
            ${located ? `min(ST_Distance(w.location, ${pointSql('$2', '$3')}))` : 'NULL::float8'} AS nearest_meters
       FROM seller_offers o
       JOIN companies c ON c.id = o.company_id AND c.status = 'ACTIVE'
       JOIN warehouse_inventory i ON i.offer_id = o.id AND i.on_hand - i.reserved > 0
       JOIN warehouses w ON w.id = i.warehouse_id AND w.status = 'ACTIVE'
      WHERE o.variant_id = ANY($1::uuid[]) AND o.status = 'ACTIVE'
        ${located ? `AND ST_DWithin(w.location, ${pointSql('$2', '$3')}, LEAST(w.service_radius_m, $4::float8))` : ''}
      GROUP BY o.id, c.name`,
    located ? [variantIds, lat, lng, radiusMeters] : [variantIds],
  );
  return rows.map((r) => ({
    offerId: r.offer_id,
    variantId: r.variant_id,
    sellerName: r.seller_name,
    priceMinor: r.price_minor,
    available: r.available_units > 0,
    availableUnits: r.available_units,
    distanceMeters: r.nearest_meters == null ? null : Math.round(r.nearest_meters),
    estimatedDeliveryMinutes: estimateDeliveryMinutes(r.nearest_meters),
  }));
}

function sortOffers(offers, sort) {
  const byPrice = (a, b) => a.priceMinor - b.priceMinor || (a.estimatedDeliveryMinutes ?? 0) - (b.estimatedDeliveryMinutes ?? 0);
  const byEta = (a, b) => (a.estimatedDeliveryMinutes ?? 0) - (b.estimatedDeliveryMinutes ?? 0) || a.priceMinor - b.priceMinor;
  if (sort === 'lowest_price') return offers.sort(byPrice);
  if (sort === 'fastest' || sort === 'nearest') return offers.sort(byEta);
  const maxPrice = Math.max(1, ...offers.map((o) => o.priceMinor));
  const maxEta = Math.max(1, ...offers.map((o) => o.estimatedDeliveryMinutes ?? 0));
  const score = (o) => 0.6 * (o.priceMinor / maxPrice) + 0.4 * ((o.estimatedDeliveryMinutes ?? 0) / maxEta);
  return offers.sort((a, b) => score(a) - score(b) || byPrice(a, b));
}

export function createDiscoveryService({ pool, redis, logger }) {
  // Cache keys embed a version that the worker bumps on inventory/offer changes, so stale
  // listings disappear without scanning keys. The cache is advisory; checkout re-checks stock.
  async function cached(params, compute) {
    let key = null;
    try {
      const version = (await redis.get(SEARCH_VERSION_KEY)) ?? '0';
      key = `search:v${version}:${createHash('sha1').update(JSON.stringify(params)).digest('hex')}`;
      const hit = await redis.get(key);
      if (hit) return JSON.parse(hit);
    } catch (err) {
      logger.debug('search cache unavailable', { err: err.message });
    }
    const value = await compute();
    if (key) redis.set(key, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS).catch(() => {});
    return value;
  }

  return {
    search(params) {
      return cached({ op: 'search', ...params }, async () => {
        const { q, category, lat, lng, radiusKm, sort, page, limit } = params;
        // $1: search text, $2: optional category slug. EXTERNAL products have no offers but are
        // listed so they can be compared on other platforms.
        const matchSql = `(v.status = 'ACTIVE' OR (v.origin = 'EXTERNAL' AND v.status = 'PENDING_REVIEW')) AND ($1::text = ''
          OR v.search_vector @@ websearch_to_tsquery('english', $1::text)
          OR v.name % $1::text)
          AND ($2::text = '' OR g.category_id = (SELECT id FROM categories WHERE slug = $2::text))`;
        const fromSql = 'FROM product_variants v LEFT JOIN product_groups g ON g.id = v.group_id';

        const { rows } = await pool.query(
          `SELECT v.id, v.name, v.brand, v.attributes, v.origin, g.name AS group_name, ${VARIANT_IMAGE_SQL} AS image_url,
                  count(*) OVER ()::int AS total
             ${fromSql}
            WHERE ${matchSql}
            ORDER BY CASE WHEN $1::text = '' THEN 0
                          ELSE ts_rank(v.search_vector, websearch_to_tsquery('english', $1::text)) + similarity(v.name, $1::text)
                     END DESC, v.name, v.id
            LIMIT $3 OFFSET $4`,
          [q, category, limit, (page - 1) * limit],
        );
        // The window count is only available when the page has rows.
        const total = rows.length
          ? rows[0].total
          : (await pool.query(`SELECT count(*)::int AS total ${fromSql} WHERE ${matchSql}`, [q, category])).rows[0].total;

        const offers = await findOffers(pool, { variantIds: rows.map((r) => r.id), lat, lng, radiusMeters: radiusKm * 1000 });
        const items = rows.map((v) => ({
          variantId: v.id,
          name: v.name,
          brand: v.brand,
          group: v.group_name,
          attributes: v.attributes,
          // EXTERNAL: found on another platform; never has LocalStock offers.
          origin: v.origin,
          imageUrl: v.image_url ?? null,
          offers: sortOffers(offers.filter((o) => o.variantId === v.id), sort).map(({ variantId, ...o }) => o),
        }));
        return { items, page, limit, total };
      });
    },

    async variantOffers({ variantId, lat, lng, radiusKm, sort }) {
      const offers = await findOffers(pool, { variantIds: [variantId], lat, lng, radiusMeters: radiusKm * 1000 });
      return { variantId, offers: sortOffers(offers, sort).map(({ variantId: _v, ...o }) => o) };
    },
  };
}
