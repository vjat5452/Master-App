// Persists external listings and their product mappings, and answers "which LocalStock
// product is this listing?" for the comparison API.
//
// A listing is matched once; afterwards the stored decision is reused:
// - an accepted mapping (AUTO_CONFIRMED / CONFIRMED) links it to a canonical product;
// - open NEEDS_REVIEW candidates wait for an admin and are not shown as a match;
// - with no mapping (or only rejected ones) the matcher runs again, skipping rejected products.
// Listings are stored here; their price and availability observations are stored by
// observations.js.
import { decideMatch, findCandidates } from './matcher.js';
import { createSourceRegistry } from './sources.js';

/**
 * @param {{ pool, sources?: ReturnType<typeof createSourceRegistry> }} deps
 *   `pool` may also be a transaction client.
 */
export function createMatchingService({ pool, sources = createSourceRegistry({ pool }) }) {
  async function upsertListings({ sourceId, platformId }, entries) {
    const unique = [...new Map(entries.map((e) => [e.listing.externalListingId, e])).values()];
    const col = (fn) => unique.map(fn);
    const { rows } = await pool.query(
      `INSERT INTO external_listings
         (platform_id, first_source_id, external_listing_id, title, brand, variant_text, pack_quantity, pack_unit, pack_count, gtin, image_url, deep_link)
       SELECT $1, $2, s.id, s.title, s.brand, s.variant, s.qty, s.unit, s.count, s.gtin, s.image, s.link
         FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::numeric[], $8::text[], $9::int[], $10::text[], $11::text[], $12::text[])
              AS s(id, title, brand, variant, qty, unit, count, gtin, image, link)
       ON CONFLICT (platform_id, external_listing_id) DO UPDATE SET
         title = EXCLUDED.title, brand = EXCLUDED.brand, variant_text = EXCLUDED.variant_text,
         pack_quantity = EXCLUDED.pack_quantity, pack_unit = EXCLUDED.pack_unit, pack_count = EXCLUDED.pack_count,
         gtin = COALESCE(EXCLUDED.gtin, external_listings.gtin), image_url = EXCLUDED.image_url,
         deep_link = EXCLUDED.deep_link, last_seen_at = now()
       RETURNING id, external_listing_id`,
      [
        platformId,
        sourceId,
        col((e) => e.listing.externalListingId),
        col((e) => e.listing.title),
        col((e) => e.listing.brand),
        col((e) => e.listing.variantText),
        col((e) => e.packSize?.quantity ?? null),
        col((e) => e.packSize?.unit ?? null),
        col((e) => e.packSize?.count ?? null),
        col((e) => e.listing.gtin),
        col((e) => e.listing.imageUrl),
        col((e) => e.listing.deepLink),
      ],
    );
    return new Map(rows.map((r) => [r.external_listing_id, r.id]));
  }

  async function storeDecision(listingId, decision) {
    for (const p of decision.proposals) {
      await pool.query(
        `INSERT INTO external_product_mappings (listing_id, variant_id, match_method, match_confidence, match_status, evidence)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [listingId, p.variantId, p.method, p.confidence, decision.status, JSON.stringify(p.evidence)],
      );
    }
  }

  const unmapped = (listingRecordId) => ({ listingRecordId, matchStatus: 'UNMAPPED', canonicalProductId: null, match: null });

  return {
    ensureSource: (connector) => sources.ensure(connector),
    upsertListings,

    /**
     * @param {object} connector
     * @param {{ listing: object, packSize: object | null }[]} entries quality-checked listings
     * @returns {Promise<Map<string, { listingRecordId, matchStatus: 'MATCHED'|'NEEDS_REVIEW'|'UNMAPPED', canonicalProductId, match }>>}
     */
    async resolve(connector, entries) {
      const out = new Map();
      if (entries.length === 0) return out;
      const source = await sources.ensure(connector);
      const ids = await upsertListings(source, entries);

      const { rows: mappings } = await pool.query(
        `SELECT id, listing_id, variant_id, match_method, match_confidence, match_status
           FROM external_product_mappings WHERE listing_id = ANY($1::uuid[])`,
        [[...ids.values()]],
      );
      const byListing = groupBy(mappings, (m) => m.listing_id);

      for (const { listing, packSize } of entries) {
        const listingId = ids.get(listing.externalListingId);
        if (!listingId) {
          out.set(listing.externalListingId, unmapped(null));
          continue;
        }
        let rows = byListing.get(listingId) ?? [];
        const open = () => rows.filter((m) => m.match_status === 'NEEDS_REVIEW');
        const accepted = () => rows.find((m) => m.match_status === 'AUTO_CONFIRMED' || m.match_status === 'CONFIRMED');

        if (!accepted() && open().length === 0) {
          const rejected = new Set(rows.filter((m) => m.match_status === 'REJECTED').map((m) => m.variant_id));
          const candidates = await findCandidates(pool, { gtin: listing.gtin, brand: listing.brand, title: listing.title });
          const decision = decideMatch({ gtin: listing.gtin, brand: listing.brand, title: listing.title, packSize }, candidates, { excludeVariantIds: rejected });
          if (decision.status !== 'UNMATCHED') {
            await storeDecision(listingId, decision);
            rows = (await pool.query(
              `SELECT id, listing_id, variant_id, match_method, match_confidence, match_status FROM external_product_mappings WHERE listing_id = $1`,
              [listingId],
            )).rows;
          }
        }

        const hit = accepted();
        if (hit) {
          out.set(listing.externalListingId, {
            listingRecordId: listingId,
            matchStatus: 'MATCHED',
            canonicalProductId: hit.variant_id,
            match: { status: hit.match_status, method: hit.match_method, confidence: Number(hit.match_confidence) },
          });
        } else if (open().length) {
          out.set(listing.externalListingId, { listingRecordId: listingId, matchStatus: 'NEEDS_REVIEW', canonicalProductId: null, match: { status: 'NEEDS_REVIEW', candidates: open().length } });
        } else {
          out.set(listing.externalListingId, unmapped(listingId));
        }
      }
      return out;
    },
  };
}

// Map.groupBy needs Node 21; the project supports Node 20.
function groupBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const k = key(item);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(item);
  }
  return map;
}
