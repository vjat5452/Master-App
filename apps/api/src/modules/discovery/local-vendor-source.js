// LocalStock's own sellers as a comparison source. Prices and stock come straight from
// seller_offers and warehouse_inventory (authoritative, not observations); distance is
// measured to the nearest qualifying warehouse's verified coordinates.
import { extractPackSize, parsePackSize } from '@localstock/database';
import { estimateDeliveryMinutes, pointSql } from '../../shared/geo.js';
import { VARIANT_IMAGE_SQL } from '../catalog/catalog.routes.js';
import { assessFreshness } from '@localstock/external-data';

export const LOCAL_SOURCE = Object.freeze({ code: 'localstock', name: 'LocalStock sellers' });

/**
 * Splits a customer query into search text and an optional pack size:
 * "Amul toned milk 1 litre" -> { text: "Amul toned milk", packSize: 1000 ml }.
 */
export function splitQuery(query) {
  const { packSize, phrase } = extractPackSize(query);
  const text = packSize ? query.replace(phrase, ' ').replace(/\s+/g, ' ').trim() : query.trim();
  return { text: text || query.trim(), packSize };
}

const firstAttributeValue = (attributes) => {
  const value = Object.values(attributes ?? {}).find((v) => typeof v === 'string');
  return value ?? null;
};

export function createLocalVendorSource({ pool }) {
  // Text match on brand + name (or an exact GTIN). A size in the query ranks the exact pack
  // size first but does not hide other sizes: they are different products, shown as such.
  async function findVariants(query, limit) {
    const { text, packSize } = splitQuery(query);
    const { rows } = await pool.query(
      `SELECT v.id, v.brand, v.name, v.attributes, v.barcode, v.pack_quantity, v.pack_unit, v.pack_count, ${VARIANT_IMAGE_SQL} AS image_url
         FROM product_variants v
        WHERE v.status = 'ACTIVE'
          AND (v.search_vector @@ websearch_to_tsquery('english', $1) OR v.name % $1 OR v.barcode = $1)
        ORDER BY (v.barcode = $1) DESC NULLS LAST,
                 (v.pack_unit = $3 AND v.pack_quantity = $4 AND v.pack_count = $5) DESC NULLS LAST,
                 ts_rank(v.search_vector, websearch_to_tsquery('english', $1)) + similarity(coalesce(v.brand, '') || ' ' || v.name, $1) DESC,
                 v.id
        LIMIT $2`,
      [text, limit, packSize?.unit ?? null, packSize?.quantity ?? null, packSize?.count ?? null],
    );
    return rows;
  }

  // One row per offer: the nearest warehouse with sellable stock that serves the location,
  // plus the offer's total sellable units across all such warehouses.
  async function findOffers(variantIds, { lat, lng }, radiusMeters) {
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (o.id)
              o.id AS offer_id, o.variant_id, o.price_minor, o.mrp_minor, c.id AS company_id, c.name AS company_name,
              w.id AS warehouse_id, w.name AS warehouse_name,
              ST_Distance(w.location, ${pointSql('$2', '$3')}) AS meters,
              sum(i.on_hand - i.reserved) OVER (PARTITION BY o.id)::int AS available_units
         FROM seller_offers o
         JOIN companies c ON c.id = o.company_id AND c.status = 'ACTIVE'
         JOIN warehouse_inventory i ON i.offer_id = o.id AND i.on_hand - i.reserved > 0
         JOIN warehouses w ON w.id = i.warehouse_id AND w.status = 'ACTIVE'
        WHERE o.variant_id = ANY($1::uuid[]) AND o.status = 'ACTIVE'
          AND ST_DWithin(w.location, ${pointSql('$2', '$3')}, LEAST(w.service_radius_m, $4::float8))
        ORDER BY o.id, meters`,
      [variantIds, lat, lng, radiusMeters],
    );
    return rows;
  }

  return {
    code: LOCAL_SOURCE.code,
    name: LOCAL_SOURCE.name,

    /** @returns {Promise<object[]>} unified comparison results */
    async search({ query, location, radiusKm, limit, now = Date.now() }) {
      const variants = await findVariants(query, limit);
      if (variants.length === 0) return [];
      const offers = await findOffers(variants.map((v) => v.id), location, radiusKm * 1000);
      const byId = new Map(variants.map((v) => [v.id, v]));
      const collectedAt = new Date(now).toISOString();

      return offers.map((o) => {
        const v = byId.get(o.variant_id);
        const variantText = firstAttributeValue(v.attributes);
        const etaMinutes = estimateDeliveryMinutes(o.meters);
        return {
          sourceType: 'LOCAL_VENDOR',
          sourceId: LOCAL_SOURCE.code,
          sourceName: o.company_name,
          sellerId: o.company_id,
          platformCode: null,
          listingId: o.offer_id,
          canonicalProductId: v.id,
          matchStatus: 'CANONICAL',
          product: {
            title: v.name,
            brand: v.brand,
            variant: variantText,
            gtin: v.barcode,
            imageUrl: v.image_url ?? null,
            packSize: v.pack_unit ? { quantity: Number(v.pack_quantity), unit: v.pack_unit, count: v.pack_count } : parsePackSize(variantText),
          },
          price: {
            itemPriceMinor: o.price_minor,
            mrpMinor: o.mrp_minor ?? null,
            currency: 'INR',
            // Delivery is priced by the allocation engine at checkout, so it is not known here.
            fees: { deliveryFeeMinor: null, platformFeeMinor: null, handlingFeeMinor: null, otherFeeMinor: null },
            feesNote: 'Delivery fee is calculated at checkout',
            totalKnownCostMinor: o.price_minor,
            totalCostCompleteness: 'PARTIAL',
          },
          availability: 'IN_STOCK',
          availableUnits: o.available_units,
          serviceability: 'SERVICEABLE',
          fulfillmentNode: { type: 'LOCALSTOCK_WAREHOUSE', id: o.warehouse_id, name: o.warehouse_name, verification: 'VERIFIED' },
          distance: { km: Math.round(o.meters / 100) / 10, status: 'VERIFIED' },
          eta: { minMinutes: null, maxMinutes: etaMinutes, status: 'ESTIMATED', provenance: 'LocalStock distance estimate; checkout quotes the real ETA' },
          freshness: assessFreshness({ sourceType: 'LOCALSTOCK_INVENTORY', collectedAt }, { now }),
          dataProvenance: { sourceType: 'LOCALSTOCK_INVENTORY', isDemo: false, description: 'Seller-managed price and stock' },
          orderCapability: 'LOCALSTOCK_CHECKOUT',
          deepLink: null,
        };
      });
    },
  };
}
